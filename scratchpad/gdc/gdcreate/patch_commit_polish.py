"""patch_commit_polish.py: GD_BULK_COMMIT - the review of the 10-26 rush fixes (oldest-first, same-operation retry, limit 200).
Applies on top of the prod v28 state (prod-hotfix/2026-10-26-gd-commit-oldest-first-v3).

sql_node_kY5OLfvj, `older_waiting` (the oldest-first check):
- **Overlap only on rows that take a stock key:** a staged line that is VALID, allocated (allocation_sequence > 0), and has
  a material and a location. Non-stock and unallocated lines (location '', 123 rows on prod) and INVALID lines made GDs
  that share only a delivery-charge item queue behind each other.
- **A stuck head stops holding others back:** older jobs with attempt_count >= 30 (about 25 minutes of retrying) are
  ignored, so one permanently blocked head cannot hold the queue for hours.
- **Timezone-free liveness:** the older job's next_attempt_at is within the last 3 minutes, or its lease is live. Both are
  written from the DB clock and compared with NOW(3). The old `update_time` (app clock, MYT) plus `+8 h` was right on prod
  only, and never true on dev, whose sql-node NOW() is MYT.
- **Cheaper and explicit:** evaluated only when a fresh call is about to start (no operation row, P3 not DONE). EXISTS
  replaces COUNT(*) > 0. IFNULL(..., '') means "no waiter" comes back as '', not as a missing column.

code_node_7NQFbpmU (after-call):
- **retrySame at the limit:** the same operation is called up to 2 more times, so its RECOVER still releases the keys and
  the next pass fails cleanly on the REJECTED operation. Past that, it goes to review naming the stuck operation. It used to
  fail into review with "stock moved" (false) and the keys held.
- **A call that fails before anything is recorded** (no operation row) has its own budget of 6 in a row, counted in
  error_details.call_failures, then fails cleanly. Nothing was recorded, so nothing is held. With the shared limit of 200
  such a permanent fault took about 2 hours to surface.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_commit_polish.py [--write]
"""
import json
import os
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
T = "'{{node:code_node_WaEyJtlE.data.tenantId}}'"
ORG = "'{{node:code_node_rZGbQJid.data.organizationId}}'"
J = "{{node:code_node_WaEyJtlE.data.jobId}}"

SQL_START = "       (SELECT IFNULL(NULLIF(oj.gd_no, ''), CAST(oj.id AS CHAR))\n"
SQL_END = "         LIMIT 1) AS older_waiting\n"
SQL_NEW = (
    "       (CASE WHEN o.id IS NULL AND IFNULL(st.step_status, '') <> 'DONE' THEN\n"
    "          IFNULL((SELECT IFNULL(NULLIF(oj.gd_no, ''), CAST(oj.id AS CHAR))\n"
    "                    FROM gd_async_job oj\n"
    "                   WHERE oj.job_status = 'COMMITTING_GD'\n"
    "                     AND oj.tenant_id = " + T + "\n"
    "                     AND oj.organization_id = " + ORG + "\n"
    "                     AND oj.is_deleted = 0\n"
    "                     AND oj.command = 'CREATE_GD_FROM_FORM'\n"
    "                     AND oj.id < " + J + "\n"
    "                     AND oj.attempt_count < 30\n"
    "                     AND (oj.next_attempt_at > n.t - INTERVAL 3 MINUTE OR oj.lease_expires_at > n.t)\n"
    "                     AND EXISTS (SELECT 1\n"
    "                                   FROM gd_publish_step p3\n"
    "                                  WHERE p3.tenant_id = " + T + "\n"
    "                                    AND p3.job_id = (CAST(oj.id AS CHAR) COLLATE utf8mb4_general_ci)\n"
    "                                    AND p3.step_name = 'P3_INVENTORY_APPLY'\n"
    "                                    AND p3.step_status = 'STARTED'\n"
    "                                    AND p3.is_deleted = 0)\n"
    "                     AND EXISTS (SELECT 1\n"
    "                                   FROM gd_bulk_line_stage a\n"
    "                                   JOIN gd_bulk_line_stage b\n"
    "                                     ON b.tenant_id = a.tenant_id\n"
    "                                    AND b.job_id = '" + J + "'\n"
    "                                    AND b.material_id = a.material_id\n"
    "                                    AND b.location_id = a.location_id\n"
    "                                    AND b.allocation_sequence > 0\n"
    "                                    AND b.line_status = 'VALID'\n"
    "                                    AND b.is_deleted = 0\n"
    "                                  WHERE a.tenant_id = " + T + "\n"
    "                                    AND a.job_id = (CAST(oj.id AS CHAR) COLLATE utf8mb4_general_ci)\n"
    "                                    AND a.allocation_sequence > 0\n"
    "                                    AND a.material_id <> ''\n"
    "                                    AND a.location_id <> ''\n"
    "                                    AND a.line_status = 'VALID'\n"
    "                                    AND a.is_deleted = 0)\n"
    "                   ORDER BY oj.id\n"
    "                   LIMIT 1), '')\n"
    "        ELSE '' END) AS older_waiting\n"
)

