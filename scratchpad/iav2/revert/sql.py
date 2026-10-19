"""Revert V2 SQL (CONTRACT.md RV4-RV7; section 14 conventions). Filled with lib/v2build.sub: '@T' hand-quoted, @IA / @JOB bare
digits, id lists bare digit lists ("0" first = none), '@KEY' / '@ORG' quoted (the guards checked them). No free text reaches SQL:
the IA number and organization are read from the header row itself. Shared fragments come from code/shared/sql.py (FACTS, OWNER,
FP_HEADER, ITEMS, RV_MOVES). The classic's three costing reads are copied from base/IA_REVERT.v4.json with the tenant added
(classic_sql() asserts the copy). Read-only check: lib/sqlcheck.py with test/revert/sql_values.json."""
import importlib.util
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(HERE)


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


SH = _load(os.path.join(IAV2, "code", "shared", "sql.py"), "iarv_shared_sql")
BASE = os.path.join(IAV2, "base", "IA_REVERT.v4.json")
IA_TABLE = "Item Assembly:Table:2098256587713404929"
BATCH_TABLE = "Batch:Table:1902719754154655746"
FIFO_TABLE = "FIFO Costing History:Table:1902947165008400386"
WA_TABLE = "Weighted Average Costing History:Table:1902948453171433474"
LOCK_TABLE = "Inventory Balance Lock:Table:2105132021358956546"
# the one COST-lock owner of a revert job (CONTRACT.md RV1 / RV7 binding 2): written here once, used twice by LK_RELEASE; the
# JS side is code/shared iaRvCostOwner(jobId) in v2_lock_keys.js and v2_lock_release.js (test/revert asserts all four agree)
COST_OWNER = "IAV|@JOB|C"
ENGINE_OP = "IAV|@JOB"


def _nodes(path):
    out = {}

    def walk(ns):
        for n in ns or []:
            out[n["id"]] = n
            walk(n.get("blocks"))
    walk(json.load(open(path, encoding="utf-8"))["nodes"])
    return out


def classic_sql():
    """sql_node_iaRvFifo / _Wa / _CostCounts of IA_REVERT v4 with the session tenant added after each WHERE / FROM line and the
    classic's prep placeholders re-pointed at @-tokens (filled by the caller from Revert V2's own digit-checked prep node)"""
    nodes = _nodes(BASE)
    rep = {"{{node:code_node_iaRvPrep.data.iaIdSql}}": "@IASQL", "{{node:code_node_iaRvPrep.data.orgSql}}": "@ORG",
           "{{node:code_node_iaRvPrep.data.plantIdSql}}": "@PLANT", "{{node:code_node_iaRvPrep.data.assembledIdsCsv}}": "@ASSEMBLED",
           "{{node:code_node_iaRvPrep.data.itemIdsCsv}}": "@ITEMS"}
    out = {}
    for key, nid, alias in (("FIFO", "sql_node_iaRvFifo", "f"), ("WA", "sql_node_iaRvWa", "w"), ("COSTCOUNTS", "sql_node_iaRvCostCounts", None)):
        text = nodes[nid]["data"]["script"]["code"]
        for a, b in rep.items():
            text = text.replace(a, b)
        assert "{{" not in text, nid
        if alias:
            # one WHERE: the tenant first
            assert text.count("WHERE ") == 1, nid
            text = text.replace("WHERE ", "WHERE %s.tenant_id = '@T'\n  AND " % alias, 1)
        else:
            # the UNION of two SELECTs (FIFO alias f, WA alias w): the tenant in both WHEREs
            assert text.count("WHERE ") == 2 and "FROM fifo_costing_history f\nWHERE " in text and "FROM wa_costing_method w\nWHERE " in text, nid
            text = text.replace("FROM fifo_costing_history f\nWHERE ", "FROM fifo_costing_history f\nWHERE f.tenant_id = '@T'\n  AND ", 1)
            text = text.replace("FROM wa_costing_method w\nWHERE ", "FROM wa_costing_method w\nWHERE w.tenant_id = '@T'\n  AND ", 1)
        out[key] = (text, [r["name"] for r in nodes[nid]["data"]["response_json"]])
    return out


