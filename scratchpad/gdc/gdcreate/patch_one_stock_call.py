"""patch_one_stock_call.py: stock keys are taken in one ordered call, and a GD worker run makes one stock call (2026-10-26).

Root cause of the 10-26 freeze and the slow TAKEs (prod run timings): the platform keeps the atomic-count lock that
INVENTORY_LOCK_TOKENS takes on a key until the TOP-LEVEL run ends, not when the engine call ends.
- Packing PKG|2114544577384943617|3 waited 99.7 s and got through 1.8 s after GD_COMPLETE_WORKER 2114544729973723137
  ended, 15 s after that worker's engine run had ended.
- A run that touched keys therefore blocks them for its whole life, and the lock has no wait timeout.

INVENTORY_APPLY_OPERATION, code_node_LNtake: every key in the one first TAKE call, in lock order (the 9 parallel lanes, since
10-22, are left empty, the path every operation with 25 keys or fewer already takes). A lane waiting on one key while the
other lanes already held later keys deadlocked with a sorted TAKE: 07:31-07:51, GD|2114497026472415234|11 and 4 GDs, until the
20-min platform limit.

GD_ASYNC_WORKER:
- code_node_PKdec001 (end of each iteration) also answers nextIndex: past the plan's end after an iteration that called
  GD_BULK_COMMIT, so the run takes no further job and never sleeps on those keys; set_cache_node_dv5GX4FO stores it. The next
  job goes to the next run: every job has its own job_id kick (form, SO list follow every 15 s for 2 min) and the list ticks.
- code_node_JsJ91wA5 plans no retry passes. A pass could only work a job this run claimed, which means a commit call, after
  which the run stops; sleeping there was what held the keys through the 10-26 morning.
- code_node_Qo8Suk1M: the first-pass hold-off for a just-due waiting job (patch_worker_claim_herd.py) is removed; with no
  retrier sleeping on the job it would only delay it.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_one_stock_call.py [--write]
"""
import json
import os
import re
import subprocess
import sys

ROOT = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/"
APPLY = ROOT + "INVENTORY_APPLY_OPERATION.json"
WORKER = ROOT + "GD_ASYNC_WORKER.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")

TAKE_OLD = (
    "// INVENTORY_APPLY_OPERATION - lock TAKE: the first 25 keys alone (one first load of INVENTORY_LOCK_TOKENS after a restart), then 9 lanes (10-22)\n"
    "const list = (r) => (Array.isArray(r) ? r : r ? [r] : []);\n"
    "const rows = list([{{node:code_node_J6YxjhQw.data.ids}}][0]);\n"
    "const solo = new Set(rows.map(String)).size !== rows.length; // a key twice: one call, as before\n"
    "const more = solo ? [] : rows.slice(25), per = Math.max(1, Math.ceil(more.length / 9));\n"
    "const out = { warm: solo ? rows : rows.slice(0, 25), count: String(rows.length) };\n"
)
TAKE_NEW = (
    "// INVENTORY_APPLY_OPERATION - lock TAKE: every key in ONE call, in lock order (2026-10-26; the 9 lanes of 10-22 stay empty).\n"
    "// The platform keeps a taken key until the top-level run ends: a lane waiting on one key while the other lanes held later\n"
    "// keys deadlocked with a sorted TAKE (LSH 07:31-07:51, until the 20-min platform limit)\n"
    "const list = (r) => (Array.isArray(r) ? r : r ? [r] : []);\n"
    "const rows = list([{{node:code_node_J6YxjhQw.data.ids}}][0]);\n"
    "const more = [], per = 1;\n"
    "const out = { warm: rows, count: String(rows.length) };\n"
)
PLAN_OLD = (
    "  // retry passes (2026-10-23): the first 3 jobs come round six more times (LSH 2026-10-25: was twice); Pick works a pass only for a job a lock conflict left waiting\n"
    "  const passes = items.slice(0, 3);\n"
)
PLAN_NEW = (
    "  // retry passes (2026-10-23) are off since 2026-10-26: a pass could only work a job this run claimed, i.e. after a commit call,\n"
    "  // and the platform keeps every stock key that call touched locked until the run ends - the run now stops there (PKdec001)\n"
    "  const passes = [];\n"
)
HOLD_OFF = (
    "  // 2026-10-26: a waiting job that came due under 10 s ago belongs to the run that claimed it last (it sleeps until then):\n"
    "  // a first pass leaves it rather than race that run for the claim\n"
    '  if (!(Number(planned.retry || 0) > 0) && item.jobStatus === "COMMITTING_GD" && ["GD_INVENTORY_IN_PROGRESS", "GD_INVENTORY_RETRYABLE_REJECTION"].indexOf(s(item.errorCode)) >= 0 && t(dbNow) - t(item.nextAttemptAt) < 10000) return Object.assign(out, { result_message: "job " + item.jobId + " came due under 10 s ago and is left to its retrying run " + (item.lastClaimOwner || "") + ": skipped" });\n'
)
PK_OLD = "const mid = [{{node:code_node_7UMUXQpd.data}}][0] || {};\n"
PK_NEW = PK_OLD + "const pick = [{{node:code_node_Qo8Suk1M.data}}][0] || {};\n"
PK_RET_OLD = 'return { route: call ? "PICK" : "END", eventId: call ? "GD_COMMITTED|" + gdId + "|1" : "", jobId: job ? s(job.id) : s(mid.jobId), gdId: gdId, jobStatus: job ? s(job.job_status) : "", result_message: call ? "picking for GD " + gdId : why };'
PK_RET_NEW = (
    "// 2026-10-26: after a GD_BULK_COMMIT call the run takes no further job - the platform keeps the stock keys that call touched\n"
    "// locked until the run ends - so the next loop index points past the plan; the next job goes to the next run\n"
    'const nextIndex = s(mid.route) === "PUBLISH" ? 9999 : Number(pick.nextIndex) || 0;\n'
    'return { route: call ? "PICK" : "END", eventId: call ? "GD_COMMITTED|" + gdId + "|1" : "", jobId: job ? s(job.id) : s(mid.jobId), gdId: gdId, jobStatus: job ? s(job.job_status) : "", nextIndex: nextIndex, result_message: call ? "picking for GD " + gdId : why };'
)
NEXT_OLD = "{{node:code_node_Qo8Suk1M.data.nextIndex}}"
NEXT_NEW = "{{node:code_node_PKdec001.data.nextIndex}}"


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


