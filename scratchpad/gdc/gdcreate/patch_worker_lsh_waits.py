"""patch_worker_lsh_waits.py: GD_ASYNC_WORKER - a lock conflict's retries finish inside the run that met it (LSH 2026-10-25:
GD-2610-1324 took 13 min. Ten SO conversions ran in parallel and met LOCK_CONFLICT; the SO list re-kicked for 2 minutes, then
the retry due at 11:42:49 waited until 11:52:51 for the next kick).

1. Retry passes: the first 3 jobs come round SIX more times (was two), within a 240 s retry budget (was 45 s).
2. sql_node_WKwait sleeps until the job's next attempt when it is at most 30 s away (was 8 s), so the 16 s / 30 s backoffs of
   the later retries are waited out in the run instead of waiting for a click. A sleep holds one DB connection; prod peaks at
   175 of 2,607.
3. No new job after 240 s of the run start (was 20 s), as in GD_COMPLETE_WORKER: a list's sweep (job_id 0) works through
   its 10 jobs in one kick.
The attempt counting, backoff and max_retries 6 are unchanged (GD_BULK_COMMIT decides them).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_worker_lsh_waits.py [--write] [<in.json> <out.json>]
"""
import json
import os
import re
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False)
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


def sub(text, old, new, what):
    assert text.count(old) == 1, "%s: expected once, found %d" % (what, text.count(old))
    return text.replace(old, new)


args = [a for a in sys.argv[1:] if not a.startswith("--")]
src = args[0] if args else P
dst = args[1] if len(args) > 1 else src
raw = open(src, encoding="utf-8").read()
doc = json.loads(raw)
pretty = raw.lstrip().startswith("{\n")
if pretty:
    assert render(doc) == raw, "the file does not round-trip: refusing to re-render it"

pick = find(doc, "code_node_Qo8Suk1M")["data"]["script"]
pick["code"] = sub(pick["code"], '"worker_budget_seconds":20,"worker_retry_budget_seconds":45',
                   '"worker_budget_seconds":240,"worker_retry_budget_seconds":240', "pick budgets")
plan = find(doc, "code_node_JsJ91wA5")["data"]["script"]
plan["code"] = sub(plan["code"], "const loopItems = items.concat(passes.map((i) => Object.assign({}, i, { retry: 1 })), passes.map((i) => Object.assign({}, i, { retry: 2 })));",
                   "const loopItems = items.concat(...[1, 2, 3, 4, 5, 6].map((n) => passes.map((i) => Object.assign({}, i, { retry: n }))));", "plan passes")
plan["code"] = sub(plan["code"], "the first 3 jobs come round twice more",
                   "the first 3 jobs come round six more times (LSH 2026-10-25: was twice)", "plan comment")
wait = find(doc, "sql_node_WKwait")
wait["data"]["script"]["code"] = sub(wait["data"]["script"]["code"], "/ 1000000 + 0.2, 0), 8)) AS slept", "/ 1000000 + 0.2, 0), 30)) AS slept", "wait cap")
wait["data"]["script"]["code"] = sub(wait["data"]["script"]["code"], "AND j.next_attempt_at <= NOW(3) + INTERVAL 8 SECOND",
                                     "AND j.next_attempt_at <= NOW(3) + INTERVAL 30 SECOND", "wait window")
for k in ("title", "nodeName", "name"):
    if isinstance(wait["data"].get(k), str):
        wait["data"][k] = wait["data"][k].replace("(at most 8 s)", "(at most 30 s)")

out = render(doc) if pretty else json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
json.loads(out)
ids = re.findall(r'"id": ?"([A-Za-z0-9_\-]+)"', out)
assert len(ids) == len(set(ids)), "duplicate node ids"
print("GD_ASYNC_WORKER + LSH waits: %d chars (was %d) -> %s" % (len(out), len(raw), os.path.basename(dst)))
if "--write" in sys.argv:
    open(dst, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
