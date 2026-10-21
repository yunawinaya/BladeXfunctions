"""SQL several packages must read identically (CONTRACT.md sections 6 and 14). Filled with lib/v2build.sub: '@T', '@KEY', '@ORG' and
'@HEX' are hand-quoted here (the caller's guard checked them: tenant / organization digits, the key IDA_KEY_RE, @HEX = idaHexJson's
JSON text of upper-case hex strings), @IDA / @JOB bare digits ("0" = none), @ITEMS a bare digit list, @SIDE I or R. No free text is
ever substituted: the IDA number is read from the header row itself, batch numbers arrive only hex-encoded (@HEX) or through a
subquery over the stored lines. Read-only checks: python3 test/shared/sql_smoke.py (offline), python3 test/shared/sql_live.py (dev).
ida_v2_job_id does not exist on dev until the form publish: the live check maps h. / g.ida_v2_job_id to NULL (sqlcheck missing_cols)."""

OPEN = "'QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_IDA', 'REQUIRES_REVIEW'"
COMMANDS = "'COMPLETE_IDA'"

# the stored recovery lines of one IDA: idaLineFingerprint's fields + what PREPARE's ENGINE_R / BATCH / LABELS read; id order
FP_LINES = """SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'line_index', l.line_index, 'item_selection', l.item_selection,
       'quantity_uom', CAST(l.quantity_uom AS CHAR), 'total_quantity', l.total_quantity, 'location_id', CAST(l.location_id AS CHAR),
       'batch_number', l.batch_number, 'manufacturing_date', DATE_FORMAT(l.manufacturing_date, '%Y-%m-%d %H:%i:%s'),
       'expired_date', DATE_FORMAT(l.expired_date, '%Y-%m-%d %H:%i:%s'), 'item_remark', l.item_remark, 'item_remark_2', l.item_remark_2,
       'item_remark_3', l.item_remark_3, 'issuing_plant', CAST(l.issuing_plant AS CHAR), 'organization_id', l.organization_id,
       'item_name', l.item_name) AS j
  FROM sm_item_disassembly_tlm8ve69_sub l
 WHERE l.tenant_id = '@T'
   AND l.sm_item_disassembly_id = @IDA
   AND l.is_deleted = 0
 ORDER BY l.id"""

# the stored header: idaLineFingerprint's header fields (incl. the picks in temp_qty_data) + what PREPARE and the ownership checks read
FP_HEADER = """SELECT JSON_OBJECT('id', CAST(h.id AS CHAR), 'item_id', CAST(h.item_id AS CHAR), 'item_code', h.item_code, 'item_name', h.item_name,
       'item_qty', h.item_qty, 'item_uom', CAST(h.item_uom AS CHAR), 'issuing_operation_faci', CAST(h.issuing_operation_faci AS CHAR),
       'organization_id', h.organization_id, 'stock_movement_no', h.stock_movement_no,
       'stock_movement_no_type', CAST(h.stock_movement_no_type AS CHAR), 'item_disassembly_status', h.item_disassembly_status,
       'posted_status', h.posted_status, 'item_disassembly_date', DATE_FORMAT(h.item_disassembly_date, '%Y-%m-%d %H:%i:%s'),
       'temp_qty_data', h.temp_qty_data, 'temp_hu_data', h.temp_hu_data, 'table_hu', h.table_hu, 'remarks', h.remarks,
       'remarks_2', h.remarks_2, 'remarks_3', h.remarks_3, 'ida_v2_job_id', h.ida_v2_job_id) AS j
  FROM sm_item_disassembly h
 WHERE h.tenant_id = '@T'
   AND h.id = @IDA
   AND h.is_deleted = 0"""

