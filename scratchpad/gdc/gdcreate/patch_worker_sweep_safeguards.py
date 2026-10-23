"""patch_worker_sweep_safeguards.py: GD_ASYNC_WORKER - two safeguards on the save-kick sweep (user 2026-10-23, after
patch_worker_sweep_retry.py + patch_max_retries.py).

1. Spread: a save's kick takes the stale jobs in random order (its own job still first), so two saves at the same moment rarely
   reach for the same backlog job. The W0 claim is a unique insert and a twin claim crashes its run; the platform has no
   non-fatal claim (sql-nodes are read-only, a caught error still answers 400 and would let the run write a lease it does not
   own), so the race can only be made rare. The list's poll (job_id 0) keeps oldest first.
2. Limit: the sweep skips jobs that already used 3 or more attempts - a job that keeps failing is left to its own kick and the
   list, and no longer stops every save's sweep (the loop stops at the first failed node).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_worker_sweep_safeguards.py [--write]
"""
import json
import os
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
JOB = "{{node:code_node_1OvNTk9G2.data.jobId}}"
OLD_FILTER = ("AND (%s = 0 OR j.id = %s\n"
              "                     OR (j.next_attempt_at IS NOT NULL AND j.next_attempt_at <= NOW(3) - INTERVAL 10 SECOND)\n"
              "                     OR (j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= NOW(3) - INTERVAL 10 SECOND)\n"
              "                     OR (j.next_attempt_at IS NULL AND j.lease_expires_at IS NULL AND j.id < ((UNIX_TIMESTAMP() * 1000 - 10000 - 1288834974657) << 22)))") % (JOB, JOB)
NEW_FILTER = ("AND (%s = 0 OR j.id = %s\n"
              "                     OR (j.attempt_count < 3\n"
              "                         AND ((j.next_attempt_at IS NOT NULL AND j.next_attempt_at <= NOW(3) - INTERVAL 10 SECOND)\n"
              "                              OR (j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= NOW(3) - INTERVAL 10 SECOND)\n"
              "                              OR (j.next_attempt_at IS NULL AND j.lease_expires_at IS NULL AND j.id < ((UNIX_TIMESTAMP() * 1000 - 10000 - 1288834974657) << 22)))))") % (JOB, JOB)
OLD_ORDER = "ORDER BY (j.id = %s) DESC, j.create_time, j.id" % JOB
NEW_ORDER = "ORDER BY (j.id = %s) DESC, CASE WHEN %s = 0 THEN 0 ELSE RAND() END, j.create_time, j.id" % (JOB, JOB)


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


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip"
sc = find(doc, "sql_node_RaVfenlh")["data"]["script"]
for old, new, what in ((OLD_FILTER, NEW_FILTER, "filter"), (OLD_ORDER, NEW_ORDER, "order")):
    assert sc["code"].count(old) == 1, "%s: %d matches" % (what, sc["code"].count(old))
    sc["code"] = sc["code"].replace(old, new)
out = render(doc)
json.loads(out)
print("GD_ASYNC_WORKER sweep safeguards (random order, attempts < 3): %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
