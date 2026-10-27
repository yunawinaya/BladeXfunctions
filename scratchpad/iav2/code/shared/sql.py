"""SQL several packages must read identically (CONTRACT.md section 14). Filled with lib/v2build.sub: '@T' is hand-quoted here,
@IA / @JOB / @ITEM bare digits ("0" = none), @ITEMS a bare digit list, '@KEY' / '@ORG' quoted (the caller's guard checked
them). No free text is ever substituted: the IA number is read from the header row itself. Read-only check:
python3 test/shared/sql_live.py."""

OPEN = "'QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_IA', 'COMMITTING_REVERT', 'REQUIRES_REVIEW'"
# the two commands that share IA|<id> and the IAC|<id> lock (CONTRACT.md RV2)
COMMANDS = "'COMPLETE_IA', 'REVERT_IA'"

# the stored component lines of one IA: iaLineFingerprint's fields + the HU screen and the labels; id order
FP_LINES = """SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'line_index', l.line_index, 'item_selection', l.item_selection,
       'quantity_uom', CAST(l.quantity_uom AS CHAR), 'total_quantity', l.total_quantity, 'temp_qty_data', l.temp_qty_data,
       'temp_hu_data', l.temp_hu_data, 'item_name', l.item_name) AS j
  FROM sm_item_assembly_tlm8ve69_sub l
 WHERE l.tenant_id = '@T'
   AND l.sm_item_assembly_id = @IA
   AND l.is_deleted = 0
 ORDER BY l.id"""

# the stored header: iaLineFingerprint's header fields + what PREPARE's ENGINE_R / BATCH and the ownership checks read
FP_HEADER = """SELECT JSON_OBJECT('id', CAST(h.id AS CHAR), 'item_id', h.item_id, 'item_qty', h.item_qty, 'item_uom', CAST(h.item_uom AS CHAR),
       'location_id', CAST(h.location_id AS CHAR), 'inventory_category', h.inventory_category, 'batch_no', h.batch_no,
       'issuing_operation_faci', CAST(h.issuing_operation_faci AS CHAR), 'organization_id', h.organization_id,
       'stock_movement_no', h.stock_movement_no, 'stock_movement_no_type', CAST(h.stock_movement_no_type AS CHAR),
       'item_assembly_status', h.item_assembly_status, 'posted_status', h.posted_status, 'table_hu', h.table_hu,
       'item_assembly_date', DATE_FORMAT(h.item_assembly_date, '%Y-%m-%d %H:%i:%s'),
       'manufacturing_date', DATE_FORMAT(h.manufacturing_date, '%Y-%m-%d %H:%i:%s'),
       'expired_date', DATE_FORMAT(h.expired_date, '%Y-%m-%d %H:%i:%s'),
       'remarks', h.remarks, 'remarks_2', h.remarks_2, 'remarks_3', h.remarks_3, 'ia_v2_job_id', h.ia_v2_job_id) AS j
  FROM sm_item_assembly h
 WHERE h.tenant_id = '@T'
   AND h.id = @IA
   AND h.is_deleted = 0"""

# IA output split (plan 10-27): the same + the stored split rows (output_split): the completion's workflows (SUBMIT's read-back, PREPARE,
# COMMIT I0) fingerprint and plan them; the reverts keep FP_HEADER
FP_HEADER_OS = FP_HEADER.replace("'ia_v2_job_id', h.ia_v2_job_id) AS j", "'ia_v2_job_id', h.ia_v2_job_id, 'output_split', h.output_split) AS j", 1)
assert FP_HEADER_OS != FP_HEADER