def load(path):
    raw = open(path, encoding="utf-8").read()
    doc = json.loads(raw)
    assert render(doc) == raw, path + " does not round-trip"
    return raw, doc


raw_a, app = load(APPLY)
raw_w, wk = load(WORKER)
assert "every key in ONE call" not in raw_a and "nextIndex: nextIndex" not in raw_w, "already patched"

take = find(app, "code_node_LNtake")["data"]["script"]
take["code"] = swap(take["code"], TAKE_OLD, TAKE_NEW, "LNtake")

plan = find(wk, "code_node_JsJ91wA5")["data"]["script"]
plan["code"] = swap(plan["code"], PLAN_OLD, PLAN_NEW, "Plan passes")
pick = find(wk, "code_node_Qo8Suk1M")["data"]["script"]
pick["code"] = swap(pick["code"], HOLD_OFF, "", "Pick hold-off")
pk = find(wk, "code_node_PKdec001")["data"]
pk["script"]["code"] = swap(pk["script"]["code"], PK_OLD, PK_NEW, "PKdec001 pick")
pk["script"]["code"] = swap(pk["script"]["code"], PK_RET_OLD, PK_RET_NEW, "PKdec001 return")
taken = set(re.findall(r'"key": "([a-z0-9]{8})"', raw_w))
key = next(k for k in ("nxtidx26", "nxtidx27", "nxtidx28") if k not in taken)
names = [e["name"] for e in pk["response_json"]]
assert "nextIndex" not in names
pk["response_json"].insert(names.index("jobStatus") + 1, {"key": key, "name": "nextIndex", "title": "nextIndex", "description": "", "bsonType": "int", "isExpand": False, "children": []})
nxt = find(wk, "set_cache_node_dv5GX4FO")["data"]
assert nxt["custom_wkbocgni"]["code"] == NEXT_OLD, nxt["custom_wkbocgni"]["code"]
nxt["custom_wkbocgni"]["code"] = NEXT_NEW

out_a, out_w = render(app), render(wk)
print("INVENTORY_APPLY_OPERATION: one ordered TAKE call (lanes empty); %+d chars" % (len(out_a) - len(raw_a)))
print("GD_ASYNC_WORKER: one commit call per run (next index past the plan), no retry passes, no first-pass hold-off; %+d chars" % (len(out_w) - len(raw_w)))
if "--write" in sys.argv:
    open(APPLY, "w", encoding="utf-8").write(out_a)
    open(WORKER, "w", encoding="utf-8").write(out_w)
    print("written")
else:
    print("ok (dry): pass --write")
