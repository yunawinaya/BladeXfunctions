"""SA_V2_SUBMIT SQL (CONTRACT.md §2, §3, §4, §7, §14). Filled by build_submit.py with lib/v2build.sub: @T tenant (quoted here);
@SA, @SC, @SSA, @ITEMS, @BATCHES bare digits / digit lists ("0" = none); @ORG, @KEY, @JOB quoted (digits, or the key's 8-128
charset - the guard / keys nodes checked them); @NEED 'YES' / 'NO' (a constant-false WHERE: the read touches no table when it is
not needed). Copied from tpl/smv2/submit/submit_sql.py and de-LOT-ed (SA| offset 4, SAC|, SCR|, COMPLETE_SA).
Every read is tenant-scoped; every document / line / step row is is_deleted = 0; no business row caps (LIMIT 1 only for "the
latest X")."""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# code/shared/sql.py under its own module name (another package's "sql" module may already be loaded by build_sa.py)
_spec = importlib.util.spec_from_file_location("sa_shared_sql", os.path.join(HERE, "..", "code", "shared", "sql.py"))
_shared = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_shared)
FP_SA_LINES = _shared.FP_SA_LINES
FP_SC_LINES = _shared.FP_SC_LINES

OPEN = "'QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_SA', 'REQUIRES_REVIEW'"
# one COMPLETE_SA job as the entry / STATUS answer reads it (the request's action / saNo / scId ride along)
JOBOBJ = ("JSON_OBJECT('id', CAST(@A.id AS CHAR), 'job_status', @A.job_status, 'correlation_id', @A.correlation_id,\n"
          "                   'progress_percent', @A.progress_percent, 'progress_message', @A.progress_message,\n"
          "                   'error_code', @A.error_code, 'error_message', @A.error_message, 'line_count', @A.line_count,\n"
          "                   'action', IF(JSON_VALID(@A.request_payload), JSON_UNQUOTE(JSON_EXTRACT(@A.request_payload, '$.action')), NULL),\n"
          "                   'sa_no', IF(JSON_VALID(@A.request_payload), JSON_UNQUOTE(JSON_EXTRACT(@A.request_payload, '$.saNo')), NULL),\n"
          "                   'sc_id', IF(JSON_VALID(@A.request_payload), JSON_UNQUOTE(JSON_EXTRACT(@A.request_payload, '$.scId')), NULL))")
# the latest LOCK|n row of a document lock (SAC|<sa> / SCR|<sc>): its step name, its key, whether it is younger than 120 s (DB
# clock: started_at is written from db_now) and the status of the job that key made (NULL = no job yet). A young lock whose
# job is missing or open belongs to a submit still in flight -> BUSY (closes the window between its lock and its job insert)
LOCKOBJ = ("SELECT CAST(JSON_OBJECT('step', p.step_name, 'ref', p.result_ref,\n"
           "                            'young', (p.started_at > n.t - INTERVAL 120 SECOND),\n"
           "                            'job', (SELECT q.job_status FROM gd_async_job q\n"
           "                                     WHERE q.tenant_id = p.tenant_id AND q.idempotency_key = p.result_ref AND q.is_deleted = 0\n"
           "                                     ORDER BY q.id DESC LIMIT 1)) AS CHAR)\n"
           "          FROM gd_publish_step p\n"
           "         WHERE @COND\n"
           "           AND p.tenant_id = '@T'\n"
           "           AND p.job_id = @JOBID\n"
           "           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0\n"
           "         ORDER BY p.id DESC LIMIT 1")
# FORM: the Stock Count an SA completion would mark Adjusted (A3 parity) - the form's stock_count_id (@FSC, digit-checked by the
# guard), else the stored SA's; 0 = none
FSC = "IF(@FSC > 0, @FSC,\n                  COALESCE(g.stock_count_id, 0))"
SCJOB = ("AND JSON_VALID(@A.request_payload)\n"
         "           AND (JSON_UNQUOTE(JSON_EXTRACT(@A.request_payload, '$.scId')) COLLATE utf8mb4_general_ci) = '@SC'")

