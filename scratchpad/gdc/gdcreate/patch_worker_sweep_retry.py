"""patch_worker_sweep_retry.py: GD_ASYNC_WORKER - GD Created V2 jobs stop depending on people's clicks to move (user 2026-10-23,
after the LSH backlog: due jobs waited for someone to open the Goods Delivery list, and every lock conflict cost another kick).

1. A save's kick also sweeps STALE due jobs. The poll (sql_node_RaVfenlh) answered only the kicked job when a job_id was given;
   now it also takes jobs whose next attempt or dead lease is 10 s or more past, or that were never started and are 10 s old
   (by the snowflake id: no time zone), the kicked job first. Fresh jobs
   are left to their own kick, so parallel saves do not race for each other's claims (the W0 claim is a unique insert: a
   twin claim crashes its run). The list's poll (job_id 0) is unchanged.
2. In-run retries. The plan (code_node_JsJ91wA5) gives the first 3 jobs two more passes; a pass is processed only for a job a
   lock conflict left waiting (COMMITTING_GD with GD_INVENTORY_IN_PROGRESS / GD_INVENTORY_RETRYABLE_REJECTION), within a
   45 s retry budget (code_node_Qo8Suk1M). Before each pass sql_node_WKwait sleeps until that job's next attempt when it is
   at most 8 s away (the WAIT delay is 2 s, the RETRY delays 2 / 4 / 8 s). A conflict needs two passes: recover, then apply.
3. The tick's answer (code_node_LdCyuBWM) lists each job once and reports the kicked job, not merely the first planned one.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_worker_sweep_retry.py [--write]
"""
import copy
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r
    return None


def sub(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert "sql_node_WKwait" not in raw, "already patched"
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610236)
JOB = "{{node:code_node_1OvNTk9G3.data.jobId}}"

# 1. the poll: the kicked job, or a stale due job, the kicked one first
poll = find(doc, "sql_node_RaVfenlh")["data"]["script"]
poll["code"] = sub(poll["code"], "AND (%s = 0 OR j.id = %s)" % (JOB, JOB),
                   "AND (%s = 0 OR j.id = %s\n                     OR (j.next_attempt_at IS NOT NULL AND j.next_attempt_at <= NOW(3) - INTERVAL 10 SECOND)\n"
                   "                     OR (j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= NOW(3) - INTERVAL 10 SECOND)\n"
                   "                     OR (j.next_attempt_at IS NULL AND j.lease_expires_at IS NULL AND j.id < ((UNIX_TIMESTAMP() * 1000 - 10000 - 1288834974657) << 22)))" % (JOB, JOB), "poll filter")
poll["code"] = sub(poll["code"], "ORDER BY j.create_time, j.id", "ORDER BY (j.id = %s) DESC, j.create_time, j.id" % JOB, "poll order")

# 2a. the plan: two retry passes for the first 3 jobs
plan = find(doc, "code_node_JsJ91wA5")["data"]["script"]
plan["code"] = sub(plan["code"], "  const items = jobs.map(workerItem);",
                   "  const items = jobs.map(workerItem);\n"
                   "  // retry passes (2026-10-23): the first 3 jobs come round twice more; Pick works a pass only for a job a lock conflict left waiting\n"
                   "  const passes = items.slice(0, 3);\n"
                   "  const loopItems = items.concat(passes.map((i) => Object.assign({}, i, { retry: 1 })), passes.map((i) => Object.assign({}, i, { retry: 2 })));", "plan items")
plan["code"] = sub(plan["code"], '  return { route: items.length ? "WORK" : "IDLE", dbNow: dbNow, runStart: dbNow, items: items, count: items.length,',
                   '  return { route: items.length ? "WORK" : "IDLE", dbNow: dbNow, runStart: dbNow, items: loopItems, count: items.length,', "plan return")

# 2b. the pick: retry passes, their own budget
pick = find(doc, "code_node_Qo8Suk1M")["data"]["script"]
pick["code"] = sub(pick["code"], 'const GDC = {"retry":{"max_retries":3,"base_delay_ms":2000,"max_delay_ms":30000},"worker_budget_seconds":20};',
                   'const GDC = {"retry":{"max_retries":3,"base_delay_ms":2000,"max_delay_ms":30000},"worker_budget_seconds":20,"worker_retry_budget_seconds":45};', "pick GDC")
