"""IA_V2_COMMIT's SQL (package C; CONTRACT.md sections 4, 5, 9, 14). The fragments several packages share come from
code/shared/sql.py unchanged (FP_HEADER, FP_LINES, OWNER, OUT_TOTALS, OP_STATE, BATCH_ROWS); the job-keyed reads are the
templates' (tpl/sav2 build_commit.commit_sql) with the IA names. Every read is tenant-scoped; ids leave SQL as text."""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(HERE)


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


SH = _load(os.path.join(IAV2, "code", "shared", "sql.py"), "ia_shared_sql")
REQ = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.%s')), NULL) AS %s"
DT = "DATE_FORMAT(%s, '%%Y-%%m-%%d %%H:%%i:%%s')"

# 30-minute lease, not the template's 10: op 1 runs ~0.29 s per distinct pick (ruling 11)
JOB = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 30 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.progress_percent, j.progress_message, j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at, j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live, (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted, j.line_count,
       @PREV,
       @ACTION
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB"""
JOB_COLS = ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
            "lease_owner", "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id",
            "is_deleted", "line_count", "prev_status", "req_action"]

# this job's I0_ .. I4_ rows (the I1|I|001 intent does not match the REGEXP); result_ref carries I1's batch and I2's summary
STEPS = """SELECT st.step_name, st.step_status, st.result_ref, DATE_FORMAT(st.finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at
  FROM gd_publish_step st
 WHERE st.tenant_id = '@T'
   AND st.job_id = '@JOB'
   AND st.step_name REGEXP '^I[0-9]_'
   AND st.is_deleted = 0"""
STEPS_COLS = ["step_name", "step_status", "result_ref", "finished_at"]

INTENT = """SELECT st.step_name, st.result_ref
  FROM gd_publish_step st
 WHERE st.tenant_id = '@T'
   AND st.job_id = '@JOB'
   AND st.step_name LIKE 'I1|I|%'
   AND st.is_deleted = 0
 ORDER BY st.step_name"""

PAYLOAD = "SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB"

# the entry's ownership facts (sql.py OWNER's columns, keyed by the job's correlation IA|<id>) + the parent item
IA = """SELECT CAST(g.id AS CHAR) AS ia_id, g.item_assembly_status, g.ia_v2_job_id AS ia_v2_job_id, g.stock_movement_no, g.item_id,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('IAC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN sm_item_assembly g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@T'
   AND j.id = @JOB
   AND j.correlation_id REGEXP '^IA\\\\|[0-9]{1,20}$'"""
IA_COLS = ["ia_id", "item_assembly_status", "ia_v2_job_id", "stock_movement_no", "item_id", "lock_ref"]

OWN = "SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB"
OWN_COLS = ["id", "job_status", "lease_owner", "row_version"]

PART = """SELECT st.step_name, st.result_ref
  FROM gd_publish_step st
 WHERE st.tenant_id = '@T'
   AND st.job_id = '@JOB'
   AND st.step_name LIKE CONCAT('@PFX', '@NAME|%')
   AND st.is_deleted = 0
 ORDER BY st.step_name"""

OWNER_COLS = ["db_now", "ia_id", "item_assembly_status", "ia_v2_job_id", "stock_movement_no", "lock_ref", "lock_step"]

# ours can only be a row inserted after the job existed: the read-back and the entry's orphan lookup skip the older rows
assert SH.BATCH_ROWS.count("   AND b.is_deleted = 0") == 1
BATCH_ROWS_AFTER = SH.BATCH_ROWS.replace("   AND b.is_deleted = 0", "   AND b.id > @JOB\n   AND b.is_deleted = 0")


def commit_sql(sub, T, JOBID, IAID, ITEM, ORG, OURS_ITEM, OURS_ORG, PFX):
    """every SQL text of IA_V2_COMMIT; the arguments are the {{node:...}} references the builder passes"""
    tok = dict(T=T, JOB=JOBID)
    S = {
        "job": sub(JOB, PREV=REQ % ("prevStatus", "prev_status"), ACTION=REQ % ("action", "req_action"), **tok),
        "steps": sub(STEPS, **tok),
        "intent": sub(INTENT, **tok),
        "payload": sub(PAYLOAD, **tok),
        "ia": sub(IA, **tok),
        "own": sub(OWN, **tok),
        "hdr": sub(SH.FP_HEADER, T=T, IA=IAID),
        "lines": sub(SH.FP_LINES, T=T, IA=IAID),
        "owner": sub(SH.OWNER, T=T, IA=IAID),
        "batchrows": sub(SH.BATCH_ROWS, T=T, ORG=ORG, ITEM=ITEM),
        "batchback": sub(BATCH_ROWS_AFTER, T=T, ORG=ORG, ITEM=ITEM, JOB=JOBID),
        "oursrows": sub(BATCH_ROWS_AFTER, T=T, ORG=OURS_ORG, ITEM=OURS_ITEM, JOB=JOBID),
        "out": sub(SH.OUT_TOTALS, T=T, JOB=JOBID, IA=IAID),
        "op1": SH.op_state(sub, T, JOBID, "I"),
        "op2": SH.op_state(sub, T, JOBID, "R"),
    }
    S["part"] = lambda name: sub(PART, PFX=PFX, NAME=name, **tok)
    return S
