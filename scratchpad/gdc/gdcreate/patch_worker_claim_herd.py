"""patch_worker_claim_herd.py: GD_ASYNC_WORKER - a waiting job is retried by the run that claimed it last (2026-10-26).

LSH 2026-10-26 06:51-08:31: 161 worker runs died on the claim insert (Duplicate entry W0_CLAIM_<n>), all but 7 of them on a
job a stock lock left waiting (claim number > 5). 121 were ticks (no job_id): every tick plans its retry passes on the same
three oldest due jobs, sleeps until the same next_attempt_at, wakes together and all but one lose the claim (median 78 s into
the run: retry passes). The rest were job_id runs dying on their first pass at the same moment (median 3 s).

- sql_node_oAHg7l6A (the fresh tick read) also returns last_claim_owner: result_ref of the job's highest W0_CLAIM_<n> row
  ('' when none), declared in its response_json.
- sql_node_WKwait sleeps only when this run made that last claim, so the other runs' retry passes no longer wait out 30 s.
- code_node_Qo8Suk1M (Pick):
  - a retry pass works a waiting job only when this run claimed it last; any other run's pass skips it ("its retry is theirs").
  - a first pass leaves a waiting job (COMMITTING_GD + GD_INVENTORY_IN_PROGRESS / GD_INVENTORY_RETRYABLE_REJECTION) that came
    due under 10 s ago to its retrying run; after 10 s any run takes it (a retrier that ended or died).
- workerItem (Plan + Pick copies) carries lastClaimOwner ('' from the poll, which does not read it).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_worker_claim_herd.py [--write]
"""
import json
import os
import re
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
T = "'{{node:code_node_1OvNTk9G2.data.tenantId}}'"


def last_claim(indent):
    pad = " " * indent
    return (
        "IFNULL((SELECT cl.result_ref\n"
        + pad + "          FROM gd_publish_step cl\n"
        + pad + "         WHERE cl.tenant_id = " + T + "\n"
        + pad + "           AND cl.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)\n"
        + pad + "           AND cl.step_name LIKE 'W0_CLAIM_%'\n"
        + pad + "           AND cl.is_deleted = 0\n"
        + pad + "         ORDER BY CAST(SUBSTRING(cl.step_name, 10) AS UNSIGNED) DESC\n"
        + pad + "         LIMIT 1), '')"
    )


TICK_OLD = "       (cw.id IS NOT NULL AND cw.started_at > n.t - INTERVAL 10 MINUTE) AS claim_live,\n"
TICK_NEW = TICK_OLD + "       " + last_claim(7) + " AS last_claim_owner,\n"
WAIT_OLD = "   AND j.next_attempt_at <= NOW(3) + INTERVAL 30 SECOND"
WAIT_NEW = WAIT_OLD + "\n   AND " + last_claim(3) + " = '{{node:code_node_1OvNTk9G2.data.leaseOwner}}'"

ITEM_OLD = 'opLive: String(row.op_live) === "1" ? "YES" : "NO" };'
ITEM_NEW = 'opLive: String(row.op_live) === "1" ? "YES" : "NO", lastClaimOwner: s(row.last_claim_owner) };'
RETRY_OLD = '    if (elapsed > GDC.worker_retry_budget_seconds) return Object.assign(out, { result_message: "retry pass " + planned.retry + ": " + elapsed + " s since the run start (> " + GDC.worker_retry_budget_seconds + " s): job " + item.jobId + " is left for the next tick" });\n'
RETRY_NEW = RETRY_OLD + (
    "    // 2026-10-26: only the run that claimed the job last retries it - every tick slept on the same oldest waiting jobs, woke\n"
    "    // together and all but one died on the claim insert (LSH 06:51-08:31: 161 runs)\n"
    '    if (item.lastClaimOwner !== guard.leaseOwner) return Object.assign(out, { result_message: "retry pass " + planned.retry + ": job " + item.jobId + " was claimed last by " + (item.lastClaimOwner || "no worker") + ": its retry is theirs" });\n'
)
DUE_OLD = '  if (item.dueNow !== "YES") return Object.assign(out, { result_message: "job " + item.jobId + " is not due now (next_attempt_at " + s(item.nextAttemptAt) + "): skipped" });\n'
DUE_NEW = DUE_OLD + (
    "  // 2026-10-26: a waiting job that came due under 10 s ago belongs to the run that claimed it last (it sleeps until then):\n"
    "  // a first pass leaves it rather than race that run for the claim\n"
    '  if (!(Number(planned.retry || 0) > 0) && item.jobStatus === "COMMITTING_GD" && ["GD_INVENTORY_IN_PROGRESS", "GD_INVENTORY_RETRYABLE_REJECTION"].indexOf(s(item.errorCode)) >= 0 && t(dbNow) - t(item.nextAttemptAt) < 10000) return Object.assign(out, { result_message: "job " + item.jobId + " came due under 10 s ago and is left to its retrying run " + (item.lastClaimOwner || "") + ": skipped" });\n'
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


def swap(code, old, new, what):
    assert code.count(old) == 1, "%s: anchor found %d times" % (what, code.count(old))
    return code.replace(old, new)


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip"
assert "last_claim_owner" not in raw, "already patched"

tick = find(doc, "sql_node_oAHg7l6A")["data"]
tick["script"]["code"] = swap(tick["script"]["code"], TICK_OLD, TICK_NEW, "tick read")
taken = set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
key = next(k for k in ("lstclm26", "lstclm27", "lstclm28") if k not in taken)
names = [e["name"] for e in tick["response_json"]]
tick["response_json"].insert(names.index("claim_live") + 1, {"key": key, "name": "last_claim_owner", "title": "last_claim_owner", "description": "", "bsonType": "string", "isExpand": False, "children": []})

wait = find(doc, "sql_node_WKwait")["data"]["script"]
wait["code"] = swap(wait["code"], WAIT_OLD, WAIT_NEW, "WKwait")

for nid in ("code_node_JsJ91wA5", "code_node_Qo8Suk1M"):
    c = find(doc, nid)["data"]["script"]
    c["code"] = swap(c["code"], ITEM_OLD, ITEM_NEW, nid + " workerItem")
pick = find(doc, "code_node_Qo8Suk1M")["data"]["script"]
pick["code"] = swap(pick["code"], RETRY_OLD, RETRY_NEW, "Pick retry pass")
pick["code"] = swap(pick["code"], DUE_OLD, DUE_NEW, "Pick first pass")

out = render(doc)
print("GD_ASYNC_WORKER claim herd: last_claim_owner (tick read + WKwait), Pick retry = last claimer only, first pass leaves a just-due waiting job 10 s; %+d chars" % (len(out) - len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
