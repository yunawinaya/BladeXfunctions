"""patch_cascade_fallback.py [--write]: GD Edit V2 final fix I4 - SO_CASCADE (Sales Order/SOcascadeDownstreamWorkflow.json,
after patch_cascade_switch.py): a delivery whose background save the inventory engine refused for data the classic save
handles (costing rows to migrate, a duplicate balance row, a negative price; PREPARE FAILED and put the delivery back) goes to
the classic save in the same pass, with the classic 500-line cap. New code_cd_gde_fallback after if_cd_gde_v2;
if_cd_gde_classic and code_cd_collect_gd read it. Prints what changes; writes only with --write. Round-trips json.dumps(indent=2).
"""
import copy
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PATH = R + "Sales Order/SOcascadeDownstreamWorkflow.json"


def find(lst, nid):
    for n in lst or []:
        if n.get("id") == nid:
            return n
        r = find(n.get("blocks"), nid)
        if r:
            return r
    return None


def once(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def field(key, name, bson="any"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


FALLBACK_JS = """// GD Edit V2: the inventory engine refused data the classic save handles (PREPARE FAILED and put the delivery back): that
// delivery goes to the classic save as if the background save had not taken it; above 500 lines the classic cap refuses it
const FALLBACK = ["GDE_INVENTORY_UNSUPPORTED_COSTING", "GDE_INVENTORY_DUPLICATE_BALANCE", "GDE_INVENTORY_UNSUPPORTED_PRICE"];
const s = (v) => (v === undefined || v === null ? "" : String(v));
const rt = [{{node:code_cd_gde_route.data}}][0] || {};
if (rt.route === "CLASSIC") return { classic: "YES", fallback: "NO", message: "" };
const w = rt.route === "V2" ? [{{node:wf_cd_gde_worker.data}}][0] || {} : {};
if (!(s(w.job_status) === "FAILED" && FALLBACK.indexOf(s(w.result_code)) >= 0)) return { classic: "NO", fallback: "NO", message: "" };
const lines = Number({{node:loop_cd_gd.lineCount}}) || 0;
if (lines > 500) {
  const append = Number({{workflowparams:passNo}}) === 2;
  return { classic: "NO", fallback: "NO", message: append
    ? "it already has " + lines + " lines, more than a Sales Order change can update (500). Deliver the new line on a new Goods Delivery."
    : "Delivery " + s({{node:loop_cd_gd.gd_no}}) + " has " + lines + " lines: a Sales Order change can update a delivery of up to 500 lines. Complete or cancel that delivery before changing these lines." };
}
return { classic: "YES", fallback: "YES", message: "" };
"""


def patch(doc):
    nodes = doc["nodes"]
    loop = find(nodes, "loop_cd_gd")
    ids = [b["id"] for b in loop["blocks"]]
    assert ids == ["get_cd_res_gd", "code_cd_gde_size", "if_cd_gde_small", "code_cd_gde_route", "if_cd_gde_v2", "if_cd_gde_classic", "code_cd_collect_gd", "set_cd_res_gd"], ids
    route = find(nodes, "code_cd_gde_route")
    fb = copy.deepcopy(route)
    fb["id"] = "code_cd_gde_fallback"
    fb["blocks"] = []
    title = "GD Edit V2: the engine refused it for data the classic save handles - classic instead"
    fb["data"].update({"title": title, "nodeName": title, "name": title,
                       "response_json": [field("socd_gde_fb_cl", "classic", "string"), field("socd_gde_fb_fb", "fallback", "string"), field("socd_gde_fb_msg", "message", "string")]})
    fb["data"]["script"] = {"type": "javascript", "code": FALLBACK_JS}
    loop["blocks"].insert(ids.index("if_cd_gde_classic"), fb)

    classic = find(nodes, "if_cd_gde_classic")
    leaf = classic["data"]["filter"]["list"]
    assert len(leaf) == 1 and leaf[0]["prop"] == "node.code_cd_gde_route.data.route" and leaf[0]["value"] == "CLASSIC", leaf
    leaf[0].update({"prop": "node.code_cd_gde_fallback.data.classic", "value": "YES", "propLabel": "classic"})

    col = find(nodes, "code_cd_collect_gd")
    c = col["data"]["script"]
    c["code"] = once(c["code"], """const rt = [{{node:code_cd_gde_route.data}}][0] || {};
if (rt.route === "V2") {""", """const rt = [{{node:code_cd_gde_route.data}}][0] || {};
const fb = [{{node:code_cd_gde_fallback.data}}][0] || {};
if (rt.route === "V2" && fb.fallback !== "YES") {""", "collect: V2 unless it fell back")
    c["code"] = once(c["code"], """    message: held ? "" : String(w.result_message || "it could not be checked""", """    message: held ? "" : String(fb.message || w.result_message || "it could not be checked""", "collect: the 500-line text")
    c["code"] = once(c["code"], """if (rt.route !== "CLASSIC") {""", """if (rt.route !== "CLASSIC" && fb.fallback !== "YES") {""", "collect: classic or the fallback")
    return ["code_cd_gde_fallback (new, after if_cd_gde_v2)", "if_cd_gde_classic (fallback.classic == YES)", "code_cd_collect_gd (reads the fallback)"]


if __name__ == "__main__":
    raw = open(PATH, encoding="utf-8").read()
    doc = json.loads(raw)
    nl = raw.endswith("\n")
    assert json.dumps(doc, ensure_ascii=False, indent=2) + ("\n" if nl else "") == raw, "the file does not round-trip"
    changed = patch(doc)
    out = json.dumps(doc, ensure_ascii=False, indent=2) + ("\n" if nl else "")
    print("SO_CASCADE ->", ", ".join(changed), "| %d -> %d chars" % (len(raw), len(out)))
    if "--write" in sys.argv:
        open(PATH, "w", encoding="utf-8").write(out)
        print("written")
    else:
        print("dry run (--write to save)")
