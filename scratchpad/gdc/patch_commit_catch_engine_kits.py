"""patch_commit_catch_engine_kits.py [--write]: GD_COMPLETE_COMMIT (C2), GD_CANCEL_COMMIT (X2) and GD_REVERT_COMMIT (R1) catch a
failed INVENTORY_BULK_APPLY call, as GD_BULK_COMMIT does since 10-23 (patch_commit_catch_engine_call.py).

10-26, Kenhin GD 2097 (15:58) and LSH GD-2610-1473 (17:25): a first-use lock seed (INVENTORY_LOCK_SEED) lost its race. The
engine caught it and answered 409, but a caught error still fails every calling run, so COMMIT and the worker crashed and the
job sat under its 30-min lease with the GD in Processing. The user released 1473's lease by hand.
- The engine call runs inside a try-catch; the catch block marks it (code_node_<X>crash: crashed YES).
- The step's decision treats a crashed call as a 409: a counted retry with the lease released (lockWait, 15 s backoff, up to
  8); past the tries, review once the operation has intent rows, else FAILED with the GD back (nothing was written).
- COMMIT's run still ends with an error for its caller, so the worker run ends as before, after the job row is written.
Edits the builders and the decision modules; build with each builder afterwards and check with tools/build_diff.py."""
import sys

S = "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/"
KITS = [  # dir, builder, module, node prefix, step, step name, error prefix, workflow
    ("gdc", "build_gdc.py", "c2.js", "CCc2", "C2", "C2_INVENTORY", "GDC", "GD_COMPLETE_COMMIT"),
    ("gdcan", "build_gdcan.py", "x2.js", "XCx2", "X2", "X2_INVENTORY", "GDX", "GD_CANCEL_COMMIT"),
    ("gdrev", "build_gdrev.py", "r1.js", "RCr1", "R1", "R1_INVENTORY", "GDR", "GD_REVERT_COMMIT"),
]
HELPER_AT = '            e["bsonType"] = "int"\n    return node\n'
HELPER = ('\n\ndef try_catch(nid, title, try_nodes, catch_title, catch_nodes):\n'
          '    """the try-catch shape GD_BULK_COMMIT runs live since 10-23 (catch-all: Filter, empty list)"""\n'
          '    return {"id": nid, "type": "tryCatch", "data": {"title": title},\n'
          '            "blocks": [{"type": "tryBlock", "key": "try", "data": {}, "id": nid + "_tryBlock_0", "blocks": try_nodes},\n'
          '                       {"type": "catchBlock", "key": "catch",\n'
          '                        "data": {"title": catch_title, "trycatch_type": "Filter", "filter": {"list": []},\n'
          '                                 "expression": {"type": "javascript", "code": ""}, "displayContent": "sdk.form.setCondition"},\n'
          '                        "id": nid + "_catchBlock_1", "blocks": catch_nodes}]}\n\n\n'
          'ENGINE_CRASH_JS = (\'// %s - the INVENTORY_BULK_APPLY call failed (caught, 2026-10-27): %s decides from the intent rows - a counted\\n\'\n'
          '                   \'// retry with the lease released, instead of a crash that leaves the job leased 30 min (10-26: Kenhin GD 2097, LSH GD-2610-1473)\\n\'\n'
          '                   \'console.log("inventory call failed (caught): %s decides from the intent rows");\\n\'\n'
          '                   \'return { crashed: "YES" };\')\n')
BRANCH = ('  // a failed call (caught, 10-27): its run failed and answered nothing (10-26, Kenhin GD 2097 and LSH GD-2610-1473: a first-use lock\n'
          '  // seed lost its race and the job sat under its 30-min lease). As a 409: retry with the lease released; past the tries, review once\n'
          '  // it has intent rows, else nothing was written\n'
          '  if (s(eng.crashed) === "YES") {\n'
          '    const wrote = num((ops || {}).intents) > 0;\n'
          '    const failed = "INVENTORY_BULK_APPLY failed (caught)" + (wrote ? ", with intent rows" : ", nothing written");\n'
          '    if (entry.attempts >= LOCK_WAIT_TRIES) return wrote ? stepEnd(entry, "%(STEP)s", failed, true) : failNoWrite(entry, "%(ERR)s_INVENTORY_CALL_FAILED", "the inventory call kept failing: nothing was written, try again later");\n'
          '    return lockWait(entry, failed);\n'
          '  }\n')


def sub(text, old, new, what):
    assert text.count(old) == 1, what
    return text.replace(old, new)


edits = []
for kit, builder, mod, X, step, stepname, err, wf in KITS:
    js = S + kit + "/code/commit/" + mod
    body = open(js, encoding="utf-8").read()
    if "eng.crashed" not in body:
        assert "const lockWait = function lockWait(entry, why)" in body and "const LOCK_WAIT_TRIES = 8;" in body, js
        guard = '  if (s(input.ok) !== "YES") return failNoWrite(entry, "%s_INVALID_DATA", "the inventory part of the prepared payload is missing");\n' % err
        body = sub(body, guard, guard + BRANCH % {"STEP": stepname, "ERR": err}, js + " branch")
        eng_end = 'message: [{{node:workflow_node_%s.data.message}}][0] };' % X
        body = sub(body, eng_end, 'message: [{{node:workflow_node_%s.data.message}}][0], crashed: [{{node:code_node_%scrash.data.crashed}}][0] };' % (X, X), js + " eng")
        edits.append((js, body))
    py = S + kit + "/" + builder
    src = open(py, encoding="utf-8").read()
    if "def try_catch(" not in src:
        src = sub(src, HELPER_AT, HELPER_AT + HELPER, py + " helper")
    if "try_catch_%s" % X not in src:
        src = sub(src, 'call(ids, "workflow_node_%s", ' % X,
                  'try_catch("try_catch_%s", "try-catch: a failed INVENTORY_BULK_APPLY call is a counted retry decided from its intent rows (no crash, no 30-min lease)", [call(ids, "workflow_node_%s", ' % (X, X),
                  py + " call start")
        src = sub(src, '("movements", N("code_node_%sin", "data.movements"))]),' % X,
                  '("movements", N("code_node_%sin", "data.movements"))])], "The inventory call failed",\n'
                  '                [K.code("code_node_%scrash", "The inventory call failed: mark it (%s decides from the intent rows)", ENGINE_CRASH_JS %% ("%s", "%s", "%s"), ["crashed"])]),'
                  % (X, X, step, wf, step, step), py + " call end")
        lines = [l for l in src.splitlines() if 'K.code("code_node_%s", "%s check: ' % (X, step) in l]
        assert len(lines) == 1, py + " decision title"
        old = lines[0]
        cut = old.index('"', old.index('"%s check: ' % step) + 1)
        src = src.replace(old, old[:cut] + '; a failed call (caught) -> as 409' + old[cut:])
    edits.append((py, src))

for path, text in edits:
    print(("write " if "--write" in sys.argv else "would write ") + path)
    if "--write" in sys.argv:
        open(path, "w", encoding="utf-8").write(text)