# ---------------------------------------------------------------------------------------------------------------- shared reads
# the IA's Batch rows as search_node_iaRvBatch reads them (transaction_no = the number, organization = the IA's; no material
# filter: prep / build pick the assembled item's), id order
BATCH_ROWS = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'batch_number', b.batch_number, 'material_id', CAST(b.material_id AS CHAR),
       'plant_id', CAST(b.plant_id AS CHAR), 'organization_id', b.organization_id, 'transaction_no', b.transaction_no) AS j
  FROM batch b
  JOIN sm_item_assembly h
    ON h.tenant_id = '@T'
   AND h.id = @IA
   AND h.is_deleted = 0
 WHERE b.tenant_id = '@T'
   AND b.transaction_no = h.stock_movement_no
   AND b.organization_id = h.organization_id
   AND b.is_deleted = 0
 ORDER BY b.id"""

# SUBMIT's eligibility: the serial-numbered items among the items of the IA's movement rows (RV_MOVES's filter)
SERIAL = """SELECT CAST(i.id AS CHAR) AS id
  FROM item i
 WHERE i.tenant_id = '@T'
   AND i.is_deleted = 0
   AND i.serial_number_management = 1
   AND i.id IN (SELECT m.item_id
                  FROM inventory_movement m
                 WHERE m.tenant_id = '@T'
                   AND m.id > @IA
                   AND m.organization_id = (SELECT h.organization_id FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA)
                   AND m.trx_no = (SELECT h.stock_movement_no FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA)
                   AND m.transaction_type IN ('IA', 'IA-R')
                   AND m.is_deleted = 0)"""

# SUBMIT's read-back: the job of this key
KEY_JOB = """SELECT CAST(j.id AS CHAR) AS job_id, j.job_status, j.command, j.correlation_id, j.line_count
  FROM gd_async_job j
 WHERE j.tenant_id = '@T'
   AND j.idempotency_key = '@KEY'
   AND j.is_deleted = 0
 ORDER BY j.id DESC
 LIMIT 1"""
KEY_JOB_COLS = ["job_id", "job_status", "command", "correlation_id", "line_count"]

# PREPARE's job (+ DB clock, lease flag, request)
P_JOB = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.lease_owner, (j.lease_expires_at > n.t) AS lease_live, j.row_version, j.attempt_count,
       j.idempotency_key, j.correlation_id, j.request_payload, j.is_deleted
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB"""
P_JOB_COLS = ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key", "correlation_id",
              "request_payload", "is_deleted"]
P_BACK = "SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.progress_message, j.error_code, j.error_message FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB"
P_BACK_COLS = ["id", "job_status", "progress_message", "error_code", "error_message"]

# PREPARE round 2: search_node_iaRvItemBal / _BatchBal as SQL (the columns code_node_iaRvBuild reads), uncapped
ITEM_BAL = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'material_id', CAST(b.material_id AS CHAR), 'location_id', CAST(b.location_id AS CHAR),
       'plant_id', CAST(b.plant_id AS CHAR), 'organization_id', b.organization_id, 'unrestricted_qty', b.unrestricted_qty, 'reserved_qty', b.reserved_qty,
       'block_qty', b.block_qty, 'qualityinsp_qty', b.qualityinsp_qty, 'intransit_qty', b.intransit_qty, 'balance_quantity', b.balance_quantity) AS j
  FROM item_balance b
 WHERE b.tenant_id = '@T'
   AND b.material_id IN (@ASSEMBLED)
   AND b.plant_id = @PLANT
   AND b.organization_id = '@ORG'
   AND b.is_deleted = 0
 ORDER BY b.id"""
BATCH_BAL = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'material_id', CAST(b.material_id AS CHAR), 'location_id', CAST(b.location_id AS CHAR),
       'batch_id', CAST(b.batch_id AS CHAR), 'plant_id', CAST(b.plant_id AS CHAR), 'organization_id', b.organization_id, 'unrestricted_qty', b.unrestricted_qty,
       'reserved_qty', b.reserved_qty, 'block_qty', b.block_qty, 'qualityinsp_qty', b.qualityinsp_qty, 'intransit_qty', b.intransit_qty,
       'balance_quantity', b.balance_quantity) AS j
  FROM item_batch_balance b
 WHERE b.tenant_id = '@T'
   AND b.batch_id IN (@BATCHES)
   AND b.plant_id = @PLANT
   AND b.organization_id = '@ORG'
   AND b.is_deleted = 0
 ORDER BY b.id"""
# the bins of the live rows (LABELS)
BINS = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'bin_location_combine', b.bin_location_combine) AS j
  FROM bin_location b
 WHERE b.tenant_id = '@T'
   AND b.id IN (@BINS)
   AND b.is_deleted = 0"""

# ---------------------------------------------------------------------------------------------------------------- COMMIT
# 30-minute lease, not the template's 10: the engine op runs ~0.29 s per distinct row (ruling 11)
C_JOB = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 30 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.progress_percent, j.progress_message, j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at, j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live, (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted, j.line_count,
       IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB"""
C_JOB_COLS = ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
              "lease_owner", "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id",
              "is_deleted", "line_count", "prev_status"]
C_STEPS = """SELECT st.step_name, st.step_status, DATE_FORMAT(st.finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at
  FROM gd_publish_step st
 WHERE st.tenant_id = '@T'
   AND st.job_id = '@JOB'
   AND st.step_name REGEXP '^V[0-9]_'
   AND st.is_deleted = 0"""
C_STEPS_COLS = ["step_name", "step_status", "finished_at"]
C_PAYLOAD = "SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB"
# the IA of the job's correlation: its status, job link and latest IAC| LOCK row (section 4 ownership)
C_IA = """SELECT CAST(g.id AS CHAR) AS ia_id, g.item_assembly_status, g.ia_v2_job_id AS ia_v2_job_id, g.stock_movement_no,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('IAC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN sm_item_assembly g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.id = @JOB AND j.correlation_id REGEXP '^IA\\\\|[0-9]{1,20}$'"""
C_IA_COLS = ["ia_id", "item_assembly_status", "ia_v2_job_id", "stock_movement_no", "lock_ref"]
C_OWN = "SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB"
C_PART = """SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' AND st.step_name LIKE CONCAT('@PFX', '@NAME|%')
   AND st.is_deleted = 0 ORDER BY st.step_name"""