# lock ownership (CONTRACT.md section 4): the status, the job link and the latest IDC|<ida> LOCK row of one IDA
OWNER = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(h.id AS CHAR) AS ida_id, h.item_disassembly_status, h.ida_v2_job_id AS ida_v2_job_id, h.stock_movement_no,
       (SELECT p.result_ref
          FROM gd_publish_step p
         WHERE p.tenant_id = '@T'
           AND p.job_id = 'IDC|@IDA'
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       (SELECT p.step_name
          FROM gd_publish_step p
         WHERE p.tenant_id = '@T'
           AND p.job_id = 'IDC|@IDA'
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_step
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN sm_item_disassembly h
    ON h.tenant_id = '@T'
   AND h.id = @IDA
   AND h.is_deleted = 0"""
OWNER_COLS = ["db_now", "ida_id", "item_disassembly_status", "ida_v2_job_id", "stock_movement_no", "lock_ref", "lock_step"]


def job_obj(alias):
    """one COMPLETE_IDA job as SUBMIT's entry / STATUS answer reads it (command, the request's action / idaNo ride along)"""
    a = alias
    return ("JSON_OBJECT('id', CAST(%s.id AS CHAR), 'command', %s.command, 'job_status', %s.job_status, 'correlation_id', %s.correlation_id,\n"
            "                   'progress_percent', %s.progress_percent, 'progress_message', %s.progress_message,\n"
            "                   'error_code', %s.error_code, 'error_message', %s.error_message, 'line_count', %s.line_count,\n"
            "                   'action', IF(JSON_VALID(%s.request_payload), JSON_UNQUOTE(JSON_EXTRACT(%s.request_payload, '$.action')), NULL),\n"
            "                   'ida_no', IF(JSON_VALID(%s.request_payload), JSON_UNQUOTE(JSON_EXTRACT(%s.request_payload, '$.idaNo')), NULL))") % ((a,) * 13)


# the latest IDC|<ida> LOCK row: step, key, younger than 120 s, its job's status (SA's in-flight rule); inside FACTS
LOCKOBJ ="""SELECT CAST(JSON_OBJECT('step', p.step_name, 'ref', p.result_ref,
                            'young', (p.started_at > n.t - INTERVAL 120 SECOND),
                            'job', (SELECT q.job_status FROM gd_async_job q
                                     WHERE q.tenant_id = p.tenant_id AND q.idempotency_key = p.result_ref AND q.is_deleted = 0
                                     ORDER BY q.id DESC LIMIT 1)) AS CHAR)
          FROM gd_publish_step p
         WHERE @IDA > 0
           AND p.tenant_id = '@T'
           AND p.job_id = 'IDC|@IDA'
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1"""

# SUBMIT's entry facts (CONTRACT.md sections 2, 3, 7; IDA 0 = an Add)
FACTS ="""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       (SELECT CAST(@KJ AS CHAR)
          FROM gd_async_job k
         WHERE k.tenant_id = '@T'
           AND k.idempotency_key = '@KEY'
           AND k.is_deleted = 0
         ORDER BY k.id DESC LIMIT 1) AS key_job,
       CAST(g.id AS CHAR) AS ida_id, g.stock_movement_no, g.item_disassembly_status, g.posted_status, g.organization_id,
       CAST(g.issuing_operation_faci AS CHAR) AS plant_id, CAST(g.stock_movement_no_type AS CHAR) AS no_type,
       g.ida_v2_job_id AS ida_v2_job_id,
       (@IDALOCK) AS ida_lock,
       (SELECT CAST(JSON_ARRAYAGG(@OJ) AS CHAR)
          FROM gd_async_job o
         WHERE @IDA > 0
           AND o.tenant_id = '@T'
           AND o.is_deleted = 0 AND o.command IN (@COMMANDS)
           AND o.correlation_id = 'IDA|@IDA'
           AND o.job_status IN (@OPEN)) AS open_jobs,
       (SELECT CAST(@XJ AS CHAR)
          FROM gd_async_job x
         WHERE @IDA > 0
           AND x.tenant_id = '@T'
           AND x.is_deleted = 0 AND x.command IN (@COMMANDS)
           AND x.correlation_id = 'IDA|@IDA'
         ORDER BY x.id DESC LIMIT 1) AS last_job,
       (SELECT CAST(@YJ AS CHAR)
          FROM gd_async_job y
         WHERE y.tenant_id = '@T'
           AND y.is_deleted = 0 AND y.command IN (@COMMANDS)
           AND y.id = CAST(g.ida_v2_job_id AS UNSIGNED)) AS link_job,
       (SELECT COUNT(*)
          FROM gd_async_job r
         WHERE @IDA > 0
           AND r.tenant_id = '@T'
           AND r.is_deleted = 0 AND r.command = 'COMPLETE_IDA'
           AND r.correlation_id = 'IDA|@IDA'
           AND JSON_VALID(r.request_payload) AND COALESCE(g.stock_movement_no, '') <> ''
           AND (JSON_UNQUOTE(JSON_EXTRACT(r.request_payload, '$.issuedNo')) COLLATE utf8mb4_general_ci) = g.stock_movement_no) AS issued_by_job,
       (SELECT COUNT(*)
          FROM gd_async_job c
         WHERE @IDA > 0
           AND c.tenant_id = '@T'
           AND c.is_deleted = 0 AND c.command = 'COMPLETE_IDA'
           AND c.correlation_id = 'IDA|@IDA'
           AND c.job_status = 'COMPLETED'
           AND JSON_VALID(c.request_payload) AND COALESCE(g.stock_movement_no, '') <> ''
           AND (JSON_UNQUOTE(JSON_EXTRACT(c.request_payload, '$.idaNo')) COLLATE utf8mb4_general_ci) = g.stock_movement_no) AS completed_under
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN sm_item_disassembly g
    ON g.tenant_id = '@T'
   AND g.id = @IDA
   AND g.is_deleted = 0"""
FACTS_COLS = ["db_now", "key_job", "ida_id", "stock_movement_no", "item_disassembly_status", "posted_status", "organization_id", "plant_id", "no_type",
              "ida_v2_job_id", "ida_lock", "open_jobs", "last_job", "link_job", "issued_by_job", "completed_under"]

# the item facts SUBMIT's screens, PREPARE, price.js, batchnum and the engine read (the engine's own conversion rows), ids as text
_ITEM_J = """SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'material_name', i.material_name,
       'stock_control', i.stock_control, 'serial_number_management', i.serial_number_management,
       'item_batch_management', i.item_batch_management, 'batch_number_genaration', i.batch_number_genaration,
       'material_costing_method', i.material_costing_method, 'purchase_unit_price', CAST(i.purchase_unit_price AS CHAR),
       'based_uom', CAST(i.based_uom AS CHAR), 'item_category', i.item_category, 'item_group_id', i.item_group_id,
       'table_uom_conversion', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'base_qty', u.base_qty))
                                   FROM item_mji552rc_sub u
                                  WHERE u.Item_id = i.id AND u.is_deleted = 0), JSON_ARRAY())) AS j
  FROM item i
 WHERE i.tenant_id = '@T'
   AND i.is_deleted = 0"""
# SUBMIT: the form's item ids (a bare digit list from idaIdsSql)
ITEMS = _ITEM_J + """
   AND i.id IN (@ITEMS)"""
# PREPARE: the stored header's item + every stored line's item_selection (varchar, digits only), no dependent read
ITEMS_STORED = _ITEM_J + """
   AND i.id IN (SELECT h.item_id
                  FROM sm_item_disassembly h
                 WHERE h.tenant_id = '@T' AND h.id = @IDA AND h.is_deleted = 0
                UNION
                SELECT CAST(l.item_selection AS UNSIGNED)
                  FROM sm_item_disassembly_tlm8ve69_sub l
                 WHERE l.tenant_id = '@T' AND l.sm_item_disassembly_id = @IDA AND l.is_deleted = 0
                   AND l.item_selection REGEXP '^[0-9]{1,20}$')"""

# PREPARE's LABELS: the bins of the header picks (JSON_TABLE in FROM, never in a correlated EXISTS) and of every stored line
BINS_STORED = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'bin', b.bin_location_combine) AS j
  FROM bin_location b
 WHERE b.tenant_id = '@T'
   AND b.is_deleted = 0
   AND b.id IN (SELECT l.location_id
                  FROM sm_item_disassembly_tlm8ve69_sub l
                 WHERE l.tenant_id = '@T' AND l.sm_item_disassembly_id = @IDA AND l.is_deleted = 0
                UNION
                SELECT CAST(t.loc AS UNSIGNED)
                  FROM sm_item_disassembly h
                  JOIN JSON_TABLE(IF(JSON_VALID(h.temp_qty_data), h.temp_qty_data, '[]'), '$[*]' COLUMNS (loc VARCHAR(32) PATH '$.location_id')) t
                 WHERE h.tenant_id = '@T' AND h.id = @IDA AND h.is_deleted = 0
                   AND t.loc REGEXP '^[0-9]{1,20}$')"""

