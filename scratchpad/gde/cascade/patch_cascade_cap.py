"""patch_cascade_cap.py [--write]: GD Edit V2 - SO_CASCADE (Sales Order/SOcascadeDownstreamWorkflow.json, dev v25) refuses a delivery
past 1,000 lines before GD_EDIT_SUBMIT. At 2,000 lines SO_SAVE (~39 MB of node data), SO_CASCADE (~12) and the background save's
SUBMIT (~11) + PREPARE (~18) ran in one request and took dev down (2026-10-16); the user chose a cap now, an async SO save later.
- loop_cd_gd: code_cd_gde_size (the payload's lineCount -> big Y/N) and if_cd_gde_small around wf_cd_gde_submit;
- code_cd_gde_route answers a big delivery first (a skipped SUBMIT may still hold an earlier pass's answer), in the words of the
  classic route's 500-line refusal.
Prints the changed nodes; writes only with --write. The file round-trips json.dumps(indent=2)."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PATH = R + "Sales Order/SOcascadeDownstreamWorkflow.json"
MAX = 1000


def find(lst, nid):
    for n in lst or []:
        if n.get("id") == nid:
            return n
        r = find(n.get("blocks"), nid)
        if r:
            return r
    return None


def clone(o):
    return json.loads(json.dumps(o))


def once(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def field(key, name, bson="any"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def patch(doc):
    nodes = doc["nodes"]
    loop = find(nodes, "loop_cd_gd")
    ids = [b["id"] for b in loop["blocks"]]
    assert ids == ["get_cd_res_gd", "wf_cd_gde_submit", "code_cd_gde_route", "if_cd_gde_v2", "if_cd_gde_classic", "code_cd_collect_gd", "set_cd_res_gd"], ids
    code_tpl = clone(find(nodes, "code_cd_gde_route"))
    if_tpl = clone(find(nodes, "if_cd_gde_v2"))

    size = clone(code_tpl)
    size.update({"id": "code_cd_gde_size", "blocks": []})
    title = "GD Edit V2: is this delivery too big for a Sales Order save"
    size["data"].update({"title": title, "nodeName": title, "name": title,
                         "response_json": [field("socd_gde_sz_big", "big", "string"), field("socd_gde_sz_lines", "lines")]})
    size["data"]["script"] = {"type": "javascript", "code": """// GD Edit V2: past %d lines a delivery is not saved from here (SO_SAVE + this cascade + its checks in one request took dev down)
const lines = Number({{node:loop_cd_gd.lineCount}}) || 0;
return { big: lines > %d ? "Y" : "N", lines: lines };
""" % (MAX, MAX)}

    small = clone(if_tpl)
    small["id"] = "if_cd_gde_small"
    title = "IF the delivery is small enough for a Sales Order save"
    small["data"].update({"title": title, "nodeName": title, "name": title})
    leaf = if_tpl["data"]["filter"]["list"][0]
    small["data"]["filter"] = {"list": [dict(leaf, id=192000000040, parentId=192000000041, prop="node.code_cd_gde_size.data.big", operator="equal", value="N",
                                             propLabel="big", operatorLabel="Equal")]}
    submit = loop["blocks"][1]
    small["blocks"] = [dict(if_tpl["blocks"][0], id="if_cd_gde_small_t", blocks=[submit]), dict(if_tpl["blocks"][1], id="if_cd_gde_small_f", blocks=[])]
    loop["blocks"][1:2] = [size, small]

    route = find(nodes, "code_cd_gde_route")
    route["data"]["script"]["code"] = once(route["data"]["script"]["code"], """const s = (v) => (v === undefined || v === null ? "" : String(v));
""", """const s = (v) => (v === undefined || v === null ? "" : String(v));
const z = [{{node:code_cd_gde_size.data}}][0] || {};
if (s(z.big) === "Y") {
  const appendB = Number({{workflowparams:passNo}}) === 2;
  return { route: "DONE", jobId: "0", code: "400", note: "", clNote: "", message: appendB
    ? "it already has " + z.lines + " lines, more than a Sales Order change can update (1,000). Deliver the new line on a new Goods Delivery."
    : "Delivery " + s({{node:loop_cd_gd.gd_no}}) + " has " + z.lines + " lines: a Sales Order change can update a delivery of up to 1,000 lines. Complete or cancel that delivery before changing these lines." };
}
""", "route: the size check first")
    return doc


raw = open(PATH, encoding="utf-8").read()
doc = json.loads(raw)
assert json.dumps(doc, ensure_ascii=False, indent=2) + "\n" == raw, "the file does not round-trip json.dumps(indent=2)"
new = patch(clone(doc))
for nid in ("code_cd_gde_size", "if_cd_gde_small", "code_cd_gde_route"):
    print("changed:", nid)
if "--write" in sys.argv:
    open(PATH, "w", encoding="utf-8").write(json.dumps(new, ensure_ascii=False, indent=2) + "\n")
    print("written", PATH)