C_INTENTS = ("SELECT COUNT(*) AS intents FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '" + ENGINE_OP + "' AND st.step_name LIKE 'IBA|I|%' "
             "AND st.is_deleted = 0")
# fix wave R2: any intent or DONE row of the engine operation = it may have moved stock (a phase-A FAIL becomes a review)
C_OPS = ("SELECT COUNT(*) AS op_rows FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '" + ENGINE_OP + "' "
         "AND (st.step_name LIKE 'IBA|I|%' OR st.step_name = 'IBA|DONE') AND st.is_deleted = 0")
C_FIFO = """SELECT JSON_OBJECT('id', CAST(f.id AS CHAR), 'material_id', CAST(f.material_id AS CHAR), 'fifo_initial_quantity', f.fifo_initial_quantity,
       'fifo_available_quantity', f.fifo_available_quantity, 'is_deleted', f.is_deleted) AS j
  FROM fifo_costing_history f
 WHERE f.tenant_id = '@T' AND f.id IN (@IDS)"""
C_WA = """SELECT JSON_OBJECT('id', CAST(w.id AS CHAR), 'material_id', CAST(w.material_id AS CHAR), 'batch_id', CAST(w.batch_id AS CHAR), 'wa_quantity', w.wa_quantity,
       'wa_cost_price', w.wa_cost_price, 'is_deleted', w.is_deleted) AS j
  FROM wa_costing_method w
 WHERE w.tenant_id = '@T' AND w.id IN (@IDS)"""
C_BATCH = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'is_deleted', b.is_deleted) AS j
  FROM batch b
 WHERE b.tenant_id = '@T' AND b.id IN (@IDS)"""
# V4: the header's status / posted status and its lock now
C_IA_NOW = """SELECT CAST(h.id AS CHAR) AS ia_id, h.item_assembly_status, h.posted_status, h.ia_v2_job_id AS ia_v2_job_id,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'IAC|@IA' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM sm_item_assembly h
 WHERE h.tenant_id = '@T'
   AND h.id = @IA
   AND h.is_deleted = 0"""
C_IA_NOW_COLS = ["ia_id", "item_assembly_status", "posted_status", "ia_v2_job_id", "lock_ref"]
# V2 COST locks: INVENTORY_BULK_APPLY's lock reads (sql_node_IBlk1 / 2 / 3) on V2's keys (tpl/grrv build_grrv.py lk1-lk3); the
# release reads by owner (lkrel): the owner literal twice - owned now, or cleared without its GIVE
LK_WHERE = """  FROM inventory_balance_lock
 WHERE tenant_id = '@T'
   AND organization_id = '@ORG'
   AND lock_key IN (SELECT jt.k FROM JSON_TABLE('@KEYS', '$[*]' COLUMNS (k VARCHAR(128) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) jt)"""
LK1 = "SELECT CAST(id AS CHAR) AS id, lock_key, is_deleted\n" + LK_WHERE + "\n ORDER BY lock_key"
LK1_COLS = ["id", "lock_key", "is_deleted"]
LK2 = ("SELECT CAST(id AS CHAR) AS id, lock_key, free_token, owner_operation_id, last_owner_operation_id,\n       DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now\n"
       + LK_WHERE + "\n   AND is_deleted = 0\n ORDER BY lock_key")
LK2_COLS = ["id", "lock_key", "free_token", "owner_operation_id", "last_owner_operation_id", "db_now"]
LK3 = "SELECT CAST(id AS CHAR) AS id, lock_key, free_token, owner_operation_id\n" + LK_WHERE + "\n   AND is_deleted = 0"
LK3_COLS = ["id", "lock_key", "free_token", "owner_operation_id"]
LK_RELEASE = """SELECT CAST(id AS CHAR) AS id, lock_key, free_token, owner_operation_id, last_owner_operation_id, lock_version,
       DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now
  FROM inventory_balance_lock
 WHERE tenant_id = '@T'
   AND organization_id = '@ORG'
   AND balance_type = 'COST'
   AND free_token = 0
   AND (owner_operation_id = '""" + COST_OWNER + """' OR (COALESCE(owner_operation_id, '') = '' AND last_owner_operation_id = '""" + COST_OWNER + """'))
   AND is_deleted = 0
 ORDER BY lock_key"""
LK_RELEASE_COLS = ["id", "lock_key", "free_token", "owner_operation_id", "last_owner_operation_id", "lock_version", "db_now"]


def owner_literals(sql_text):
    """the two owner literals of a filled LK_RELEASE (test/revert: they must equal the JS opKey and the release op)"""
    return re.findall(r"owner_operation_id = '([^']*)'", sql_text)
