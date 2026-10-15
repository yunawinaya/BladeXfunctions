"""patch_convert_guards.py [--write]: GD Edit V2 batch 2 - Convert to Picking refuses a Goods Delivery being saved in the
background. SU: GD_Convert_Picking (web list + mobile) and SU: GD_Line_Convert_Picking (web list) read the GDs before
mapping the Picking; a Processing GD now ENDS the run with code 400 and the reason (GlobalGenerateBatchWorkflow's live
end-node refusal shape). Mobile checks only the envelope's success before inserting the Picking itself, so the run must
fail: an answer carrying data would be inserted. Based on the DEPLOYED dev versions (repo copies IDENTICAL, 2026-10-15)."""
import json
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
D = R + "Bulk Actions/Sales & Distribution/Goods Delivery/"
PRETTIER = "/Users/yunawinaya/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs"


def fmt(doc):
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                          capture_output=True, text=True, check=True).stdout


def field(key, name, title, bson="string"):
    return {"key": key, "name": name, "title": title, "description": "", "bsonType": bson, "isExpand": False, "children": []}


loop = json.load(open(R + "Picking/PickingLoopWorkflow.json"))
IF_TPL = [n for n in loop["nodes"] if n["id"] == "loop_BIfi18oK"][0]["blocks"][2]
assert IF_TPL["id"] == "if_tNNSBWyU"
END = {"id": "end_ConvBusy", "type": "end-node", "data": {"title": "End: refused (a GD is being saved in the background)",
       "outputs": {"type": "object", "properties": {"result": {"type": "string"}}}, "isValidator": True,
       "nodeName": "End: refused (a GD is being saved in the background)", "name": "End: refused (a GD is being saved in the background)",
       "back_data_type": "Default", "code": 400, "msg": {"type": "javascript", "code": "{{node:code_node_ConvBusy.data.message}}"}}, "blocks": []}


def guard(doc, search, code_tpl_id):
    nodes = doc["nodes"]
    top = [n["id"] for n in nodes]
    assert "code_node_ConvBusy" not in top, "already patched"
    code_tpl = [n for n in nodes if n["id"] == code_tpl_id][0]
    check = json.loads(json.dumps(code_tpl))
    title = "GD Busy: a GD being saved in the background is not converted"
    check.update({"id": "code_node_ConvBusy", "blocks": []})
    check["data"].update({"title": title, "nodeName": title, "name": title,
                          "response_json": [field("cvbusy01", "busy", "Busy", "int"), field("cvmsg001", "message", "Message")]})
    check["data"]["script"] = {"type": "javascript", "code": """// A Goods Delivery being saved in the background is not converted: the run fails with the reason (mobile inserts nothing).
const raw = {{node:%s.data.data}};
const row = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((g) => g && g.gd_status === "Processing")[0];
return row
  ? { busy: 1, message: "Goods Delivery " + (row.delivery_no || row.id) + " is being saved in the background. Wait a moment, then try again." }
  : { busy: 0, message: "" };
""" % search}
    iff = json.loads(json.dumps(IF_TPL))
    if_title = "IF a GD is being saved in the background: the run fails with the reason"
    iff.update({"id": "if_ConvBusy"})
    iff["data"].update({"title": if_title, "nodeName": if_title, "name": if_title})
    iff["data"]["filter"] = {"list": [dict(IF_TPL["data"]["filter"]["list"][0], id=1791960000002, parentId=1791960000001,
                                           prop="node.code_node_ConvBusy.data.busy", propLabel="busy")]}
    iff["blocks"] = [dict(IF_TPL["blocks"][0], id="if_block_ConvBusyT", blocks=[json.loads(json.dumps(END))]),
                     dict(IF_TPL["blocks"][1], id="if_block_ConvBusyF", blocks=[])]
    i = top.index(search)
    doc["nodes"] = nodes[:i + 1] + [check, iff] + nodes[i + 1:]


write = "--write" in sys.argv
for name, path, search, code_tpl in (("SU: GD_Convert_Picking", D + "GDConvertPickingWorkflow.json", "search_node_IUyBiDce", "code_node_PYFZeGpr"),
                                     ("SU: GD_Line_Convert_Picking", D + "GDLineConvertPickingWorkflow.json", "search_node_rxIt49E4", "code_node_1loqHjR1")):
    raw = open(path, encoding="utf-8").read()
    doc = json.loads(raw)
    assert fmt(doc) == raw, name + ": the printer does not round-trip the file"
    before = [n["id"] for n in doc["nodes"]]
    guard(doc, search, code_tpl)
    print(name, ":", [n["id"] for n in doc["nodes"] if n["id"] not in before], "after", search)
    if write:
        open(path, "w", encoding="utf-8").write(fmt(doc))
print("written" if write else "dry run (--write to save)")
