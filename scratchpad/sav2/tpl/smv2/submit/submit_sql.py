"""LOT_V2_SUBMIT SQL (CONTRACT.md sections 7, 14). Filled by build_submit.py with lib/v2build.sub: @T tenant (quoted here); @LOT,
@SLOT, @ITEMS, @PLANTN bare digits; @PLANT, @ORG, @KEY, @JOB quoted (digits, or the key's 8-128 charset - the guard / keys nodes
checked them); @NEED / @DRAFTADD 'YES' / 'NO' (a constant-false WHERE: the read touches no table when it is not needed).
Every read is tenant-scoped; every document / line / step row is is_deleted = 0."""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# code/shared/sql.py under its own module name (another package's "sql" module may already be loaded by build_lot.py)
_spec = importlib.util.spec_from_file_location("lot_shared_sql", os.path.join(HERE, "..", "code", "shared", "sql.py"))
_shared = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_shared)
FP_LINES = _shared.FP_LINES

OPEN = "'QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_LOT', 'REQUIRES_REVIEW'"
JOBOBJ = ("JSON_OBJECT('id', CAST(@A.id AS CHAR), 'job_status', @A.job_status, 'correlation_id', @A.correlation_id, 'progress_percent', @A.progress_percent, "
          "'progress_message', @A.progress_message, 'error_code', @A.error_code, 'error_message', @A.error_message, "
          "'action', IF(JSON_VALID(@A.request_payload), JSON_UNQUOTE(JSON_EXTRACT(@A.request_payload, '$.action')), NULL), "
          "'lot_no', IF(JSON_VALID(@A.request_payload), JSON_UNQUOTE(JSON_EXTRACT(@A.request_payload, '$.lotNo')), NULL))")

