"""patch_commit_fifo.py: GD_BULK_COMMIT - the oldest waiting delivery goes first (LSH 2026-10-26, user: "the earlier GD should
become priority - the client sees how long a GD has been processing").

GD-2610-1470 (32 keys) waited 50+ minutes at 08:07 with nothing frozen. It gets a try every 1-2 minutes (sweeps), needs all its
keys free at once, and newer deliveries started stock calls immediately and kept taking one or two of its keys.
Now, before a NEW stock call (no operation row yet), the P3 facts read (sql_node_kY5OLfvj) also returns the oldest older job of
the organization that waits for stock (COMMITTING_GD + GD_INVENTORY_RETRYABLE_REJECTION / IN_PROGRESS, touched in the last 3
minutes, so a job nobody drives blocks no one) and has a staged line at the same material + location. If there is one, the
before-call decision (code_node_a4HIjyaU) waits 30 s, UNCOUNTED, instead of calling: the older one finds its keys free.
- Strict id order, so there is no cycle: the oldest waiting job never waits for another.
- Unchanged: recovering this job's own stale operation (it returns earlier in the node), every after-call decision, and
  deliveries with no overlap.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_commit_fifo.py [--write]
"""
import json
import os
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
SQL_NODE = "sql_node_kY5OLfvj"
CODE_NODE = "code_node_a4HIjyaU"

SQL_OLD = "       st.inventory_operation_id AS p3_op\n  FROM (SELECT NOW(3) AS t) n\n"
SQL_NEW = (
    "       st.inventory_operation_id AS p3_op,\n"
    "       (SELECT IFNULL(NULLIF(oj.gd_no, ''), CAST(oj.id AS CHAR))\n"
    "          FROM gd_async_job oj\n"
    "         WHERE oj.job_status = 'COMMITTING_GD'\n"
    "           AND oj.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'\n"
    "           AND oj.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'\n"
    "           AND oj.is_deleted = 0\n"
    "           AND oj.command = 'CREATE_GD_FROM_FORM'\n"
    "           AND oj.id < {{node:code_node_WaEyJtlE.data.jobId}}\n"
    "           AND oj.error_code IN ('GD_INVENTORY_RETRYABLE_REJECTION', 'GD_INVENTORY_IN_PROGRESS')\n"
    "           AND oj.update_time > DATE_ADD(n.t, INTERVAL 8 HOUR) - INTERVAL 3 MINUTE\n"
    "           AND (SELECT COUNT(*)\n"
    "                  FROM gd_bulk_line_stage a\n"
    "                  JOIN gd_bulk_line_stage b\n"
    "                    ON b.tenant_id = a.tenant_id\n"
    "                   AND b.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'\n"
    "                   AND b.material_id = a.material_id\n"
    "                   AND b.location_id = a.location_id\n"
    "                   AND b.is_deleted = 0\n"
    "                 WHERE a.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'\n"
    "                   AND a.job_id = (CAST(oj.id AS CHAR) COLLATE utf8mb4_general_ci)\n"
    "                   AND a.is_deleted = 0) > 0\n"
    "         ORDER BY oj.id\n"
    "         LIMIT 1) AS older_waiting\n"
    "  FROM (SELECT NOW(3) AS t) n\n"
)

CODE_OLD = '  return out("CALL", { call: "YES", result_message: "operation " + pre.operationId + " absent: call" });\n'
CODE_NEW = (
    "  // 2026-10-26 (LSH): the oldest waiting delivery goes first - while an older job of the organization waits for stock at the\n"
    "  // same material + location, no new stock call is started: wait 30 s, uncounted, so the older one finds its keys free\n"
    '  const older = list.length ? s(list[0].older_waiting) : "";\n'
    '  if (older) return out("WAIT", { jobRows: [Object.assign({}, jobBase, { error_code: "GD_INVENTORY_IN_PROGRESS", error_message: GDC.codes.GD_INVENTORY_IN_PROGRESS.message + " (older delivery " + older + " waits for the same stock and goes first)", error_details: canonicalJson({ older_delivery: older, inventory_operation_id: pre.operationId }), progress_message: "Publishing Goods Delivery: waiting for an older delivery", lease_owner: null, lease_expires_at: null, next_attempt_at: dbAddSeconds(dbNow, 30) })], needJobUpd: "YES", result_code: "GD_INVENTORY_IN_PROGRESS", result_message: "older delivery " + older + " waits for the same stock: wait 30 s (uncounted)" });\n'
    + CODE_OLD
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
sql = find(doc, SQL_NODE)["data"]["script"]
code = find(doc, CODE_NODE)["data"]["script"]
assert sql["code"].count(SQL_OLD) == 1, "sql anchor: found %d" % sql["code"].count(SQL_OLD)
assert code["code"].count(CODE_OLD) == 1, "code anchor: found %d" % code["code"].count(CODE_OLD)
assert "older_waiting" not in sql["code"] and "older_waiting" not in code["code"], "already patched"
sql["code"] = sql["code"].replace(SQL_OLD, SQL_NEW)
code["code"] = code["code"].replace(CODE_OLD, CODE_NEW)
out = render(doc)
print("%s + %s: oldest waiting delivery first; %d chars added" % (SQL_NODE, CODE_NODE, len(out) - len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