# lock ownership (CONTRACT.md section 4): the status, the job link and the latest IAC|<ia> LOCK row of one IA
OWNER = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(h.id AS CHAR) AS ia_id, h.item_assembly_status, h.ia_v2_job_id AS ia_v2_job_id, h.stock_movement_no,
       (SELECT p.result_ref
          FROM gd_publish_step p
         WHERE p.tenant_id = '@T'
           AND p.job_id = 'IAC|@IA'
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       (SELECT p.step_name
          FROM gd_publish_step p
         WHERE p.tenant_id = '@T'
           AND p.job_id = 'IAC|@IA'
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_step
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN sm_item_assembly h
    ON h.tenant_id = '@T'
   AND h.id = @IA
   AND h.is_deleted = 0"""


def job_obj(alias):
    """one COMPLETE_IA / REVERT_IA job as a SUBMIT's entry / STATUS answer reads it (command, the request's action / iaNo ride along)"""
    a = alias
    return ("JSON_OBJECT('id', CAST(%s.id AS CHAR), 'command', %s.command, 'job_status', %s.job_status, 'correlation_id', %s.correlation_id,\n"
            "                   'progress_percent', %s.progress_percent, 'progress_message', %s.progress_message,\n"
            "                   'error_code', %s.error_code, 'error_message', %s.error_message, 'line_count', %s.line_count,\n"
            "                   'action', IF(JSON_VALID(%s.request_payload), JSON_UNQUOTE(JSON_EXTRACT(%s.request_payload, '$.action')), NULL),\n"
            "                   'ia_no', IF(JSON_VALID(%s.request_payload), JSON_UNQUOTE(JSON_EXTRACT(%s.request_payload, '$.iaNo')), NULL))") % ((a,) * 13)


# the latest LOCK|n row of IAC|<ia>: its name, key, whether it is younger than 120 s (DB clock) and the status of the job its
# key made (NULL = no job yet): a young lock whose job is missing or open belongs to a submit still in flight (SA's B2 rule)
LOCKOBJ = """SELECT CAST(JSON_OBJECT('step', p.step_name, 'ref', p.result_ref,
                            'young', (p.started_at > n.t - INTERVAL 120 SECOND),
                            'job', (SELECT q.job_status FROM gd_async_job q
                                     WHERE q.tenant_id = p.tenant_id AND q.idempotency_key = p.result_ref AND q.is_deleted = 0
                                     ORDER BY q.id DESC LIMIT 1)) AS CHAR)
          FROM gd_publish_step p
         WHERE @IA > 0
           AND p.tenant_id = '@T'
           AND p.job_id = 'IAC|@IA'
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1"""

# both SUBMITs' entry facts (CONTRACT.md sections 2, 7, RV4): the key's job; the stored IA (0 for an Add / Clone) with its
# number, statuses, number rule, plant, organization and job link; its latest lock; its open / latest / linked jobs of either
# command; the number rule's two COMPLETE_IA counts (review 6); the organization's default batch_number_config rows
FACTS = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       (SELECT CAST(@KJ AS CHAR)
          FROM gd_async_job k
         WHERE k.tenant_id = '@T'
           AND k.idempotency_key = '@KEY'
           AND k.is_deleted = 0
         ORDER BY k.id DESC LIMIT 1) AS key_job,
       CAST(g.id AS CHAR) AS ia_id, g.stock_movement_no, g.item_assembly_status, g.posted_status, g.organization_id,
       CAST(g.issuing_operation_faci AS CHAR) AS plant_id, CAST(g.stock_movement_no_type AS CHAR) AS no_type,
       g.ia_v2_job_id AS ia_v2_job_id,
       (@IALOCK) AS ia_lock,
       (SELECT CAST(JSON_ARRAYAGG(@OJ) AS CHAR)
          FROM gd_async_job o
         WHERE @IA > 0
           AND o.tenant_id = '@T'
           AND o.is_deleted = 0 AND o.command IN (@COMMANDS)
           AND o.correlation_id = 'IA|@IA'
           AND o.job_status IN (@OPEN)) AS open_jobs,
       (SELECT CAST(@XJ AS CHAR)
          FROM gd_async_job x
         WHERE @IA > 0
           AND x.tenant_id = '@T'
           AND x.is_deleted = 0 AND x.command IN (@COMMANDS)
           AND x.correlation_id = 'IA|@IA'
         ORDER BY x.id DESC LIMIT 1) AS last_job,
       (SELECT CAST(@YJ AS CHAR)
          FROM gd_async_job y
         WHERE y.tenant_id = '@T'
           AND y.is_deleted = 0 AND y.command IN (@COMMANDS)
           AND y.id = CAST(g.ia_v2_job_id AS UNSIGNED)) AS link_job,
       (SELECT COUNT(*)
          FROM gd_async_job r
         WHERE @IA > 0
           AND r.tenant_id = '@T'
           AND r.is_deleted = 0 AND r.command = 'COMPLETE_IA'
           AND r.correlation_id = 'IA|@IA'
           AND JSON_VALID(r.request_payload) AND COALESCE(g.stock_movement_no, '') <> ''
           AND (JSON_UNQUOTE(JSON_EXTRACT(r.request_payload, '$.issuedNo')) COLLATE utf8mb4_general_ci) = g.stock_movement_no) AS issued_by_job,
       (SELECT COUNT(*)
          FROM gd_async_job c
         WHERE @IA > 0
           AND c.tenant_id = '@T'
           AND c.is_deleted = 0 AND c.command = 'COMPLETE_IA'
           AND c.correlation_id = 'IA|@IA'
           AND c.job_status = 'COMPLETED'
           AND JSON_VALID(c.request_payload) AND COALESCE(g.stock_movement_no, '') <> ''
           AND (JSON_UNQUOTE(JSON_EXTRACT(c.request_payload, '$.iaNo')) COLLATE utf8mb4_general_ci) = g.stock_movement_no) AS completed_under,
       (SELECT CAST(JSON_OBJECT('n', COUNT(*), 'level', MAX(b.batch_level_selection), 'date_format', MAX(b.date_format)) AS CHAR)
          FROM batch_number_config b
         WHERE b.tenant_id = '@T'
           AND b.organization_id = (COALESCE(g.organization_id, '@ORG') COLLATE utf8mb4_general_ci)
           AND b.item_id IS NULL AND b.item_category_id IS NULL
           AND b.is_deleted = 0) AS batch_cfg
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN sm_item_assembly g
    ON g.tenant_id = '@T'
   AND g.id = @IA
   AND g.is_deleted = 0"""
FACTS_COLS = ["db_now", "key_job", "ia_id", "stock_movement_no", "item_assembly_status", "posted_status", "organization_id", "plant_id", "no_type", "ia_v2_job_id",
              "ia_lock", "open_jobs", "last_job", "link_job", "issued_by_job", "completed_under", "batch_cfg"]

# the item facts SUBMIT's screens, PREPARE, price.js and the engine read (the engine's own columns + IA's), ids as text
ITEMS = """SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'material_name', i.material_name,
       'stock_control', i.stock_control, 'show_delivery', i.show_delivery, 'serial_number_management', i.serial_number_management,
       'item_batch_management', i.item_batch_management, 'batch_number_genaration', i.batch_number_genaration,
       'material_costing_method', i.material_costing_method, 'purchase_unit_price', CAST(i.purchase_unit_price AS CHAR),
       'assembly_cost', CAST(i.assembly_cost AS CHAR), 'based_uom', CAST(i.based_uom AS CHAR),
       'table_uom_conversion', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'base_qty', u.base_qty))
                                   FROM item_mji552rc_sub u
                                  WHERE u.Item_id = i.id AND u.is_deleted = 0), JSON_ARRAY())) AS j
  FROM item i
 WHERE i.tenant_id = '@T'
   AND i.id IN (@ITEMS)
   AND i.is_deleted = 0"""

# COMMIT I3 (review 7): op 1's stored OUT rows - bounded by id > job (no index on operation_effect_key), counted and summed in SQL
OUT_TOTALS = """SELECT COUNT(*) AS n, CAST(COALESCE(SUM(m.total_price), 0) AS CHAR) AS total
  FROM inventory_movement m
 WHERE m.tenant_id = '@T'
   AND m.id > @JOB
   AND m.is_deleted = 0
   AND m.movement = 'OUT'
   AND m.transaction_type = 'IA'
   AND m.trx_no = (SELECT h.stock_movement_no FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA)
   AND m.operation_effect_key LIKE 'IAC|@JOB|I|%'"""

# one engine operation's own rows (IAC|<job>|I or |R): intents, review, and the DONE row's summary (movements = its code-200 results)
OP_STATE = """SELECT (SELECT COUNT(*) FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'IAC|@JOB|@SIDE' AND p.step_name LIKE 'IBA|I|%' AND p.is_deleted = 0) AS intents,
       (SELECT COUNT(*) FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'IAC|@JOB|@SIDE' AND p.step_name = 'IBA|REVIEW' AND p.is_deleted = 0) AS review,
       (SELECT CAST(JSON_EXTRACT(p.result_ref, '$.summary') AS CHAR) FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'IAC|@JOB|@SIDE' AND p.step_name = 'IBA|DONE' AND p.is_deleted = 0
           AND JSON_VALID(p.result_ref)
         ORDER BY p.id DESC LIMIT 1) AS done_summary"""

# COMMIT I1: the organization's live Batch rows of the parent item (the duplicate rule and "ours" are decided in JS: CONTRACT.md section 9)
BATCH_ROWS = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'batch_number', b.batch_number, 'material_id', CAST(b.material_id AS CHAR),
       'plant_id', CAST(b.plant_id AS CHAR), 'organization_id', b.organization_id, 'transaction_no', b.transaction_no) AS j
  FROM batch b
 WHERE b.tenant_id = '@T'
   AND b.organization_id = '@ORG'
   AND b.material_id = @ITEM
   AND b.is_deleted = 0
 ORDER BY b.id"""

# Revert V2 (RV6): the classic IA_REVERT v4 sql_node_iaRvMovs rows, same columns; tenant-scoped, the number and organization
# read from the header row (no free text), id order
RV_MOVES = """SELECT CAST(m.id AS CHAR) AS id, m.transaction_type, m.movement, m.trx_no, CAST(m.item_id AS CHAR) AS item_id,
       CAST(m.plant_id AS CHAR) AS plant_id, CAST(m.bin_location_id AS CHAR) AS bin_location_id, CAST(m.batch_number_id AS CHAR) AS batch_number_id,
       CAST(m.handling_unit_id AS CHAR) AS handling_unit_id, m.inventory_category, m.quantity, m.base_qty, CAST(m.uom_id AS CHAR) AS uom_id,
       CAST(m.base_uom_id AS CHAR) AS base_uom_id, m.unit_price, m.total_price, m.costing_method_id
  FROM inventory_movement m
 WHERE m.tenant_id = '@T'
   AND m.id > @IA
   AND m.organization_id = (SELECT h.organization_id FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA)
   AND m.trx_no = (SELECT h.stock_movement_no FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA)
   AND m.transaction_type IN ('IA', 'IA-R')
   AND m.is_deleted = 0
 ORDER BY m.id"""
RV_MOVES_COLS = ["id", "transaction_type", "movement", "trx_no", "item_id", "plant_id", "bin_location_id", "batch_number_id", "handling_unit_id",
                 "inventory_category", "quantity", "base_qty", "uom_id", "base_uom_id", "unit_price", "total_price", "costing_method_id"]

# the classic IA_SAVE v12 guard (CONTRACT.md section 11): the stored status only, sm_item_assembly only, Edit only
CLASSIC_GUARD = """SELECT CAST(h.id AS CHAR) AS ia_id, h.item_assembly_status
  FROM sm_item_assembly h
 WHERE h.tenant_id = '@T'
   AND h.id = @IA
   AND h.is_deleted = 0"""


def facts(sub, T, IA, KEY, ORG):
    """SUBMIT's facts row; the lock sub-select is filled first (sub leaves no @TOKEN behind)"""
    ia_lock = sub(LOCKOBJ, IA=IA, T=T)
    return sub(FACTS, KJ=job_obj("k"), OJ=job_obj("o"), XJ=job_obj("x"), YJ=job_obj("y"), IALOCK=ia_lock, OPEN=OPEN, COMMANDS=COMMANDS, T=T, IA=IA, KEY=KEY, ORG=ORG)


def op_state(sub, T, JOB, SIDE):
    assert SIDE in ("I", "R"), SIDE
    return sub(OP_STATE, T=T, JOB=JOB, SIDE=SIDE)
