"""patch_so_save_linked.py [--write]: SO_SAVE (Sales Order/SOsaveWorkflow.json, dev v167) calls SO_CASCADE only when a delivery or a
picking plan names the Sales Order. The cascade gates only diffed the lines, so a line change on an order with nothing downstream
still handed SO_CASCADE both whole tables (~10.5 MB of params at 2,000 lines, 2026-10-16).
- code_node_CascadeRef also returns soIdSql: the stored SO id, digits only ("0" for a new order);
- sql_node_CascadeDocs (right after it): does any delivery / picking plan not Cancelled name this SO - SO_CASCADE's own two
  searches (so_id in, status not Cancelled), tenant-scoped; nothing is read for a new order;
- code_node_CascadeGate / code_node_CascadeB_Gate: no delivery and no plan -> no cascade and no tables; no answer -> as before.
Prints the changed nodes; writes only with --write. The file round-trips json.dumps(indent=2)."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PATH = R + "Sales Order/SOsaveWorkflow.json"
TPL = R + "Picking/PickingLoopWorkflow.json"


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


ID = "{{node:code_node_CascadeRef.data.soIdSql}}"
SQL = """SELECT (EXISTS (SELECT 1
                  FROM goods_delivery g
                 WHERE '%(id)s' <> '0'
                   AND g.tenant_id = '{{system:tenantId}}'
                   AND g.is_deleted = 0
                   AND COALESCE(g.gd_status, '') <> 'Cancelled'
                   AND (JSON_CONTAINS(g.so_id, '%(id)s') OR JSON_CONTAINS(g.so_id, JSON_QUOTE('%(id)s'))))
     OR EXISTS (SELECT 1
                  FROM picking_plan p
                 WHERE '%(id)s' <> '0'
                   AND p.tenant_id = '{{system:tenantId}}'
                   AND p.is_deleted = 0
                   AND COALESCE(p.to_status, '') <> 'Cancelled'
                   AND (JSON_CONTAINS(p.so_id, '%(id)s') OR JSON_CONTAINS(p.so_id, JSON_QUOTE('%(id)s'))))) AS linked""" % {"id": ID}

LINKED = """// no delivery and no picking plan names this order: SO_CASCADE would have nothing to do (no answer: call it as before)
const docsRaw = {{node:sql_node_CascadeDocs.data}};
const docs = Array.isArray(docsRaw) ? docsRaw[0] : docsRaw;
const linked = docs && docs.linked !== undefined && docs.linked !== null ? Number(docs.linked) : 1;
"""


def patch(doc):
    nodes = doc["nodes"]
    assert [n["id"] for n in nodes[:3]] == ["start", "code_node_CascadeRef", "if_BA0MN7OZ"], [n["id"] for n in nodes[:3]]

    ref = nodes[1]
    ref["data"]["script"]["code"] = once(ref["data"]["script"]["code"], """return { cascadeRef: "SO|" + so + "|" + u, releaseOp: "RELEASE" };""",
                                         """return { cascadeRef: "SO|" + so + "|" + u, releaseOp: "RELEASE", soIdSql: so || "0" };""", "ref return")
    ref["data"]["response_json"].append(field("socr_sosql", "soIdSql", "string"))

    sql = clone(find(json.load(open(TPL, encoding="utf-8"))["nodes"], "sql_node_GdBusy"))
    title = "Linked documents: a delivery or picking plan names this Sales Order"
    sql.update({"id": "sql_node_CascadeDocs", "blocks": []})
    sql["data"].update({"title": title, "nodeName": title, "name": title, "response_json": [field("socd_linked", "linked", "number")]})
    sql["data"]["script"] = {"type": "sql", "code": SQL}
    nodes.insert(2, sql)

    gate = find(nodes, "code_node_CascadeGate")
    c = gate["data"]["script"]["code"]
    c = once(c, """const allData = {{workflowparams:allData}};
""", """const allData = {{workflowparams:allData}};
""" + LINKED, "gate A reads")
    c = once(c, """return {
  needsCascade: needsCascade,
  soId: sid(before.id || allData.id),
  prevTableSo: before.table_so || [],
  nextTableSo: (nextTable && nextTable.table_so) || [],""", """return {
  needsCascade: linked ? needsCascade : 0,
  soId: sid(before.id || allData.id),
  prevTableSo: linked ? before.table_so || [] : [],
  nextTableSo: linked ? (nextTable && nextTable.table_so) || [] : [],""", "gate A return")
    gate["data"]["script"]["code"] = c

    gb = find(nodes, "code_node_CascadeB_Gate")
    c = gb["data"]["script"]["code"]
    c = once(c, """const allData = {{workflowparams:allData}};
""", """const allData = {{workflowparams:allData}};
""" + LINKED, "gate B reads")
    c = once(c, """if (!soData || !prevSo) {""", """if (!soData || !prevSo || !linked) {""", "gate B skip")
    gb["data"]["script"]["code"] = c
    return doc


raw = open(PATH, encoding="utf-8").read()
doc = json.loads(raw)
assert json.dumps(doc, ensure_ascii=False, indent=2) + "\n" == raw, "the file does not round-trip json.dumps(indent=2)"
new = patch(clone(doc))
for nid in ("code_node_CascadeRef", "sql_node_CascadeDocs", "code_node_CascadeGate", "code_node_CascadeB_Gate"):
    print("changed:", nid)
if "--write" in sys.argv:
    open(PATH, "w", encoding="utf-8").write(json.dumps(new, ensure_ascii=False, indent=2) + "\n")
    print("written", PATH)
