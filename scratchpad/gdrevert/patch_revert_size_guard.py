"""patch_revert_size_guard.py [--write]: GD_REVERT_COMPLETED (Goods Delivery/RevertCompletedGD/GDheadRevertWorkflow.json, dev v16 =
prod v9) refuses a Goods Delivery over 500 lines before any read, write or the inventory revert. Classic GD_PROCESS_REVERT makes one
ADD_INVENTORY_NEW child run per stock movement, so a 2,000-line revert is one request with thousands of child runs (the shape that
took dev down on 2026-10-20). It answers like the workflow's other refusals (code 400 + message, which the GD list shows); the other
classic paths already refuse above 500. The file is neither json.dumps- nor prettier-formatted, so the nodes are inserted as text
and the result is checked to be the original plus exactly these nodes."""
import copy
import json
import sys

FILE = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/RevertCompletedGD/GDheadRevertWorkflow.json"
LIMIT = 500

GUARD = """// Classic revert makes one inventory child run per stock movement: past %d lines that one request can take the server down
const tableData = {{node:code_node_hrExtract.data.tableData}} || [];
const bundleParentLines = {{node:code_node_hrExtract.data.bundleParentLines}} || [];
const gdNo = {{node:code_node_hrExtract.data.gdNo}} || "";
const lineCount = (Array.isArray(tableData) ? tableData.length : 0) + (Array.isArray(bundleParentLines) ? bundleParentLines.length : 0);
return {
  tooBig: lineCount > %d ? 1 : 0,
  message: "Goods Delivery " + gdNo + " has " + lineCount + " lines. Reverting a completed delivery supports at most %d lines for now; please contact support."
};""" % (LIMIT, LIMIT, LIMIT)


def build(d):
    nodes = d["nodes"]
    extract = next(n for n in nodes if n["id"] == "code_node_hrExtract")
    not_completed = next(n for n in nodes if n["id"] == "if_hrNotCompleted")
    code = {"id": "code_node_hrSizeGuard", "type": "code-node", "data": copy.deepcopy(extract["data"]), "blocks": []}
    for k in ("title", "nodeName", "name"):
        code["data"][k] = "Size Guard"
    code["data"]["script"]["code"] = GUARD
    field = extract["data"]["response_json"][0]
    code["data"]["response_json"] = [dict(copy.deepcopy(field), key="hr1szbig01", name="tooBig", title="tooBig", bsonType="number"),
                                     dict(copy.deepcopy(field), key="hr1szmsg01", name="message", title="message", bsonType="string")]
    iff = copy.deepcopy(not_completed)
    iff["id"] = "if_hrTooBig"
    for k in ("title", "nodeName", "name"):
        iff["data"][k] = "IF Too Many Lines"
    iff["data"]["filter"]["list"][0]["id"] = 1779334300051
    iff["data"]["filter"]["list"][0]["parentId"] = 1779334300050
    iff["data"]["expression"]["code"] = "'{{node:code_node_hrSizeGuard.data.tooBig}}' == '1'"
    t, f = iff["blocks"]
    t["id"], f["id"] = "if_block_hrTooBigTrue", "if_block_hrTooBigFalse"
    ret = t["blocks"][0]
    ret["id"] = "return_node_hrTooBig"
    for k in ("title", "nodeName", "name"):
        ret["data"][k] = "Return Too Many Lines"
    msg = ret["data"]["response_value"]["list"][1]
    assert msg["prop"] == "message"
    msg["valueType"], msg["value"] = "field", "{{node:code_node_hrSizeGuard.data.message}}"
    return code, iff


def main():
    raw = open(FILE, encoding="utf-8").read()
    d = json.loads(raw)
    if "code_node_hrSizeGuard" in raw:
        sys.exit("already patched")
    taken = {int(x) for x in __import__("re").findall(r'"(?:id|parentId)": (\d{10,})', raw)}
    assert not {1779334300050, 1779334300051} & taken, "filter ids taken"
    code, iff = build(d)
    lines = raw.split("\n")
    at = next(i for i, l in enumerate(lines) if l.strip() == '"id": "search_node_hrFindSnap",')
    start = at - 1
    assert lines[start].strip() == "{", "search_node_hrFindSnap's object does not start on the line above"
    indent = lines[start][: len(lines[start]) - len(lines[start].lstrip())]
    block = []
    for node in (code, iff):
        text = json.dumps(node, indent=2, ensure_ascii=False)
        block.extend(indent + l for l in text.split("\n"))
        block[-1] += ","
    out = "\n".join(lines[:start] + block + lines[start:])
    check = json.loads(out)
    ids = [n["id"] for n in check["nodes"]]
    i = ids.index("if_hrNotCompleted")
    assert ids[i + 1: i + 4] == ["code_node_hrSizeGuard", "if_hrTooBig", "search_node_hrFindSnap"], ids[i: i + 4]
    check["nodes"] = [n for n in check["nodes"] if n["id"] not in ("code_node_hrSizeGuard", "if_hrTooBig")]
    assert check == d, "something other than the two inserted nodes changed"
    print("GD_REVERT_COMPLETED: %d -> %d chars (+ code_node_hrSizeGuard, if_hrTooBig > return_node_hrTooBig)" % (len(raw), len(out)))
    if "--write" in sys.argv:
        open(FILE, "w", encoding="utf-8").write(out)
        print("wrote", FILE)


main()