# the job of this key; a Draft Add's LOT of this key (lot_idem_key = <key>#<nonce>); the stored LOT (id 0 for an Add) with the
# header fields CHECK_REQUIRED_FIELD reads on a Cancel; its line count, latest lock, open / latest SAVE_LOT jobs, the job its
# lot_v2_job_id names (STATUS when no job carries its correlation); whether its number is the one an earlier SAVE_LOT job of
# this LOT made the platform issue (then no second number is burned)
FACTS = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       (SELECT CAST(@KJ AS CHAR) FROM gd_async_job k
         WHERE k.tenant_id = '@T' AND k.idempotency_key = '@KEY' AND k.is_deleted = 0 ORDER BY k.id DESC LIMIT 1) AS key_job,
       (SELECT CAST(JSON_OBJECT('id', CAST(h.id AS CHAR), 'no', h.stock_movement_no) AS CHAR) FROM sm_location_transfer h
         WHERE '@DRAFTADD' = 'YES' AND h.tenant_id = '@T' AND SUBSTRING_INDEX(h.lot_idem_key, '#', 1) = '@KEY' AND h.is_deleted = 0
         ORDER BY h.id LIMIT 1) AS key_lot,
       CAST(g.id AS CHAR) AS lot_id, g.stock_movement_no, g.stock_movement_status, g.organization_id,
       CAST(g.issuing_operation_faci AS CHAR) AS plant_id, CAST(g.stock_movement_no_type AS CHAR) AS no_type, g.movement_type,
       DATE_FORMAT(g.issue_date, '%Y-%m-%d %H:%i:%s') AS issue_date, g.is_production_order,
       (SELECT COUNT(*) FROM sm_location_transfer_d2c7o1jd_sub l
         WHERE @LOT > 0 AND l.tenant_id = '@T' AND l.sm_location_transfer_id = @LOT AND l.is_deleted = 0
           AND NOT (COALESCE(l.item_bundle_id, '') <> '' AND l.parent_id IS NULL)) AS line_count,
       (SELECT p.step_name FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'SMLT|@LOT' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS last_lock,
       (SELECT CAST(JSON_ARRAYAGG(@OJ) AS CHAR) FROM gd_async_job o
         WHERE @LOT > 0 AND o.tenant_id = '@T' AND o.is_deleted = 0 AND o.command = 'SAVE_LOT' AND o.correlation_id = 'LOT|@LOT' AND o.job_status IN (@OPEN)) AS open_jobs,
       (SELECT CAST(@XJ AS CHAR) FROM gd_async_job x
         WHERE @LOT > 0 AND x.tenant_id = '@T' AND x.is_deleted = 0 AND x.command = 'SAVE_LOT' AND x.correlation_id = 'LOT|@LOT' ORDER BY x.id DESC LIMIT 1) AS last_job,
       CAST(g.lot_v2_job_id AS CHAR) AS lot_v2_job_id,
       (SELECT CAST(@YJ AS CHAR) FROM gd_async_job y
         WHERE y.tenant_id = '@T' AND y.is_deleted = 0 AND y.command = 'SAVE_LOT' AND y.id = CAST(g.lot_v2_job_id AS UNSIGNED)) AS link_job,
       (SELECT COUNT(*) FROM gd_async_job r
         WHERE @LOT > 0 AND r.tenant_id = '@T' AND r.is_deleted = 0 AND r.command = 'SAVE_LOT' AND r.correlation_id = 'LOT|@LOT' AND JSON_VALID(r.request_payload)
           AND COALESCE(g.stock_movement_no, '') <> ''
           AND (JSON_UNQUOTE(JSON_EXTRACT(r.request_payload, '$.issuedNo')) COLLATE utf8mb4_general_ci) = g.stock_movement_no) AS issued_reuse
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN sm_location_transfer g
    ON g.tenant_id = '@T'
   AND g.id = @LOT
   AND g.is_deleted = 0"""
FACTS_COLS = ["db_now", "key_job", "key_lot", "lot_id", "stock_movement_no", "stock_movement_status", "organization_id", "plant_id", "no_type", "movement_type",
              "issue_date", "is_production_order", "line_count", "last_lock", "open_jobs", "last_job", "lot_v2_job_id", "link_job", "issued_reuse"]

# the stored lines' items (COMPLETE / EDIT / CANCEL: @SLOT = the LOT; else 0) besides the form's
STORED_ITEMS = ("SELECT CAST(s.item_selection AS UNSIGNED) FROM sm_location_transfer_d2c7o1jd_sub s WHERE @SLOT > 0 AND s.tenant_id = '@T' AND "
                "s.sm_location_transfer_id = @SLOT AND s.is_deleted = 0 AND s.item_selection REGEXP '^[0-9]{1,20}$'")

# the lines' and entries' items: the eligibility (serial) and WA screens read these flags
ITEMS = """SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'serial_number_management', i.serial_number_management,
       'material_costing_method', i.material_costing_method, 'stock_control', i.stock_control) AS j
  FROM item i
 WHERE i.tenant_id = '@T'
   AND i.is_deleted = 0
   AND (i.id IN (@ITEMS) OR i.id IN (@SITEMS))"""

# costing rows of those items at the LOT's plant + organization, counted per (material, batch) the engine's way (NULL / 0 =
# no batch): the costing-migration screen (pwv2 prepare/sql.py SUBMIT_SQL["cost"]) and the WA-no-row screen
# (GLOBAL_INVENTORY_VALIDATION v11 search_node_GIVWaBatch / GIVWaNoBatch + code_node_hDa6pSw5) are decided from them
COST = """SELECT JSON_OBJECT('t', x.t, 'm', CAST(x.m AS CHAR), 'b', CAST(x.b AS CHAR), 'n', x.n) AS j
  FROM (SELECT 'W' AS t, w.material_id AS m, COALESCE(w.batch_id, 0) AS b, COUNT(*) AS n
          FROM wa_costing_method w
         WHERE w.tenant_id = '@T' AND w.is_deleted = 0 AND w.plant_id = '@PLANT' AND w.organization_id = '@ORG'
           AND (w.material_id IN (@ITEMS) OR w.material_id IN (@SITEMS))
         GROUP BY w.material_id, COALESCE(w.batch_id, 0)
        UNION ALL
        SELECT 'F' AS t, f.material_id AS m, COALESCE(f.batch_id, 0) AS b, COUNT(*) AS n
          FROM fifo_costing_history f
         WHERE f.tenant_id = '@T' AND f.is_deleted = 0 AND f.plant_id = @PLANTN AND f.organization_id = '@ORG'
           AND (f.material_id IN (@ITEMS) OR f.material_id IN (@SITEMS))
         GROUP BY f.material_id, COALESCE(f.batch_id, 0)) x"""

FP_ANCHOR_SELECT = "'item_bundle_id', l.item_bundle_id) AS j"
FP_ANCHOR_WHERE = " WHERE l.tenant_id = '@T'"
assert FP_LINES.count(FP_ANCHOR_SELECT) == 1 and FP_LINES.count(FP_ANCHOR_WHERE) == 1


def fp_lines(extra_select=""):
    """FP_LINES with the fingerprint's columns exactly as shared (code/shared/sql.py), a constant '@NEED' gate, and optional
    extra JSON keys appended after them (the fingerprint ignores keys it does not use)"""
    t = FP_LINES.replace(FP_ANCHOR_WHERE, " WHERE '@NEED' = 'YES' AND l.tenant_id = '@T'")
    if extra_select:
        t = t.replace(FP_ANCHOR_SELECT, "'item_bundle_id', l.item_bundle_id, " + extra_select + ") AS j")
    return t


# the stored lines before the writes (COMPLETE / EDIT / CANCEL): the fingerprint, the stored-side eligibility, the reconcile
STORED = fp_lines("'temp_hu_data', l.temp_hu_data, 'is_serialized_item', l.is_serialized_item")

# after the document write (DIRECT / STAGE): the header this job wrote (lot_v2_job_id) and its lines
HDR_BY_JOB = """SELECT CAST(g.id AS CHAR) AS id, g.stock_movement_no, g.stock_movement_status, CAST(g.lot_v2_job_id AS CHAR) AS lot_v2_job_id
  FROM sm_location_transfer g
 WHERE '@NEED' = 'YES'
   AND g.tenant_id = '@T'
   AND g.lot_v2_job_id = '@JOB'
   AND g.is_deleted = 0
 ORDER BY g.id"""
HDR_COLS = ["id", "stock_movement_no", "stock_movement_status", "lot_v2_job_id"]
LOT_BY_JOB = "(SELECT h.id FROM sm_location_transfer h WHERE h.tenant_id = '@T' AND h.lot_v2_job_id = '@JOB' AND h.is_deleted = 0 ORDER BY h.id LIMIT 1)"

# a Draft Add's rows of this key (twins): the oldest wins (grv2 phase2b created/keydup.sql)
DRAFT_DUP = """SELECT CAST(g.id AS CHAR) AS id, g.stock_movement_no, g.lot_idem_key
  FROM sm_location_transfer g
 WHERE g.tenant_id = '@T'
   AND SUBSTRING_INDEX(g.lot_idem_key, '#', 1) = '@KEY'
   AND g.is_deleted = 0
 ORDER BY g.id"""
DRAFT_DUP_COLS = ["id", "stock_movement_no", "lot_idem_key"]

# the job of this key, its LOT's status / job link, the LOT's latest lock, its S payload parts (grv2 sql_node_RSback)
BACK = """SELECT CAST(j.id AS CHAR) AS job_id, j.job_status, j.correlation_id,
       g.stock_movement_status, g.stock_movement_no, CAST(g.lot_v2_job_id AS CHAR) AS lot_v2_job_id,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('SMLT|', SUBSTRING(j.correlation_id, 5)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       (SELECT COUNT(*) FROM gd_publish_step q
         WHERE q.tenant_id = j.tenant_id AND q.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci) AND q.step_name LIKE 'S|%' AND q.is_deleted = 0) AS parts
  FROM gd_async_job j
  LEFT JOIN sm_location_transfer g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 5) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.idempotency_key = '@KEY' AND j.is_deleted = 0
 ORDER BY j.id DESC LIMIT 1"""
BACK_COLS = ["job_id", "job_status", "correlation_id", "stock_movement_status", "stock_movement_no", "lot_v2_job_id", "lock_ref", "parts"]


def facts(sub, T, LOT, KEY, DRAFTADD):
    return sub(FACTS, KJ=JOBOBJ.replace("@A", "k"), OJ=JOBOBJ.replace("@A", "o"), XJ=JOBOBJ.replace("@A", "x"), YJ=JOBOBJ.replace("@A", "y"), OPEN=OPEN, T=T, LOT=LOT,
               KEY=KEY, DRAFTADD=DRAFTADD)


def items(sub, T, ITEMS_, SLOT):
    return sub(ITEMS, T=T, ITEMS=ITEMS_, SITEMS=sub(STORED_ITEMS, T=T, SLOT=SLOT))


def cost(sub, T, ITEMS_, SLOT, PLANT, ORG):
    return sub(COST, T=T, ITEMS=ITEMS_, SITEMS=sub(STORED_ITEMS, T=T, SLOT=SLOT), PLANT=PLANT, PLANTN=PLANT, ORG=ORG)


def stored(sub, T, LOT, NEED):
    return sub(STORED, T=T, LOT=LOT, NEED=NEED)


def lines_by_job(sub, T, JOB, NEED):
    return sub(fp_lines(), T=T, LOT=sub(LOT_BY_JOB, T=T, JOB=JOB), NEED=NEED)