# The job of this key (any source); FORM: the stored SA (@SA = its id, 0 for an Add / a REVIEW) with its number, status, number
# rule, plant, organization, stock count and job link, its latest SAC lock, its open / latest COMPLETE_SA jobs, the job its
# sa_v2_job_id names (STATUS when no job carries its correlation), and whether its number is the one an earlier COMPLETE_SA job
# of this SA made the platform issue (then no second number is burned); REVIEW: the stored SC (@SC, 0 for a FORM) with its
# statuses, a Processing SA made from it, the open / latest COMPLETE_SA jobs whose request names it, its latest SCR lock; FORM with a
# stock_count_id (the form's @FSC, else the stored SA's): ANOTHER Processing SA of that SC, its open REVIEW jobs, its latest SCR lock
# (a completion must not race a background review of the same count: SA_SC_BUSY)
FACTS = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       (SELECT CAST(@KJ AS CHAR)
          FROM gd_async_job k
         WHERE k.tenant_id = '@T'
           AND k.idempotency_key = '@KEY'
           AND k.is_deleted = 0
         ORDER BY k.id DESC LIMIT 1) AS key_job,
       CAST(g.id AS CHAR) AS sa_id, g.adjustment_no, g.stock_adjustment_status, g.organization_id,
       CAST(g.plant_id AS CHAR) AS plant_id, CAST(g.adjustment_no_type AS CHAR) AS no_type, CAST(g.stock_count_id AS CHAR) AS stock_count_id,
       CAST(g.sa_v2_job_id AS CHAR) AS sa_v2_job_id,
       (@SALOCK) AS sa_lock,
       (SELECT CAST(JSON_ARRAYAGG(@OJ) AS CHAR)
          FROM gd_async_job o
         WHERE @SA > 0
           AND o.tenant_id = '@T'
           AND o.is_deleted = 0 AND o.command = 'COMPLETE_SA'
           AND o.correlation_id = 'SA|@SA'
           AND o.job_status IN (@OPEN)) AS open_jobs,
       (SELECT CAST(@XJ AS CHAR)
          FROM gd_async_job x
         WHERE @SA > 0
           AND x.tenant_id = '@T'
           AND x.is_deleted = 0 AND x.command = 'COMPLETE_SA'
           AND x.correlation_id = 'SA|@SA'
         ORDER BY x.id DESC LIMIT 1) AS last_job,
       (SELECT CAST(@YJ AS CHAR)
          FROM gd_async_job y
         WHERE y.tenant_id = '@T'
           AND y.is_deleted = 0 AND y.command = 'COMPLETE_SA'
           AND y.id = CAST(g.sa_v2_job_id AS UNSIGNED)) AS link_job,
       (SELECT COUNT(*)
          FROM gd_async_job r
         WHERE @SA > 0
           AND r.tenant_id = '@T'
           AND r.is_deleted = 0 AND r.command = 'COMPLETE_SA'
           AND r.correlation_id = 'SA|@SA'
           AND JSON_VALID(r.request_payload) AND COALESCE(g.adjustment_no, '') <> ''
           AND (JSON_UNQUOTE(JSON_EXTRACT(r.request_payload, '$.issuedNo')) COLLATE utf8mb4_general_ci) = g.adjustment_no) AS issued_reuse,
       CAST(c.id AS CHAR) AS sc_id, c.stock_count_status, c.review_status AS sc_review_status, c.organization_id AS sc_organization_id,
       (SELECT CAST(JSON_OBJECT('id', CAST(a.id AS CHAR), 'no', a.adjustment_no, 'job', CAST(a.sa_v2_job_id AS CHAR)) AS CHAR)
          FROM stock_adjustment a
         WHERE @SC > 0
           AND a.tenant_id = '@T'
           AND a.stock_count_id = @SC
           AND a.stock_adjustment_status = 'Processing' AND a.is_deleted = 0
         ORDER BY a.id DESC LIMIT 1) AS sc_processing_sa,
       (SELECT CAST(JSON_ARRAYAGG(@SOJ) AS CHAR)
          FROM gd_async_job so
         WHERE @SC > 0
           AND so.tenant_id = '@T'
           AND so.is_deleted = 0 AND so.command = 'COMPLETE_SA'
           AND so.job_status IN (@OPEN)
           @SOSC) AS sc_open_jobs,
       (SELECT CAST(@SLJ AS CHAR)
          FROM gd_async_job sl
         WHERE @SC > 0
           AND sl.tenant_id = '@T'
           AND sl.is_deleted = 0 AND sl.command = 'COMPLETE_SA'
           @SLSC
         ORDER BY sl.id DESC LIMIT 1) AS sc_last_job,
       (@SCLOCK) AS sc_lock,
       (SELECT CAST(JSON_OBJECT('id', CAST(a2.id AS CHAR), 'no', a2.adjustment_no, 'job', CAST(a2.sa_v2_job_id AS CHAR)) AS CHAR)
          FROM stock_adjustment a2
         WHERE a2.tenant_id = '@T'
           AND a2.stock_count_id = @FSCX
           AND a2.id <> @SA
           AND a2.stock_adjustment_status = 'Processing' AND a2.is_deleted = 0
         ORDER BY a2.id DESC LIMIT 1) AS fsc_processing_sa,
       (SELECT CAST(JSON_ARRAYAGG(@FOJ) AS CHAR)
          FROM gd_async_job fo
         WHERE @FSCX > 0
           AND fo.tenant_id = '@T'
           AND fo.is_deleted = 0 AND fo.command = 'COMPLETE_SA'
           AND fo.job_status IN (@OPEN)
           AND JSON_VALID(fo.request_payload)
           AND (JSON_UNQUOTE(JSON_EXTRACT(fo.request_payload, '$.source')) COLLATE utf8mb4_general_ci) = 'REVIEW'
           AND (JSON_UNQUOTE(JSON_EXTRACT(fo.request_payload, '$.scId')) COLLATE utf8mb4_general_ci)
               = (CAST(@FSCX AS CHAR) COLLATE utf8mb4_general_ci)) AS fsc_open_jobs,
       (@FSCLOCK) AS fsc_lock
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN stock_adjustment g
    ON g.tenant_id = '@T'
   AND g.id = @SA
   AND g.is_deleted = 0
  LEFT JOIN stock_count c
    ON c.tenant_id = '@T'
   AND c.id = @SC
   AND c.is_deleted = 0"""
FACTS_COLS = ["db_now", "key_job", "sa_id", "adjustment_no", "stock_adjustment_status", "organization_id", "plant_id", "no_type", "stock_count_id", "sa_v2_job_id",
              "sa_lock", "open_jobs", "last_job", "link_job", "issued_reuse", "sc_id", "stock_count_status", "sc_review_status", "sc_organization_id",
              "sc_processing_sa", "sc_open_jobs", "sc_last_job", "sc_lock", "fsc_processing_sa", "fsc_open_jobs", "fsc_lock"]

# the stored SC lines (REVIEW: STALE's "stored Adjusted, shown Approved" and the scFingerprint); @SC = 0 reads nothing
SC_LINES = FP_SC_LINES

# the lines' items: the serial screen, the costing-migration screen and the WA screen read these flags (FORM: the lines'
# material_id; REVIEW: code_review_prep's materialIds)
ITEMS = """SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'serial_number_management', i.serial_number_management,
       'material_costing_method', i.material_costing_method, 'stock_control', i.stock_control) AS j
  FROM item i
 WHERE i.tenant_id = '@T'
   AND i.is_deleted = 0
   AND i.id IN (@ITEMS)"""

# costing rows of those items in the organization, counted per (material, batch, plant) the engine's way (NULL / 0 = no batch;
# batch-scoped to the entries' batches): W = wa_costing_method, F = fifo_costing_history (the costing-migration screen, copied
# from scratchpad/pwv2/prepare/sql.py SUBMIT_SQL["cost"], decided per entry in the gate), A = wa_costing_method rows per
# (material, plant) of ANY batch (GLOBAL_INVENTORY_VALIDATION v11 search_node_GIVWaNoBatch; GIVWaBatch = W). Plants are not
# filtered: the gate looks up each entry's exact (material, batch, plant) - a REVIEW's entry plants are known only after its build
COST = """SELECT JSON_OBJECT('t', x.t, 'm', CAST(x.m AS CHAR), 'b', CAST(x.b AS CHAR), 'p', CAST(x.p AS CHAR), 'n', x.n) AS j
  FROM (SELECT 'W' AS t, w.material_id AS m, COALESCE(w.batch_id, 0) AS b, w.plant_id AS p, COUNT(*) AS n
          FROM wa_costing_method w
         WHERE w.tenant_id = '@T'
           AND w.is_deleted = 0
           AND w.organization_id = '@ORG'
           AND w.material_id IN (@ITEMS)
           AND COALESCE(w.batch_id, 0) IN (@BATCHES)
         GROUP BY w.material_id, COALESCE(w.batch_id, 0), w.plant_id
        UNION ALL
        SELECT 'A' AS t, w.material_id AS m, 0 AS b, w.plant_id AS p, COUNT(*) AS n
          FROM wa_costing_method w
         WHERE w.tenant_id = '@T'
           AND w.is_deleted = 0
           AND w.organization_id = '@ORG'
           AND w.material_id IN (@ITEMS)
         GROUP BY w.material_id, w.plant_id
        UNION ALL
        SELECT 'F' AS t, f.material_id AS m, COALESCE(f.batch_id, 0) AS b, f.plant_id AS p, COUNT(*) AS n
          FROM fifo_costing_history f
         WHERE f.tenant_id = '@T'
           AND f.is_deleted = 0
           AND f.organization_id = '@ORG'
           AND f.material_id IN (@ITEMS)
           AND COALESCE(f.batch_id, 0) IN (@BATCHES)
         GROUP BY f.material_id, COALESCE(f.batch_id, 0), f.plant_id) x"""

FP_ANCHOR_WHERE = " WHERE l.tenant_id = '@T'"
assert FP_SA_LINES.count(FP_ANCHOR_WHERE) == 1


def fp_sa_lines():
    """FP_SA_LINES exactly as shared (code/shared/sql.py) behind a constant '@NEED' gate"""
    return FP_SA_LINES.replace(FP_ANCHOR_WHERE, " WHERE '@NEED' = 'YES' AND l.tenant_id = '@T'")


# COMPLETE: the stored lines before the writes (lineFingerprint = what A1 finds when it has not written yet); @SSA = 0 reads nothing
STORED = fp_sa_lines()

# after the document write: the SA this job wrote / updated (sa_v2_job_id) and, for DIRECT, its lines
HDR_BY_JOB = """SELECT CAST(g.id AS CHAR) AS id, g.adjustment_no, g.stock_adjustment_status, CAST(g.sa_v2_job_id AS CHAR) AS sa_v2_job_id
  FROM stock_adjustment g
 WHERE g.tenant_id = '@T'
   AND g.sa_v2_job_id = '@JOB'
   AND g.is_deleted = 0
 ORDER BY g.id"""
HDR_COLS = ["id", "adjustment_no", "stock_adjustment_status", "sa_v2_job_id"]
SA_BY_JOB = ("(SELECT h.id FROM stock_adjustment h\n"
             "                               WHERE h.tenant_id = '@T'\n"
             "                                 AND h.sa_v2_job_id = '@JOB'\n"
             "                                 AND h.is_deleted = 0 ORDER BY h.id LIMIT 1)")

# the job of this key, its SA's status / number / job link, the SA's latest SAC lock, the job's S payload parts (grv2 sql_node_RSback)
BACK = """SELECT CAST(j.id AS CHAR) AS job_id, j.job_status, j.correlation_id,
       g.stock_adjustment_status, g.adjustment_no, CAST(g.sa_v2_job_id AS CHAR) AS sa_v2_job_id,
       (SELECT p.result_ref
          FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id
           AND p.job_id = CONCAT('SAC|', SUBSTRING(j.correlation_id, 4))
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       (SELECT COUNT(*)
          FROM gd_publish_step q
         WHERE q.tenant_id = j.tenant_id
           AND q.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
           AND q.step_name LIKE 'S|%' AND q.is_deleted = 0) AS parts
  FROM gd_async_job j
  LEFT JOIN stock_adjustment g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^SA[|][0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
   AND g.is_deleted = 0
 WHERE j.tenant_id = '@T'
   AND j.idempotency_key = '@KEY'
   AND j.is_deleted = 0
 ORDER BY j.id DESC LIMIT 1"""
BACK_COLS = ["job_id", "job_status", "correlation_id", "stock_adjustment_status", "adjustment_no", "sa_v2_job_id", "lock_ref", "parts"]


def facts(sub, T, SA, SC, KEY, FSC_):
    """the facts row; the lock sub-selects are filled with the final references first (sub leaves no @TOKEN behind)"""
    fsc = sub(FSC, FSC=FSC_)
    sa_lock = sub(LOCKOBJ, COND=SA + " > 0", JOBID="'SAC|" + SA + "'", T=T)
    sc_lock = sub(LOCKOBJ, COND=SC + " > 0", JOBID="'SCR|" + SC + "'", T=T)
    fsc_lock = sub(LOCKOBJ, COND=fsc + " > 0", JOBID="(CONCAT('SCR|', CAST(" + fsc + " AS CHAR)) COLLATE utf8mb4_general_ci)", T=T)
    return sub(FACTS, KJ=JOBOBJ.replace("@A", "k"), OJ=JOBOBJ.replace("@A", "o"), XJ=JOBOBJ.replace("@A", "x"), YJ=JOBOBJ.replace("@A", "y"),
               SOJ=JOBOBJ.replace("@A", "so"), SLJ=JOBOBJ.replace("@A", "sl"), FOJ=JOBOBJ.replace("@A", "fo"), SOSC=SCJOB.replace("@A", "so"),
               SLSC=SCJOB.replace("@A", "sl"), SALOCK=sa_lock, SCLOCK=sc_lock, FSCLOCK=fsc_lock, FSCX=fsc, OPEN=OPEN, T=T, SA=SA, SC=SC, KEY=KEY)


def sc_lines(sub, T, SC):
    return sub(SC_LINES, T=T, SC=SC)


def items(sub, T, ITEMS_):
    return sub(ITEMS, T=T, ITEMS=ITEMS_)


def cost(sub, T, ITEMS_, BATCHES, ORG):
    return sub(COST, T=T, ITEMS=ITEMS_, BATCHES=BATCHES, ORG=ORG)


def stored(sub, T, SSA, NEED):
    return sub(STORED, T=T, SA=SSA, NEED=NEED)


def hdr_by_job(sub, T, JOB):
    return sub(HDR_BY_JOB, T=T, JOB=JOB)


def lines_by_job(sub, T, JOB, NEED):
    return sub(fp_sa_lines(), T=T, SA=sub(SA_BY_JOB, T=T, JOB=JOB), NEED=NEED)


def back(sub, T, KEY):
    return sub(BACK, T=T, KEY=KEY)
