"""patch_gd_guard.py <in.json> <out.json>: GOODS_DELIVERY + the Processing guard right after the start node. An Edit save of
a Goods Delivery an async job holds (stored gd_status 'Processing': GD V2 Created or GD Completion V2) is refused before
anything runs. Writes the new JSON compact (render it with Prettier, then patch the repo file - see build notes)."""
import json
import sys

src, dst = sys.argv[1:3]
d = json.load(open(src))
assert d["nodes"][0]["type"] == "start-node"
for nid in ("code_node_GdProcGuard", "if_GdProcGuard", "sql_node_GdProcGuard", "code_node_GdProcBusy", "if_GdProcBusy", "return_node_GdProcBusy"):
    assert '"%s"' % nid not in json.dumps(d), nid + " already present"


def title(t):
    return {"title": t, "isValidator": True, "nodeName": t, "name": t}


def code(nid, t, body, outs):
    return {"id": nid, "type": "code-node", "data": dict({"language": "javascript", "code": "", "timeout": 30000}, **title(t),
            script={"type": "javascript", "code": body},
            response_json=[{"key": k, "name": n, "title": n, "description": "", "bsonType": "string", "isExpand": False, "children": []} for k, n in outs]),
            "blocks": []}


def if_(nid, t, expr, fid, yes):
    return {"id": nid, "type": "if", "data": dict(title(t), condition_type="Expression",
            filter={"list": [{"id": fid, "parentId": fid + 1, "isTop": True, "prop": "", "operator": "", "valueType": "", "value": "", "type": "leaf", "level": 1}]},
            expression={"type": "javascript", "code": expr}),
            "blocks": [{"id": nid.replace("if_", "ifBlock_T"), "type": "ifBlock", "data": {"title": "true"}, "blocks": yes},
                       {"id": nid.replace("if_", "ifBlock_F"), "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}


guard_js = """// A Goods Delivery an async job holds is Processing (GD V2 Created, GD Completion V2): refuse any save until it finishes
const id = String([{{workflowparams:allData.id}}][0] || "").trim();
const edit = String([{{workflowparams:pageStatus}}][0] || "") === "Edit";
const ok = /^[0-9]{1,20}$/.test(id);
return { check: edit && ok ? "YES" : "NO", gdId: ok ? id : "0" };"""
busy_js = """const row = (([{{node:sql_node_GdProcGuard.data}}][0]) || [])[0] || {};
return { busy: String(row.gd_status || "") === "Processing" ? "YES" : "NO" };"""
sql = """SELECT g.gd_status
  FROM goods_delivery g
 WHERE g.tenant_id = '{{system:tenantId}}'
   AND g.id = {{node:code_node_GdProcGuard.data.gdId}}
   AND g.is_deleted = 0"""
ret = {"id": "return_node_GdProcBusy", "type": "return-node", "data": dict({"return_data": {}, "status_code": 200}, **title("Return Processing"),
       response_value={"list": [
           {"prop": "code", "propLabel": "code", "operator": "", "operatorLabel": "", "valueType": "value", "valueTypeLabel": "", "value": "400", "valueLabel": ""},
           {"prop": "message", "operator": "", "valueType": "value", "value": "This Goods Delivery is being processed in the background - please wait for it to finish.", "valueLabel": "", "propLabel": "message"}]},
       return_raw_data=0), "blocks": []}
sqln = {"id": "sql_node_GdProcGuard", "type": "sql-node", "data": dict({"database_id": "", "sql": "", "params": {}}, **title("Stored GD Status"),
        script={"type": "sql", "code": sql},
        response_json=[{"key": "gpg1stat", "name": "gd_status", "title": "GD Status", "description": "", "bsonType": "string", "isExpand": False, "children": []}]),
        "blocks": []}
nodes = [
    code("code_node_GdProcGuard", "Processing Guard: Edit of a stored GD?", guard_js, [("gpg1chck", "check"), ("gpg2gdid", "gdId")]),
    if_("if_GdProcGuard", "IF Edit of a stored GD", "'{{node:code_node_GdProcGuard.data.check}}' == 'YES'", 1797500000001, [
        sqln,
        code("code_node_GdProcBusy", "Processing Guard: held by an async job?", busy_js, [("gpg3busy", "busy")]),
        if_("if_GdProcBusy", "IF Processing (async job running)", "'{{node:code_node_GdProcBusy.data.busy}}' == 'YES'", 1797500000003, [ret]),
    ]),
]
d["nodes"] = d["nodes"][:1] + nodes + d["nodes"][1:]
json.dump(d, open(dst, "w"), ensure_ascii=False, separators=(",", ":"))
print("inserted", [n["id"] for n in nodes], "->", dst)
