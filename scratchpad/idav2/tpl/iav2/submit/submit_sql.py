"""IA_V2_SUBMIT SQL (CONTRACT.md sections 7 and 14). Filled by build_submit.py with lib/v2build.sub: '@T' tenant and '@ORG' /
'@KEY' / '@JOB' / '@PLANT' quoted here; @IA / @PLANTN bare digits; @ITEMS a bare digit list ("0" first); '@PAIRS', '@BALS',
'@BATCHBALS' ONE JSON text of digit arrays unpacked by JSON_TABLE (the engine guard's balTuplesJson method). The guard / keys
nodes checked every value (digits, the key's charset). Every read is tenant-scoped with is_deleted = 0; no business row caps.
FACTS, ITEMS, FP_HEADER and FP_LINES are code/shared/sql.py's, unchanged."""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# code/shared/sql.py under its own module name (another package's "sql" module may already be loaded by build_ia.py)
_spec = importlib.util.spec_from_file_location("ia_shared_sql_submit", os.path.join(HERE, "..", "code", "shared", "sql.py"))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)
FACTS_COLS = S.FACTS_COLS

# the costing-migration screen: copy of scratchpad/pwv2/prepare/sql.py SUBMIT_SQL["cost"] keyed on the stock picks' (material,
# batch or 0) AND the parent's (item, 0) at the header plant + organization (review 8); the flagged keys only
COST = """SELECT JSON_OBJECT('material_id', CAST(k.m AS CHAR), 'batch_id', CAST(k.b AS CHAR), 'method', i.material_costing_method,
       'fifo', COALESCE(f.n, 0), 'wa', COALESCE(w.n, 0)) AS j
  FROM (SELECT DISTINCT jt.m, jt.b FROM JSON_TABLE('@PAIRS', '$[*]' COLUMNS (m BIGINT PATH '$[0]', b BIGINT PATH '$[1]')) jt) k
  JOIN item i
    ON i.id = k.m
   AND i.tenant_id = '@T'
   AND i.is_deleted = 0
   AND i.stock_control <> 0
  LEFT JOIN (SELECT f.material_id AS m, COALESCE(f.batch_id, 0) AS b, COUNT(*) AS n
               FROM fifo_costing_history f
              WHERE f.tenant_id = '@T'
                AND f.is_deleted = 0
                AND f.plant_id = @PLANTN
                AND f.organization_id = '@ORG'
                AND f.material_id IN (@ITEMS)
              GROUP BY f.material_id, COALESCE(f.batch_id, 0)) f
    ON f.m = k.m
   AND f.b = k.b
  LEFT JOIN (SELECT w.material_id AS m, COALESCE(w.batch_id, 0) AS b, COUNT(*) AS n
               FROM wa_costing_method w
              WHERE w.tenant_id = '@T'
                AND w.is_deleted = 0
                AND w.plant_id = '@PLANT'
                AND w.organization_id = '@ORG'
                AND w.material_id IN (@ITEMS)
              GROUP BY w.material_id, COALESCE(w.batch_id, 0)) w
    ON w.m = k.m
   AND w.b = k.b
 WHERE (COALESCE(f.n, 0) > 0 AND COALESCE(w.n, 0) > 0)
    OR (i.material_costing_method = 'First In First Out' AND COALESCE(f.n, 0) = 0 AND COALESCE(w.n, 0) > 0)
    OR (i.material_costing_method = 'Weighted Average' AND COALESCE(w.n, 0) = 0 AND COALESCE(f.n, 0) > 0)
 ORDER BY k.m, k.b"""

# the WA screen (review 8): a stock pick of a Weighted Average item without a wa_costing_method row at the plant + organization
# (+ its batch for a batch pick) = GLOBAL_INVENTORY_VALIDATION v11 search_node_GIVWaBatch / GIVWaNoBatch; the flagged keys only
WA = """SELECT JSON_OBJECT('material_id', CAST(k.m AS CHAR), 'batch_id', CAST(k.b AS CHAR), 'material_code', i.material_code) AS j
  FROM (SELECT DISTINCT jt.m, jt.b FROM JSON_TABLE('@PAIRS', '$[*]' COLUMNS (m BIGINT PATH '$[0]', b BIGINT PATH '$[1]')) jt) k
  JOIN item i
    ON i.id = k.m
   AND i.tenant_id = '@T'
   AND i.is_deleted = 0
   AND i.stock_control <> 0
   AND i.material_costing_method = 'Weighted Average'
 WHERE NOT EXISTS (SELECT 1
                     FROM wa_costing_method w
                    WHERE w.tenant_id = '@T'
                      AND w.is_deleted = 0
                      AND w.material_id = k.m
                      AND w.plant_id = '@PLANT'
                      AND w.organization_id = '@ORG'
                      AND (k.b = 0 OR w.batch_id = k.b))
 ORDER BY k.m, k.b"""

