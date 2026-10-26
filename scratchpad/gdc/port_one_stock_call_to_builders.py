"""port_one_stock_call_to_builders.py [--write]: puts patch_workers_one_stock_call.py (10-27, live on dev + prod) into the
three builders, so a rebuild of GD_COMPLETE_WORKER / GD_CANCEL_WORKER / GD_REVERT_WORKER keeps it (before this, a build
reverted code_node_<P>split and set_cache_<P>idxN). Check after: each builder's worker builds with no node changed."""
import sys

S = "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/"
TITLE = "Second publish: COMMITTING_GD under a SPLIT| hand-over lease -> PUBLISH again"
TAIL_OLD = '\nconsole.log("worker split", JSON.stringify(res));\nreturn res;'
TAIL_NEW = ('\n// one stock call per run (LSH 2026-10-26 20:40, two sweeps froze 30 min): a run keeps every key it took until it ends, so once\n'
            '// it has called the commit it takes no further job; the next tick or a job\'s own run takes them\n'
            'const pick = [{{node:code_node_%(P)spick.data}}][0];\n'
            'res.nextIndex = String((mid && mid.route) || "").trim() === "PUBLISH" ? 9999 : Number(pick && pick.nextIndex) || 0;\n'
            'console.log("worker split", JSON.stringify(res));\nreturn res;')
HELPER_AT = 'def N(node, path):\n    return "{{node:%s.%s}}" % (node, path)\n'
HELPER = ('\n\ndef int_out(node, *names):\n'
          '    for e in node["data"]["response_json"]:\n'
          '        if e["name"] in names:\n'
          '            e["bsonType"] = "int"\n'
          '    return node\n')
KITS = [("gdc", "build_gdc.py", "GW"), ("gdcan", "build_gdcan.py", "XW"), ("gdrev", "build_gdrev.py", "RW")]


def sub(text, old, new, what):
    assert text.count(old) == 1, what
    return text.replace(old, new)


edits = []
for kit, builder, P in KITS:
    js = S + kit + "/code/worker/split.js"
    body = open(js, encoding="utf-8").read()
    if "res.nextIndex" not in body:
        body = sub(body, TAIL_OLD, TAIL_NEW % {"P": P}, js)
        edits.append((js, body))
    py = S + kit + "/" + builder
    src = open(py, encoding="utf-8").read()
    if "def int_out(" not in src:
        src = sub(src, HELPER_AT, HELPER_AT + HELPER, py + " helper")
    call_old = ('K.code("code_node_%ssplit", "%s", wcode("split.js"),\n'
                '                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),') % (P, TITLE)
    call_new = ('int_out(K.code("code_node_%ssplit", "%s; next index past the plan after a commit call (one stock call per run)", wcode("split.js"),\n'
                '                   ["route", "dbNow", "jobId", "jobStatus", "result_message", "nextIndex"]), "nextIndex"),') % (P, TITLE)
    if call_old in src:
        src = sub(src, call_old, call_new, py + " split node")
    idx_old = 'N("code_node_%spick", "data.nextIndex")),' % P
    idx_line = [l for l in src.splitlines() if 'set_cache_%sidxN' % P in l]
    assert len(idx_line) == 1, py + " index cache line"
    if idx_old in idx_line[0]:
        src = src.replace(idx_line[0], idx_line[0].replace(idx_old, 'N("code_node_%ssplit", "data.nextIndex")),' % P))
    edits.append((py, src))

for path, text in edits:
    print(("write " if "--write" in sys.argv else "would write ") + path)
    if "--write" in sys.argv:
        open(path, "w", encoding="utf-8").write(text)