pick["code"] = sub(pick["code"],
                   '  if (index > 0 && elapsed > GDC.worker_budget_seconds) return Object.assign(out, { result_message: "budget: " + elapsed + " s since the run start (> " + GDC.worker_budget_seconds + " s): job " + item.jobId + " is left for the next tick" });',
                   '  if (Number(planned.retry || 0) > 0) {\n'
                   '    // a retry pass (2026-10-23): only a job a lock conflict left waiting, within the retry budget\n'
                   '    if (item.jobStatus !== "COMMITTING_GD" || ["GD_INVENTORY_IN_PROGRESS", "GD_INVENTORY_RETRYABLE_REJECTION"].indexOf(s(item.errorCode)) < 0) return Object.assign(out, { result_message: "retry pass " + planned.retry + ": job " + item.jobId + " is " + item.jobStatus + (item.errorCode ? " " + s(item.errorCode) : "") + ": nothing to retry" });\n'
                   '    if (elapsed > GDC.worker_retry_budget_seconds) return Object.assign(out, { result_message: "retry pass " + planned.retry + ": " + elapsed + " s since the run start (> " + GDC.worker_retry_budget_seconds + " s): job " + item.jobId + " is left for the next tick" });\n'
                   '  } else if (index > 0 && elapsed > GDC.worker_budget_seconds) return Object.assign(out, { result_message: "budget: " + elapsed + " s since the run start (> " + GDC.worker_budget_seconds + " s): job " + item.jobId + " is left for the next tick" });',
                   "pick budget")

# 2c. the wait before a retry pass: code (the pass's job) + sql (sleep until its next attempt, at most 8 s)
SLOT = r"""// retry pass (2026-10-23): this loop item's job when the item is a retry pass, else 0 - sql_node_WKwait sleeps only for it
const plan = [{{node:code_node_JsJ91wA5.data}}][0];
const indexRaw = {{node:get_cache_node_JEpzWu86.data}};
const index = indexRaw === undefined || indexRaw === null || indexRaw === "" ? 0 : parseInt(String(indexRaw), 10) || 0;
const item = (plan.items || [])[index] || {};
const id = String(item.jobId || "");
return { retryJobId: Number(item.retry || 0) > 0 && /^[0-9]{1,20}$/.test(id) ? id : "0" };"""
WAIT = """SELECT SLEEP(LEAST(GREATEST(TIMESTAMPDIFF(MICROSECOND, NOW(3), j.next_attempt_at) / 1000000 + 0.2, 0), 8)) AS slept
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_1OvNTk9G3.data.tenantId}}'
   AND j.id = {{node:code_node_WKslot.data.retryJobId}}
   AND j.is_deleted = 0
   AND j.job_status = 'COMMITTING_GD'
   AND j.error_code IN ('GD_INVENTORY_IN_PROGRESS', 'GD_INVENTORY_RETRYABLE_REJECTION')
   AND j.next_attempt_at > NOW(3)
   AND j.next_attempt_at <= NOW(3) + INTERVAL 8 SECOND"""


def field(name, bson):
    return {"key": K.key(), "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


slot = copy.deepcopy(find(doc, "code_node_Qo8Suk1M"))
slot["id"] = "code_node_WKslot"
for k in ("title", "nodeName", "name"):
    slot["data"][k] = "Retry pass: this item's job (else 0)"
slot["data"]["script"]["code"] = SLOT
slot["data"]["response_json"] = [field("retryJobId", "string")]
wait = copy.deepcopy(find(doc, "sql_node_oAHg7l6A"))
wait["id"] = "sql_node_WKwait"
for k in ("title", "nodeName", "name"):
    wait["data"][k] = "Retry pass: sleep until the job's next attempt (at most 8 s)"
wait["data"]["script"]["code"] = WAIT
wait["data"]["response_json"] = [field("slept", "int")]
loop = find(doc, "loop_PUIQIMkR")
at = [b["id"] for b in loop["blocks"]].index("sql_node_oAHg7l6A")
assert [b["id"] for b in loop["blocks"]][:2] == ["get_cache_node_JEpzWu86", "sql_node_oAHg7l6A"]
loop["blocks"][at:at] = [slot, wait]

# 3. the answer: each job once, the kicked job reported
res = find(doc, "code_node_LdCyuBWM")["data"]["script"]
res["code"] = sub(res["code"], "  const jobs = (plan.items || []).map((it) => {",
                  "  const jobs = (plan.items || []).filter((it, i, a) => a.findIndex((x) => x.jobId === it.jobId) === i).map((it) => {", "result dedupe")
res["code"] = sub(res["code"], "  const first = jobs[0] || null;",
                  "  const first = jobs.filter((j) => j.job_id === s(guard.jobId))[0] || jobs[0] || null;", "result first")

out = render(doc)
json.loads(out)
ids = re.findall(r'"id": "([A-Za-z0-9_\-]+)"', out)
assert len(ids) == len(set(ids)), "duplicate node ids"
print("GD_ASYNC_WORKER + stale sweep + in-run retries: %d chars (was %d); loop body %s" % (len(out), len(raw), [b["id"] for b in loop["blocks"]][:4]))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
