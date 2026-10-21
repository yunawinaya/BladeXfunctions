"""IDA_V2_COMMIT's SQL (package C; CONTRACT.md sections 4, 6, 9, 14). The statements several packages share come from code/shared/sql.py
unchanged (FP_HEADER, FP_LINES, OWNER, BNC, BATCH_HOLDERS, BATCH_OURS, LINES_BATCH, OUT_TOTALS, OP_STATE); the job-keyed reads are
IA_V2_COMMIT's (tpl/iav2/commit/sql.py) with the IDA names. Every read is tenant-scoped; ids leave SQL as text; no free text is
substituted (the part prefix is P|<nonce>| with the nonce checked [0-9A-Za-z]{1,16}, @HEX is idaHexJson's JSON text of hex strings)."""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.dirname(HERE)


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


SH = _load(os.path.join(IDAV2, "code", "shared", "sql.py"), "ida_shared_sql")
REQ = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.%s')), NULL) AS %s"

# lease_until = now + 10 min: the lease of a pass whose manifest is unreadable; a readable one gets idaLeaseSeconds (the entry's JS)
JOB = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
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

# this job's D0_ .. D4_ rows (the D1|I|nnn intent does not match the REGEXP); result_ref carries D2's summary
STEPS = """SELECT st.step_name, st.step_status, st.result_ref, DATE_FORMAT(st.finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at
  FROM gd_publish_step st
 WHERE st.tenant_id = '@T'
   AND st.job_id = '@JOB'
   AND st.step_name REGEXP '^D[0-9]_'
   AND st.is_deleted = 0"""
STEPS_COLS = ["step_name", "step_status", "result_ref", "finished_at"]

INTENT = """SELECT st.step_name, st.result_ref
  FROM gd_publish_step st
 WHERE st.tenant_id = '@T'
   AND st.job_id = '@JOB'
   AND st.step_name LIKE 'D1|I|%'
   AND st.is_deleted = 0
 ORDER BY st.step_name"""
INTENT_COLS = ["step_name", "result_ref"]

PAYLOAD = "SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB"

# the entry's ownership facts (code/shared OWNER's columns, keyed by the job's correlation IDA|<id>, so it joins the entry's fork-join)
IDA = """SELECT CAST(g.id AS CHAR) AS ida_id, g.item_disassembly_status, g.ida_v2_job_id AS ida_v2_job_id, g.stock_movement_no,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id
           AND p.job_id = (CONCAT('IDC|', SUBSTRING(j.correlation_id, 5)) COLLATE utf8mb4_general_ci)
           AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN sm_item_disassembly g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 5) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@T'
   AND j.id = @JOB
   AND j.correlation_id REGEXP '^IDA\\\\|[0-9]{1,20}$'"""
IDA_COLS = ["ida_id", "item_disassembly_status", "ida_v2_job_id", "stock_movement_no", "lock_ref"]

OWN = "SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB"
OWN_COLS = ["id", "job_status", "lease_owner", "row_version"]

PART = """SELECT st.step_name, st.result_ref
  FROM gd_publish_step st
 WHERE st.tenant_id = '@T'
   AND st.job_id = '@JOB'
   AND st.step_name LIKE CONCAT('@PFX', '@NAME|%')
   AND st.is_deleted = 0
 ORDER BY st.step_name"""
PART_COLS = ["step_name", "result_ref"]


def commit_sql(sub, T, JOBID, IDAID, ORG, PFX, HEX):
    """every SQL text of IDA_V2_COMMIT; the arguments are the {{node:...}} references the builder passes"""
    tok = dict(T=T, JOB=JOBID)
    S = {
        "job": sub(JOB, PREV=REQ % ("prevStatus", "prev_status"), ACTION=REQ % ("action", "req_action"), **tok),
        "steps": sub(STEPS, **tok),
        "intent": sub(INTENT, **tok),
        "payload": sub(PAYLOAD, **tok),
        "ida": sub(IDA, **tok),
        "own": sub(OWN, **tok),
        "hdr": sub(SH.FP_HEADER, T=T, IDA=IDAID),
        "lines": sub(SH.FP_LINES, T=T, IDA=IDAID),
        "owner": sub(SH.OWNER, T=T, IDA=IDAID),
        "bnc": sub(SH.BNC, T=T, ORG=ORG),
        "holders": sub(SH.BATCH_HOLDERS, T=T, ORG=ORG, HEX=HEX),
        "ours": sub(SH.BATCH_OURS, T=T, ORG=ORG, JOB=JOBID, IDA=IDAID),
        "linesbatch": sub(SH.LINES_BATCH, T=T, IDA=IDAID),
        "out": sub(SH.OUT_TOTALS, T=T, JOB=JOBID, ORG=ORG, IDA=IDAID),
        "op1": SH.op_state(sub, T, JOBID, "I"),
        "op2": SH.op_state(sub, T, JOBID, "R"),
    }
    S["part"] = lambda name: sub(PART, PFX=PFX, NAME=name, **tok)
    return S
