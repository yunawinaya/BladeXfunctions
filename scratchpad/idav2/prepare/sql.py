"""IDA_V2_PREPARE reads (CONTRACT.md sections 9, 14): the job, then ONE fork-join of code/shared/sql.py OWNER / FP_HEADER / FP_LINES /
ITEMS_STORED / BINS_STORED / BATCH_TYPED_STORED + this package's LINE_STORAGE, every one keyed by the IDA the entry took from the job
(the stored rows joined inside SQL, no dependent read). Read-only check: python3 lib/sqlcheck.py "<repo>/Item Disassembly/AsyncV2"
test/prepare/sqlcheck_values.json IDA_V2_PREPARE."""
import importlib.util
import os
import sys

# loading code/shared/sql.py must not write a __pycache__ into WP0's folder
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(IDAV2, "lib"))
import v2build as V  # noqa: E402

_spec = importlib.util.spec_from_file_location("ida_shared_sql", os.path.join(IDAV2, "code", "shared", "sql.py"))
SHARED = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SHARED)

GUARD = "code_node_DPguard"
ENTRY = "code_node_DPentry"

T = "'{{node:%s.data.tenantId}}'" % GUARD
JOB = "{{node:%s.data.jobId}}" % GUARD
ET = "{{node:%s.data.tenantId}}" % ENTRY
IDA = "{{node:%s.data.idaId}}" % ENTRY

# linked_ida (+ its number and numbering rule, for the link): the IDA an unlinked SUBMIT left Processing, unless a later lock names another key
JOB_SQL = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.lease_owner, (j.lease_expires_at > n.t) AS lease_live, j.row_version,
       j.attempt_count, j.idempotency_key, j.correlation_id, j.request_payload, j.is_deleted,
       CAST(li.id AS CHAR) AS linked_ida, li.stock_movement_no AS linked_ida_no, CAST(li.stock_movement_no_type AS CHAR) AS linked_ida_no_type
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = %(T)s
   AND j.id = %(JOB)s
  LEFT JOIN sm_item_disassembly li
    ON li.tenant_id = %(T)s
   AND li.id = (SELECT MAX(g.id) FROM sm_item_disassembly g
                 WHERE g.tenant_id = %(T)s AND g.ida_v2_job_id = '%(JOB)s' AND g.item_disassembly_status = 'Processing' AND g.is_deleted = 0
                   AND COALESCE((SELECT p.result_ref FROM gd_publish_step p
                                  WHERE p.tenant_id = %(T)s AND p.job_id = (CONCAT('IDC|', CAST(g.id AS CHAR)) COLLATE utf8mb4_general_ci)
                                    AND p.step_name LIKE 'LOCK|%%' AND p.is_deleted = 0
                                  ORDER BY p.id DESC LIMIT 1), j.idempotency_key) = j.idempotency_key)""" % {"T": T, "JOB": JOB}
JOB_COLS = ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key",
            "correlation_id", "request_payload", "is_deleted", "linked_ida", "linked_ida_no", "linked_ida_no_type"]

BACK_SQL = """SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.progress_message, j.error_code, j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = %s
   AND j.id = %s""" % (T, JOB)
BACK_COLS = ["id", "job_status", "progress_message", "error_code", "error_message"]

# the stored lines' storage location: the lifted code_validate requires it (base/ida_code/code_validate.js:105), FP_LINES does not carry it
LINE_STORAGE = """SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'storage_location_id', CAST(l.storage_location_id AS CHAR)) AS j
  FROM sm_item_disassembly_tlm8ve69_sub l
 WHERE l.tenant_id = '@T'
   AND l.sm_item_disassembly_id = @IDA
   AND l.is_deleted = 0
 ORDER BY l.id"""

READS = {
    "owner": (V.sub(SHARED.OWNER, T=ET, IDA=IDA), SHARED.OWNER_COLS),
    "hdr": (V.sub(SHARED.FP_HEADER, T=ET, IDA=IDA), ["j"]),
    "lines": (V.sub(SHARED.FP_LINES, T=ET, IDA=IDA), ["j"]),
    "items": (V.sub(SHARED.ITEMS_STORED, T=ET, IDA=IDA), ["j"]),
    "bins": (V.sub(SHARED.BINS_STORED, T=ET, IDA=IDA), ["j"]),
    "typed": (V.sub(SHARED.BATCH_TYPED_STORED, T=ET, IDA=IDA), ["j"]),
    "storage": (V.sub(LINE_STORAGE, T=ET, IDA=IDA), ["j"]),
}
for _k, (_sql, _cols) in READS.items():
    assert "@" not in _sql, _k
