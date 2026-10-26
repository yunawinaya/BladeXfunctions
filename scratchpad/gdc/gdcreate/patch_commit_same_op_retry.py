"""patch_commit_same_op_retry.py: GD_BULK_COMMIT - a caught failed inventory call on an operation that is still unfinished
(LOCKING / LOCKED, no mutation, its lease expired) is retried with the SAME operation, not a new one (LSH 2026-10-26).

Five stock calls froze in the engine's key-taking step at 07:30 and the platform ended them at its 20-minute child-call limit
(07:51). The after-call decision (code_node_7NQFbpmU) then took `decide("INVENTORY_CALL_FAILED")`: a counted retry with
operation |n+1. The old operation stayed LOCKING with the keys it had taken; nothing ever calls it again and these locks do
not expire, so 81 key rows stayed held until a manual release.
Now that one branch calls the same operation on the next attempt, as the not-crashed branch right below it already does. The
engine's RECOVER route then rejects the stale operation and releases its keys, and the RETRY after that moves to a new id.
Unchanged: a live lease still waits; an uncertain (mutation started) operation still goes to review; a REJECTED / DONE /
REQUIRES_REVIEW one is decided as before; a crash with no operation row still retries with a new id (nothing is held).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_commit_same_op_retry.py [--write]
"""
import json
import os
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
NODE = "code_node_7NQFbpmU"

OLD_CRASH = '    if (crashed) return decide("INVENTORY_CALL_FAILED", "", status);\n'
NEW_CRASH = (
    "    // 2026-10-26 (LSH): the same operation again - its RECOVER route releases the keys it took (a new id left them held for good)\n"
    '    if (crashed) return retrySame("INVENTORY_CALL_FAILED", status);\n'
)
ANCHOR = '  if (pre.stepsDone.P3_INVENTORY_APPLY === "YES" && !resp) return out("CONTINUE", { result_message: "P3 already DONE" });\n'
RETRY_SAME = (
    "  // a counted retry that calls the same operation again (2026-10-26): its RECOVER route rejects it and releases its keys\n"
    "  const retrySame = (resultCode, opStatus) => {\n"
    "    const m = mapInventoryResult(resultCode);\n"
    '    const details = { review_reference: "", inventory_operation_id: pre.operationId, inventory_result_code: resultCode };\n'
    "    const n = Math.max(Number(jobBase.attempt_count) || 0, (Number(p3.attempt) || 1) - 1);\n"
    '    if (n + 1 > GDC.retry.max_retries) return Object.assign(failClean(guard, pre, "P3_INVENTORY_APPLY", "GD_TRANSIENT_RETRIES_EXHAUSTED", "inventory " + resultCode + " after " + n + " retries", clean, details), { dbNow: dbNow, operationId: pre.operationId, resultCode: resultCode, reviewReference: "", call: "NO" });\n'
    "    const delayMs = Math.min(GDC.retry.max_delay_ms, GDC.retry.base_delay_ms * Math.pow(2, n));\n"
    '    return out("RETRY", { resultCode: resultCode, nextOperationId: pre.operationId, stepDoneRows: [stepRow("STARTED", resultCode, m.error_code, "attempt " + attempt + " " + resultCode + " (" + pre.operationId + " " + opStatus + "); the same operation is called again so its RECOVER releases its keys", pre.operationId, attempt)], needStepUpd: "YES", jobRows: [Object.assign({}, jobBase, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(dbNow, Math.ceil(delayMs / 1000)), error_code: m.error_code, error_message: GDC.codes[m.error_code].message + " (" + resultCode + ")", error_details: canonicalJson(details), lease_owner: null, lease_expires_at: null })], needJobUpd: "YES", result_code: m.error_code, result_message: "inventory " + resultCode + " (" + opStatus + "): retry " + (n + 1) + " of " + GDC.retry.max_retries + " with the same operation " + pre.operationId });\n'
    "  };\n"
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
node = find(doc, NODE)
code = node["data"]["script"]["code"]
assert code.count(OLD_CRASH) == 1, "crash line: expected once, found %d" % code.count(OLD_CRASH)
assert code.count(ANCHOR) == 1, "anchor: expected once"
assert "retrySame" not in code, "already patched"
code = code.replace(OLD_CRASH, NEW_CRASH).replace(ANCHOR, RETRY_SAME + ANCHOR)
node["data"]["script"]["code"] = code
out = render(doc)
print("%s: crashed + unfinished operation -> retrySame (same operation id); %d chars added" % (NODE, len(out) - len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