# the duplicate-balance screen (the engine's DUPLICATE_BALANCE): more than one item_balance row per (material, location) at the
# plant + organization for a pick or the receipt bin, or more than one item_batch_balance row per (material, location, batch)
DUP = """SELECT x.j
  FROM (SELECT JSON_OBJECT('t', 'B', 'material_id', CAST(b.material_id AS CHAR), 'location_id', CAST(b.location_id AS CHAR), 'batch_id', '',
               'n', COUNT(*)) AS j
          FROM item_balance b
         WHERE b.tenant_id = '@T'
           AND b.organization_id = '@ORG'
           AND b.is_deleted = 0
           AND b.plant_id = @PLANTN
           AND b.material_id IN (@ITEMS)
           AND (b.material_id, b.location_id) IN (SELECT jt.m, jt.l FROM JSON_TABLE('@BALS', '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]')) jt)
         GROUP BY b.material_id, b.location_id
        HAVING COUNT(*) > 1
        UNION ALL
        SELECT JSON_OBJECT('t', 'T', 'material_id', CAST(b.material_id AS CHAR), 'location_id', CAST(b.location_id AS CHAR),
               'batch_id', CAST(b.batch_id AS CHAR), 'n', COUNT(*)) AS j
          FROM item_batch_balance b
         WHERE b.tenant_id = '@T'
           AND b.organization_id = '@ORG'
           AND b.is_deleted = 0
           AND b.plant_id = @PLANTN
           AND b.material_id IN (@ITEMS)
           AND (b.material_id, b.location_id, b.batch_id) IN (SELECT jt.m, jt.l, jt.b
                                                                FROM JSON_TABLE('@BATCHBALS', '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]',
                                                                                                             b BIGINT PATH '$[2]')) jt)
         GROUP BY b.material_id, b.location_id, b.batch_id
        HAVING COUNT(*) > 1) x"""

# after the document write: the IA(s) this job wrote (ia_v2_job_id, varchar: a quoted digit string)
HDR_BY_JOB = """SELECT CAST(h.id AS CHAR) AS id, h.stock_movement_no, h.item_assembly_status, h.ia_v2_job_id AS ia_v2_job_id
  FROM sm_item_assembly h
 WHERE h.tenant_id = '@T'
   AND h.ia_v2_job_id = '@JOB'
   AND h.is_deleted = 0
 ORDER BY h.id"""
HDR_COLS = ["id", "stock_movement_no", "item_assembly_status", "ia_v2_job_id"]
IA_BY_JOB = ("(SELECT x.id FROM sm_item_assembly x\n"
             "                 WHERE x.tenant_id = '@T' AND x.ia_v2_job_id = '@JOB' AND x.is_deleted = 0 ORDER BY x.id LIMIT 1)")

# the job of this key, its IA's status / number / job link, the IA's latest IAC| lock (grv2 sql_node_RSback)
BACK = """SELECT CAST(j.id AS CHAR) AS job_id, j.job_status, j.correlation_id,
       g.item_assembly_status, g.stock_movement_no, g.ia_v2_job_id AS ia_v2_job_id,
       (SELECT p.result_ref
          FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id
           AND p.job_id = (CONCAT('IAC|', SUBSTRING(j.correlation_id, 4)) COLLATE utf8mb4_general_ci)
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  LEFT JOIN sm_item_assembly g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^IA[|][0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
   AND g.is_deleted = 0
 WHERE j.tenant_id = '@T'
   AND j.idempotency_key = '@KEY'
   AND j.is_deleted = 0
 ORDER BY j.id DESC LIMIT 1"""
BACK_COLS = ["job_id", "job_status", "correlation_id", "item_assembly_status", "stock_movement_no", "ia_v2_job_id", "lock_ref"]


def facts(sub, T, IA, KEY, ORG):
    return S.facts(sub, T=T, IA=IA, KEY=KEY, ORG=ORG)


def items(sub, T, ITEMS_):
    return sub(S.ITEMS, T=T, ITEMS=ITEMS_)


def cost(sub, T, PAIRS, ITEMS_, PLANT, ORG):
    return sub(COST, T=T, PAIRS=PAIRS, ITEMS=ITEMS_, PLANT=PLANT, PLANTN=PLANT, ORG=ORG)


def wa(sub, T, PAIRS, PLANT, ORG):
    return sub(WA, T=T, PAIRS=PAIRS, PLANT=PLANT, ORG=ORG)


def dup(sub, T, BALS, BATCHBALS, ITEMS_, PLANT, ORG):
    return sub(DUP, T=T, BALS=BALS, BATCHBALS=BATCHBALS, ITEMS=ITEMS_, PLANTN=PLANT, ORG=ORG)


def hdr_by_job(sub, T, JOB):
    return sub(HDR_BY_JOB, T=T, JOB=JOB)


def header_by_job(sub, T, JOB):
    """code/shared/sql.py FP_HEADER of the IA this job wrote"""
    return sub(S.FP_HEADER, T=T, IA=sub(IA_BY_JOB, T=T, JOB=JOB))


def lines_by_job(sub, T, JOB):
    """code/shared/sql.py FP_LINES of the IA this job wrote"""
    return sub(S.FP_LINES, T=T, IA=sub(IA_BY_JOB, T=T, JOB=JOB))


def back(sub, T, KEY):
    return sub(BACK, T=T, KEY=KEY)
