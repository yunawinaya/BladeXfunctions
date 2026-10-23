"""patch_worker_rejected_not_live.py: GD_ASYNC_WORKER - a REJECTED inventory operation no longer holds its job (user 2026-10-23,
after the LSH lock incident: the retry after a LOCK_CONFLICT waited ~10 minutes).

The poll (sql_node_RaVfenlh) and the tick re-read (sql_node_oAHg7l6A) treat a COMMITTING_GD job as not due while any inventory
operation of the job holds a live lease, and the list of statuses included REJECTED. INVENTORY_APPLY_OPERATION's RECOVER route
takes a fresh 10-minute lease before it rejects a stale operation (LOCK_CONFLICT / STALE_BEFORE_MUTATION, the codes the caller
retries with a new operation id), so the job waited out that lease. The engine itself cannot take the change: dev's
su_code_workflow.el_expression (TEXT, 65,535 bytes) holds 65,209 for it (v12).
REJECTED is terminal and its run has returned before the job is free again (GD_BULK_COMMIT holds the job's lease while it waits
for the engine call); a lock it may still own makes the new operation's precheck answer OPERATION_IN_PROGRESS (engine v12) - a
wait, never a crash. DONE and REQUIRES_REVIEW stay. Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_worker_rejected_not_live.py [--write]
"""
import json
import os
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
OLD = "op.operation_status IN ('RECEIVED', 'VALIDATING', 'LOCKING', 'LOCKED', 'MUTATING', 'VERIFYING', 'DONE', 'REJECTED', 'REQUIRES_REVIEW')"
NEW = "op.operation_status IN ('RECEIVED', 'VALIDATING', 'LOCKING', 'LOCKED', 'MUTATING', 'VERIFYING', 'DONE', 'REQUIRES_REVIEW')"


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
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
for nid in ("sql_node_RaVfenlh", "sql_node_oAHg7l6A"):
    sc = find(doc, nid)["data"]["script"]
    assert sc["code"].count(OLD) == 1, "%s: %d matches" % (nid, sc["code"].count(OLD))
    sc["code"] = sc["code"].replace(OLD, NEW)
out = render(doc)
json.loads(out)
assert out.count(OLD) == 0 and out.count(NEW) == 2
print("GD_ASYNC_WORKER: REJECTED operations no longer hold the job (poll + tick): %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
