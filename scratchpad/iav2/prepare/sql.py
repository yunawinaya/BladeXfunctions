"""IA_V2_PREPARE reads (CONTRACT.md sections 9, 14): the job, then one fork-join of code/shared/sql.py OWNER / FP_HEADER / FP_LINES /
ITEMS + the bins. Read-only check: python3 lib/sqlcheck.py <dir> test/prepare/sqlcheck_values.json IA_V2_PREPARE."""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(IAV2, "lib"))
import v2build as V  # noqa: E402

_spec = importlib.util.spec_from_file_location("ia_shared_sql", os.path.join(IAV2, "code", "shared", "sql.py"))
SHARED = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SHARED)

GUARD = "code_node_IPguard"
ENTRY = "code_node_IPentry"

T = "'{{node:%s.data.tenantId}}'" % GUARD
JOB = "{{node:%s.data.jobId}}" % GUARD
ET = "{{node:%s.data.tenantId}}" % ENTRY
IA = "{{node:%s.data.iaId}}" % ENTRY

# linked_ia (+ its number and numbering rule, for the link): the IA an unlinked SUBMIT left Processing, unless a later lock names another key
JOB_SQL = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.lease_owner, (j.lease_expires_at > n.t) AS lease_live, j.row_version,
       j.attempt_count, j.idempotency_key, j.correlation_id, j.request_payload, j.is_deleted,
       CAST(li.id AS CHAR) AS linked_ia, li.stock_movement_no AS linked_ia_no, CAST(li.stock_movement_no_type AS CHAR) AS linked_ia_no_type
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = %(T)s
   AND j.id = %(JOB)s
  LEFT JOIN sm_item_assembly li
    ON li.tenant_id = %(T)s
   AND li.id = (SELECT MAX(g.id) FROM sm_item_assembly g
                 WHERE g.tenant_id = %(T)s AND g.ia_v2_job_id = '%(JOB)s' AND g.item_assembly_status = 'Processing' AND g.is_deleted = 0
                   AND COALESCE((SELECT p.result_ref FROM gd_publish_step p
                                  WHERE p.tenant_id = %(T)s AND p.job_id = (CONCAT('IAC|', CAST(g.id AS CHAR)) COLLATE utf8mb4_general_ci)
                                    AND p.step_name LIKE 'LOCK|%%' AND p.is_deleted = 0
                                  ORDER BY p.id DESC LIMIT 1), j.idempotency_key) = j.idempotency_key)""" % {"T": T, "JOB": JOB}
JOB_COLS = ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key",
            "correlation_id", "request_payload", "is_deleted", "linked_ia", "linked_ia_no", "linked_ia_no_type"]

BACK_SQL = """SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.progress_message, j.error_code, j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = %s
   AND j.id = %s""" % (T, JOB)
BACK_COLS = ["id", "job_status", "progress_message", "error_code", "error_message"]

HEADER_OF = "sm_item_assembly h WHERE h.tenant_id = '%s' AND h.id = %s AND h.is_deleted = 0" % (ET, IA)
LINES_OF = "sm_item_assembly_tlm8ve69_sub l WHERE l.tenant_id = '%s' AND l.sm_item_assembly_id = %s AND l.is_deleted = 0" % (ET, IA)

# a derived table: materialized once, then item / bin lookups by primary key
ITEM_IDS = """SELECT k.v
                   FROM (SELECT CAST(h.item_id AS UNSIGNED) AS v FROM %s AND h.item_id REGEXP '^[0-9]{1,20}$'
                         UNION
                         SELECT CAST(l.item_selection AS UNSIGNED) FROM %s AND l.item_selection REGEXP '^[0-9]{1,20}$') k""" % (HEADER_OF, LINES_OF)

BINS_SQL = """SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'bin', b.bin_location_combine) AS j
  FROM (SELECT DISTINCT k.v
          FROM (SELECT h.location_id AS v FROM %s
                UNION ALL
                SELECT CAST(t.loc AS UNSIGNED)
                  FROM sm_item_assembly_tlm8ve69_sub l,
                       JSON_TABLE(IF(JSON_VALID(l.temp_qty_data), l.temp_qty_data, '[]'), '$[*]' COLUMNS (loc VARCHAR(32) PATH '$.location_id')) t
                 WHERE l.tenant_id = '%s' AND l.sm_item_assembly_id = %s AND l.is_deleted = 0 AND t.loc REGEXP '^[0-9]{1,20}$') k) x
  JOIN bin_location b
    ON b.id = x.v
 WHERE b.tenant_id = '%s'
   AND b.is_deleted = 0
 ORDER BY b.id""" % (HEADER_OF, ET, IA, ET)

OWNER_COLS = ["db_now", "ia_id", "item_assembly_status", "ia_v2_job_id", "stock_movement_no", "lock_ref", "lock_step"]
READS = {
    "owner": (V.sub(SHARED.OWNER, T=ET, IA=IA), OWNER_COLS),
    "hdr": (V.sub(SHARED.FP_HEADER, T=ET, IA=IA), ["j"]),
    "lines": (V.sub(SHARED.FP_LINES, T=ET, IA=IA), ["j"]),
    "items": (V.sub(SHARED.ITEMS, T=ET, ITEMS=ITEM_IDS), ["j"]),
    "bins": (BINS_SQL, ["j"]),
}
for _k, (_sql, _cols) in READS.items():
    assert "@" not in _sql, _k