# the organization's batch_number_config rows, every level (GR C1's bnc read = what GENERATE_BATCH's get-nodes see)
BNC = """SELECT JSON_OBJECT('id', CAST(c.id AS CHAR), 'batch_level_selection', c.batch_level_selection, 'item_id', CAST(c.item_id AS CHAR),
       'item_category_id', CAST(c.item_category_id AS CHAR), 'item_group_id', CAST(c.item_group_id AS CHAR), 'batch_format', c.batch_format,
       'running_number', c.running_number, 'reset_frequency', c.reset_frequency, 'initial_value', c.initial_value, 'last_reset_date', c.last_reset_date,
       'date_format', c.date_format, 'format_preview', c.format_preview, 'organization_id', c.organization_id) AS j
  FROM batch_number_config c
 WHERE c.tenant_id = '@T'
   AND c.organization_id = '@ORG'
   AND c.is_deleted = 0
 ORDER BY c.id"""

_BATCH_J = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'batch_number', b.batch_number, 'material_id', CAST(b.material_id AS CHAR),
       'plant_id', CAST(b.plant_id AS CHAR), 'organization_id', b.organization_id, 'transaction_no', b.transaction_no) AS j
  FROM batch b
 WHERE b.tenant_id = '@T'
   AND b.is_deleted = 0"""
# the organization's live Batch rows (ANY item) holding one of the hex-encoded numbers, compared as utf8mb4_general_ci (case-insensitive,
# trailing spaces ignored): SUBMIT's typed numbers (code_validate's search_batches) and COMMIT D1's planned numbers
BATCH_HOLDERS = _BATCH_J + """
   AND b.organization_id = '@ORG'
   AND b.batch_number IN (SELECT (CONVERT(UNHEX(t.h) USING utf8mb4) COLLATE utf8mb4_general_ci)
                            FROM JSON_TABLE('@HEX', '$[*]' COLUMNS (h VARCHAR(2040) PATH '$')) t)
 ORDER BY b.id"""
_TYPED_LINES = """FROM sm_item_disassembly_tlm8ve69_sub l
                           WHERE l.tenant_id = '@T' AND l.sm_item_disassembly_id = @IDA AND l.is_deleted = 0
                             AND TRIM(COALESCE(l.batch_number, '')) NOT IN ('', '-', 'Auto-generated batch number')"""
_TYPED_RAW = "SELECT l.batch_number\n                            " + _TYPED_LINES
_TYPED_TRIMMED = "SELECT TRIM(l.batch_number)\n                            " + _TYPED_LINES
_TYPED_UNION = "\n                          UNION\n                          "
# PREPARE: live org Batch rows holding a stored typed-shaped number as stored (D1's hex form) or trimmed (SUBMIT's form)
BATCH_TYPED_STORED = _BATCH_J + """
   AND b.organization_id = (SELECT h.organization_id FROM sm_item_disassembly h WHERE h.tenant_id = '@T' AND h.id = @IDA)
   AND b.batch_number IN (""" + _TYPED_RAW + _TYPED_UNION + _TYPED_TRIMMED + """)
 ORDER BY b.id"""
# COMMIT: the Batch rows this job may have inserted (id > job, the IDA's number read from its header row); "ours" is decided in JS
BATCH_OURS = _BATCH_J + """
   AND b.organization_id = '@ORG'
   AND b.id > @JOB
   AND b.transaction_no = (SELECT h.stock_movement_no FROM sm_item_disassembly h WHERE h.tenant_id = '@T' AND h.id = @IDA)
 ORDER BY b.id"""

# COMMIT D4: the stored lines' batch numbers
LINES_BATCH = """SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'batch_number', l.batch_number) AS j
  FROM sm_item_disassembly_tlm8ve69_sub l
 WHERE l.tenant_id = '@T'
   AND l.sm_item_disassembly_id = @IDA
   AND l.is_deleted = 0
 ORDER BY l.id"""

# COMMIT D3: op 1's stored OUT rows - bounded by id > job (no index on operation_effect_key), counted and summed in SQL
OUT_TOTALS = """SELECT COUNT(*) AS n, CAST(COALESCE(SUM(m.total_price), 0) AS CHAR) AS total
  FROM inventory_movement m
 WHERE m.tenant_id = '@T'
   AND m.id > @JOB
   AND m.is_deleted = 0
   AND m.organization_id = '@ORG'
   AND m.movement = 'OUT'
   AND m.transaction_type = 'IDA'
   AND m.trx_no = (SELECT h.stock_movement_no FROM sm_item_disassembly h WHERE h.tenant_id = '@T' AND h.id = @IDA)
   AND m.operation_effect_key LIKE 'IDC|@JOB|I|%'"""

# one engine operation's own rows (IDC|<job>|I or |R): intents, review, and the DONE row's summary (movements = its code-200 results)
OP_STATE = """SELECT (SELECT COUNT(*) FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'IDC|@JOB|@SIDE' AND p.step_name LIKE 'IBA|I|%' AND p.is_deleted = 0) AS intents,
       (SELECT COUNT(*) FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'IDC|@JOB|@SIDE' AND p.step_name = 'IBA|REVIEW' AND p.is_deleted = 0) AS review,
       (SELECT CAST(JSON_EXTRACT(p.result_ref, '$.summary') AS CHAR) FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'IDC|@JOB|@SIDE' AND p.step_name = 'IBA|DONE' AND p.is_deleted = 0
           AND JSON_VALID(p.result_ref)
         ORDER BY p.id DESC LIMIT 1) AS done_summary"""
OP_STATE_COLS = ["intents", "review", "done_summary"]

# the classic IDA_SAVE v7 guard (CONTRACT.md section 11): the stored status only, sm_item_disassembly only, Edit only
CLASSIC_GUARD = """SELECT CAST(h.id AS CHAR) AS ida_id, h.item_disassembly_status
  FROM sm_item_disassembly h
 WHERE h.tenant_id = '@T'
   AND h.id = @IDA
   AND h.is_deleted = 0"""
CLASSIC_GUARD_COLS = ["ida_id", "item_disassembly_status"]

# statement -> its tokens and its returned columns (the smoke / live checks walk this; a "j" statement returns JSON_OBJECT rows)
STATEMENTS = {
    "FP_LINES": (FP_LINES, ["T", "IDA"], ["j"]),
    "FP_HEADER": (FP_HEADER, ["T", "IDA"], ["j"]),
    "OWNER": (OWNER, ["T", "IDA"], OWNER_COLS),
    "ITEMS": (ITEMS, ["T", "ITEMS"], ["j"]),
    "ITEMS_STORED": (ITEMS_STORED, ["T", "IDA"], ["j"]),
    "BINS_STORED": (BINS_STORED, ["T", "IDA"], ["j"]),
    "BNC": (BNC, ["T", "ORG"], ["j"]),
    "BATCH_HOLDERS": (BATCH_HOLDERS, ["T", "ORG", "HEX"], ["j"]),
    "BATCH_TYPED_STORED": (BATCH_TYPED_STORED, ["T", "IDA"], ["j"]),
    "BATCH_OURS": (BATCH_OURS, ["T", "ORG", "JOB", "IDA"], ["j"]),
    "LINES_BATCH": (LINES_BATCH, ["T", "IDA"], ["j"]),
    "OUT_TOTALS": (OUT_TOTALS, ["T", "JOB", "ORG", "IDA"], ["n", "total"]),
    "CLASSIC_GUARD": (CLASSIC_GUARD, ["T", "IDA"], CLASSIC_GUARD_COLS),
}


def facts(sub, T, IDA, KEY, ORG):
    """SUBMIT's facts row; the lock sub-select is filled first (sub leaves no @TOKEN behind); ORG is accepted for the pinned signature"""
    ida_lock = sub(LOCKOBJ, IDA=IDA, T=T)
    return sub(FACTS, KJ=job_obj("k"), OJ=job_obj("o"), XJ=job_obj("x"), YJ=job_obj("y"), IDALOCK=ida_lock, OPEN=OPEN, COMMANDS=COMMANDS, T=T, IDA=IDA,
               KEY=KEY, ORG=ORG)


def op_state(sub, T, JOB, SIDE):
    assert SIDE in ("I", "R"), SIDE
    return sub(OP_STATE, T=T, JOB=JOB, SIDE=SIDE)
