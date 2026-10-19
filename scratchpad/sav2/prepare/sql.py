"""SA_V2_PREPARE reads (CONTRACT.md sections 9 / 14): one JSON_OBJECT per row (`j`) unless noted, no row caps, all in ONE
condition-all fork-join after the entry. Its branches:
  hdr       the Stock Adjustment header + its lock facts (latest SAC|<saId> LOCK row)
  sclines   FP_SC_LINES of the review's Stock Count (FORM: sc id 0 -> no rows)
  plan      a dependent chain: parts (the job's S| parts) -> lines (the stored SA lines: FP_SA_LINES + every line column) ->
            code_node_SPids (the review's id lists from prep over the S|..|SC record; FORM: the lines' ids for LABELS) ->
            a nested fork-join of code/shared/review_sql.py REVIEW_READS with those lists
Placeholders: the guard's tenantId / jobId and the entry's saId / scId / organizationId / jobId, all digit-checked in code; the
tenant, varchar ids and the S| prefix hand-quoted, bigint ids bare. Ids leave SQL CAST AS CHAR (COLLATE utf8mb4_general_ci where a
cast is compared with a column).
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.dirname(HERE)


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SAV2, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SHARED = _load("sa_shared_sql", "code/shared/sql.py")
RSQL = _load("sa_review_sql", "code/shared/review_sql.py")

GUARD = "code_node_SPguard"
ENTRY = "code_node_SPentry"
IDS = "code_node_SPids"

T = "'{{node:%s.data.tenantId}}'" % GUARD
JOB = "{{node:%s.data.jobId}}" % GUARD
ET = "'{{node:%s.data.tenantId}}'" % ENTRY
SA = "{{node:%s.data.saId}}" % ENTRY
SC = "{{node:%s.data.scId}}" % ENTRY
EJOB = "{{node:%s.data.jobId}}" % ENTRY

# the job (+ DB clock, lease flag, request) and, for a SUBMIT that stopped before "link", the SA it left Processing - only when
# no later lock names another key (its latest SAC| LOCK row is absent or carries this job's key: the lock rule of section 4)
JOB_SQL = f"""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.lease_owner, (j.lease_expires_at > n.t) AS lease_live, j.row_version,
       j.attempt_count, j.idempotency_key, j.correlation_id, j.request_payload, j.is_deleted,
       (SELECT CAST(MAX(g.id) AS CHAR) FROM stock_adjustment g
         WHERE g.tenant_id = {T} AND g.sa_v2_job_id = '{JOB}' AND g.stock_adjustment_status = 'Processing' AND g.is_deleted = 0
           AND COALESCE((SELECT p.result_ref FROM gd_publish_step p
                          WHERE p.tenant_id = {T} AND p.job_id = (CONCAT('SAC|', CAST(g.id AS CHAR)) COLLATE utf8mb4_general_ci)
                            AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
                          ORDER BY p.id DESC LIMIT 1), j.idempotency_key) = j.idempotency_key) AS linked_sa
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = {T}
   AND j.id = {JOB}"""
JOB_COLS = ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key",
            "correlation_id", "request_payload", "is_deleted", "linked_sa"]

BACK_SQL = f"""SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.progress_message, j.error_code, j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = {T}
   AND j.id = {JOB}"""
BACK_COLS = ["id", "job_status", "progress_message", "error_code", "error_message"]

# the stored lines: FP_SA_LINES' columns (the fingerprint SUBMIT / COMMIT compute) + every other line column the plan hands on
# (the lifted loop bodies, LABELS, REORDER, SALINES)
_FP_TAIL = "'balance_index', l.balance_index, 'is_serialized_item', l.is_serialized_item) AS j"
assert SHARED.FP_SA_LINES.count(_FP_TAIL) == 1, "code/shared/sql.py FP_SA_LINES changed: re-anchor prepare/sql.py"
LINES_SQL = SHARED.FP_SA_LINES.replace(_FP_TAIL, "'balance_index', l.balance_index, 'is_serialized_item', l.is_serialized_item, "
                                       "'material_name', l.material_name, 'material_desc', l.material_desc, 'adjustment_reason', l.adjustment_reason, "
                                       "'adj_summary', l.adj_summary, 'adjustment_remarks', l.adjustment_remarks, 'plant_id', CAST(l.plant_id AS CHAR), "
                                       "'item_category', CAST(l.item_category AS CHAR), 'is_single_serial', l.is_single_serial, 'item_remark', l.item_remark, "
                                       "'item_remark2', l.item_remark2, 'item_remark3', l.item_remark3, 'project_id', CAST(l.project_id AS CHAR)) AS j")

READS = {
    # the header: what the lifted bodies read as get_node_Rs3nGg9f (plant, organization, the STORED number, the date), the 13 props COMMIT A1
    # writes (a COMPLETE whose S|..|DOC header differs lists SALINES) + the lock facts
    "hdr": (f"""SELECT JSON_OBJECT('id', CAST(h.id AS CHAR), 'adjustment_no', h.adjustment_no, 'adjustment_no_type', CAST(h.adjustment_no_type AS CHAR),
       'stock_adjustment_status', h.stock_adjustment_status, 'plant_id', CAST(h.plant_id AS CHAR), 'organization_id', h.organization_id,
       'adjustment_date', DATE_FORMAT(h.adjustment_date, '%Y-%m-%d %H:%i:%s'), 'adjustment_type', h.adjustment_type, 'adjusted_by', h.adjusted_by,
       'stock_count_id', CAST(h.stock_count_id AS CHAR), 'acc_integration_type', h.acc_integration_type, 'posted_status', h.posted_status,
       'project_id', CAST(h.project_id AS CHAR), 'reference_documents', h.reference_documents, 'adjustment_remarks', h.adjustment_remarks,
       'adjustment_remarks2', h.adjustment_remarks2, 'adjustment_remarks3', h.adjustment_remarks3, 'tenant_id', h.tenant_id, 'sa_v2_job_id', h.sa_v2_job_id,
       'lock_ref', (SELECT p.result_ref FROM gd_publish_step p
                     WHERE p.tenant_id = {ET} AND p.job_id = 'SAC|{SA}' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
                     ORDER BY p.id DESC LIMIT 1)) AS j
  FROM stock_adjustment h
 WHERE h.tenant_id = {ET}
   AND h.id = {SA}
   AND h.is_deleted = 0""", ["j"]),
    # the Stock Count lines a review was built on (scLineFingerprint; FORM: no Stock Count -> 0 rows)
    "sclines": (SHARED.FP_SC_LINES.replace("'@T'", ET).replace("@SC", SC), ["j"]),
    # SUBMIT's payload parts of this job (COMPLETE: S|<nonce>|DOC|<nnn>; REVIEW: S|<nonce>|SC|<nnn>)
    "parts": (f"""SELECT p.step_name, p.result_ref
  FROM gd_publish_step p
 WHERE p.tenant_id = {ET}
   AND p.job_id = '{EJOB}'
   AND p.step_name LIKE 'S|%'
   AND p.is_deleted = 0
 ORDER BY p.step_name""", ["step_name", "result_ref"]),
    "lines": (LINES_SQL.replace("'@T'", ET).replace("@SA", SA), ["j"]),
}
assert "@" not in READS["sclines"][0] and "@" not in READS["lines"][0]

# the review reads (code/shared/review_sql.py) with code_node_SPids' lists: items / bins serve the build and LABELS (FORM: the
# lines' ids); balances / batch balances / UOMs / batches / costs / prefix only a review needs (FORM: "0" -> no rows)
REVIEW_TOK = {"items": {"MID": "MID"}, "balances": {"MID": "BMID", "LID": "BLID"}, "batch_balances": {"MID": "BMID", "LID": "BLID"}, "bins": {"LID": "LID"},
              "uoms": {"UID": "UID"}, "batches": {"BID": "BID"}, "costs": {"MID": "CMID", "ORG": "ORG"}, "prefix": {"ORG": "ORG"}}


def review_read(name):
    toks = {"T": "{{node:%s.data.tenantId}}" % GUARD}
    for tok, field in REVIEW_TOK[name].items():
        toks[tok] = "{{node:%s.data.%s}}" % (IDS, field)
    return RSQL.review_sql(name, **toks)


REVIEW = {name: (review_read(name), RSQL.REVIEW_COLS) for name in RSQL.REVIEW_READS}