SAME_OLD = '    if (n + 1 > GDC.retry.max_retries) return Object.assign(failClean(guard, pre, "P3_INVENTORY_APPLY", "GD_TRANSIENT_RETRIES_EXHAUSTED", "inventory " + resultCode + " after " + n + " retries", clean, details), { dbNow: dbNow, operationId: pre.operationId, resultCode: resultCode, reviewReference: "", call: "NO" });\n    const delayMs = Math.min(GDC.retry.max_delay_ms, GDC.retry.base_delay_ms * Math.pow(2, n));\n    return out("RETRY", { resultCode: resultCode, nextOperationId: pre.operationId,'
SAME_NEW = (
    "    // past the limit the stale operation may still hold keys: up to 2 more calls let its RECOVER release them (the next\n"
    "    // pass then fails cleanly on the REJECTED operation); after that, review naming the stuck operation (no stock moved)\n"
    '    if (n + 1 > GDC.retry.max_retries + 2) return Object.assign(reviewOut(guard, pre, "P3_INVENTORY_APPLY", "GD_INVENTORY_REQUIRES_REVIEW", "the inventory call keeps failing and operation " + pre.operationId + " is still " + opStatus + " (no stock moved): it holds its keys until reviewed", details), { dbNow: dbNow, operationId: pre.operationId, resultCode: resultCode, call: "NO" }, clean);\n'
    "    const delayMs = Math.min(GDC.retry.max_delay_ms, GDC.retry.base_delay_ms * Math.pow(2, n));\n"
    '    return out("RETRY", { resultCode: resultCode, nextOperationId: pre.operationId,'
)

CRASH_OLD = '  if (crashed) return decide("INVENTORY_CALL_FAILED", "", "NOT_RECORDED");\n  return out("CALL", { call: "YES", result_message: "operation " + pre.operationId + " absent: call" });\n'
CRASH_NEW = (
    "  if (crashed) {\n"
    "    // 2026-10-26 review: a call that fails before the inventory workflow records anything is not stock contention - its own\n"
    "    // budget of 6 in a row (error_details.call_failures), then a clean failure: nothing was recorded, so nothing is held\n"
    '    const prev = (() => { try { return JSON.parse(s(jobBase.error_details) || "{}") || {}; } catch (e) { return {}; } })();\n'
    '    const k = (s(prev.inventory_result_code) === "INVENTORY_CALL_FAILED" ? Number(prev.call_failures) || 1 : 0) + 1;\n'
    '    const details = { review_reference: "", inventory_operation_id: pre.operationId, inventory_result_code: "INVENTORY_CALL_FAILED", call_failures: k };\n'
    '    if (k > 6) return Object.assign(failClean(guard, pre, "P3_INVENTORY_APPLY", "GD_TRANSIENT_RETRIES_EXHAUSTED", "the inventory call failed " + k + " times in a row before recording an operation", clean, details), { dbNow: dbNow, operationId: pre.operationId, resultCode: "INVENTORY_CALL_FAILED", reviewReference: "", call: "NO" });\n'
    '    const r = decide("INVENTORY_CALL_FAILED", "", "NOT_RECORDED");\n'
    '    if (r.route === "RETRY" && r.jobRows && r.jobRows[0]) r.jobRows[0].error_details = canonicalJson(details);\n'
    "    return r;\n"
    "  }\n"
    '  return out("CALL", { call: "YES", result_message: "operation " + pre.operationId + " absent: call" });\n'
)


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r is not None:
                return r
    return None


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip"
sql = find(doc, "sql_node_kY5OLfvj")["data"]["script"]
after = find(doc, "code_node_7NQFbpmU")["data"]["script"]
assert "CASE WHEN o.id IS NULL" not in sql["code"], "already patched"
i = sql["code"].find(SQL_START)
j = sql["code"].find(SQL_END)
assert i > 0 and j > i and sql["code"].count(SQL_START) == 1 and sql["code"].count(SQL_END) == 1, "sql anchors"
sql["code"] = sql["code"][:i] + SQL_NEW + sql["code"][j + len(SQL_END):]
assert after["code"].count(SAME_OLD) == 1, "retrySame anchor: %d" % after["code"].count(SAME_OLD)
assert after["code"].count(CRASH_OLD) == 1, "crash anchor: %d" % after["code"].count(CRASH_OLD)
after["code"] = after["code"].replace(SAME_OLD, SAME_NEW).replace(CRASH_OLD, CRASH_NEW)
out = render(doc)
print("GD_BULK_COMMIT polish: older_waiting (key rows only, stuck head ignored, DB-clock liveness, lazy + EXISTS), retrySame past the limit, unrecorded-crash budget; %+d chars" % (len(out) - len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
