"""patch_commit_catch_engine_call.py: GD_BULK_COMMIT - a failed INVENTORY_APPLY_OPERATION call no longer leaves the job leased
for 30 minutes (user 2026-10-23, after Kenhin's GD/20261023/2021: two runs seeded the same new lock row 32 ms apart, the
engine's insert failed on the duplicate, COMMIT and the worker crashed with it, and the job sat under COMMIT's 30-minute
lease - every kick and list poll was turned away - until 13:35, 33 minutes later). Every worker crash on prod since 10-16
(13, all 10-23, LSH + Kenhin) stopped at this one call.

1. The call (workflow_node_q2vFSyDT) runs inside a try-catch; the catch block marks it (code_node_P3crash0: crashed YES).
2. The normalizer (code_node_rhoiDSOp) carries crashed.
3. The after-call decision (code_node_7NQFbpmU, publishP3) decides a crashed call from the operation row, as before:
   - no operation recorded (the engine stopped before its operation insert - the seed race) -> nothing ran: a counted retry
     (INVENTORY_CALL_FAILED, mapped with LOCK_CONFLICT: attempt + 1, lease released, backoff, next operation id; the 6th
     fails cleanly as GD_TRANSIENT_RETRIES_EXHAUSTED);
   - a recorded operation decides as usual (DONE continues, a live one waits for its lease, review stays review); a
     not-live pre-mutation one, which would be called again, is a counted retry instead, so a call that keeps failing ends.
A caught error still marks COMMIT's run, so the worker's workflow node fails as before - but the job row is written first.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_commit_catch_engine_call.py [--write]
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"
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


CATCH = r"""// GD_BULK_COMMIT - the INVENTORY_APPLY_OPERATION call failed (caught, 2026-10-23): P3 decides from the operation row - none
// recorded = nothing ran = a counted retry with the lease released, instead of a crash that leaves the job leased 30 min
console.log("inventory call failed (caught): P3 decides from the operation row");
return { crashed: "YES" };"""

raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert "code_node_P3crash0" not in raw, "already patched"
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610238)

# 1. the call inside a try-catch
tb = find(doc, "ifBlock_XzDwQdw0")
assert [b["id"] for b in tb["blocks"]][:2] == ["workflow_node_q2vFSyDT", "code_node_rhoiDSOp"]
call = tb["blocks"][0]
tb["blocks"][0] = {
    "id": "try_catch_P3invCal",
    "type": "tryCatch",
    "data": {"title": "try-catch: a failed inventory call is decided from the operation row (no crash, no 30-min lease)"},
    "blocks": [
        {"type": "tryBlock", "key": "try", "data": {}, "id": "try_catch_P3invCal_tryBlock_0", "blocks": [call]},
        {"type": "catchBlock", "key": "catch",
         "data": {"title": "The inventory call failed", "trycatch_type": "Filter", "filter": {"list": []},
                  "expression": {"type": "javascript", "code": ""}, "displayContent": "sdk.form.setCondition"},
         "id": "try_catch_P3invCal_catchBlock_1",
         "blocks": [K.code("code_node_P3crash0", "The inventory call failed: mark it (P3 decides from the operation row)", CATCH, ["crashed"])]},
    ],
}

# 2. the normalizer carries it
norm = find(doc, "code_node_rhoiDSOp")["data"]
code = norm["script"]["code"]
code = sub(code, 'const res = { called: "YES", ',
           '// the call failed and was caught (2026-10-23): no answer to normalize, P3 decides from the operation row\n'
           'const crashed = [{{node:code_node_P3crash0.data.crashed}}][0] === "YES";\n'
           'const res = { called: "YES", crashed: crashed ? "YES" : "NO", ', "normalizer")
norm["script"]["code"] = code
names = [f["name"] for f in norm["response_json"]]
proto = dict(norm["response_json"][names.index("called")])
proto.update({"key": K.key(), "name": "crashed", "title": "crashed"})
norm["response_json"].insert(names.index("called") + 1, proto)

# 3. the after-call decision
dec = find(doc, "code_node_7NQFbpmU")["data"]
code = dec["script"]["code"]
code = sub(code, '{"result_codes":["LOCK_CONFLICT","STALE_BEFORE_MUTATION"],"job_error_code":"GD_INVENTORY_RETRYABLE_REJECTION"}',
           '{"result_codes":["LOCK_CONFLICT","STALE_BEFORE_MUTATION","INVENTORY_CALL_FAILED"],"job_error_code":"GD_INVENTORY_RETRYABLE_REJECTION"}', "mapping")
code = sub(code, '  const resp = response && typeof response === "object" && s(response.result_code) ? response : null;\n',
           '  const resp = response && typeof response === "object" && s(response.result_code) ? response : null;\n'
           '  // a caught failed call (2026-10-23): decided from the operation row; where it would be called again, a counted retry\n'
           '  const crashed = !resp && !!response && typeof response === "object" && s(response.crashed) === "YES";\n', "crashed flag")
code = sub(code, '    if (!resp) return out("CALL", { call: "YES", result_message: "operation " + pre.operationId + " is " + status + " with an expired lease: call again (the inventory workflow recovers it)" });\n',
           '    if (crashed) return decide("INVENTORY_CALL_FAILED", "", status);\n'
           '    if (!resp) return out("CALL", { call: "YES", result_message: "operation " + pre.operationId + " is " + status + " with an expired lease: call again (the inventory workflow recovers it)" });\n', "row call")
code = sub(code, '  if (resp) return decide(s(resp.result_code), s(resp.review_reference), s(resp.operation_status));\n  return out("CALL", { call: "YES", result_message: "operation " + pre.operationId + " absent: call" });\n',
           '  if (resp) return decide(s(resp.result_code), s(resp.review_reference), s(resp.operation_status));\n'
           '  if (crashed) return decide("INVENTORY_CALL_FAILED", "", "NOT_RECORDED");\n'
           '  return out("CALL", { call: "YES", result_message: "operation " + pre.operationId + " absent: call" });\n', "absent call")
dec["script"]["code"] = code

out = render(doc)
json.loads(out)
ids = re.findall(r'"id": "([A-Za-z0-9_\-]+)"', out)
assert len(ids) == len(set(ids)), "duplicate node ids"
print("GD_BULK_COMMIT + caught inventory call: %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
