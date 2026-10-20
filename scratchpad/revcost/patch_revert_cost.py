"""patch_revert_cost.py: GD_PROCESS_REVERT v12 -> v13. Revert Completed put the returned stock back through ADD_INVENTORY_NEW
without a unit_price, so FIFO / Weighted Average items came back at cost 0. Adds sql_node_inDlvCost (this completion's OUT
Reserved movements: cost per base unit by material + batch + bin + handling unit), attaches unit_price to every inventory
movement in code_node_inConflictBatch, and passes it to ADD_INVENTORY_NEW. Rewrites the repo file in its own format."""
import json
import sys

REPO = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/RevertCompletedGD/GDrevertInventoryProcessWorkflow.json"
path = sys.argv[1] if len(sys.argv) > 1 else REPO
d = json.load(open(path, encoding="utf8"))
nodes = d["nodes"]


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


def keys(o, out):
    if isinstance(o, dict):
        if isinstance(o.get("key"), str):
            out.add(o["key"])
        for v in o.values():
            keys(v, out)
    elif isinstance(o, list):
        for v in o:
            keys(v, out)
    return out


assert not find(d, "sql_node_inDlvCost"), "already patched"

SQL = """SELECT x.item, x.b, x.bin, x.hu,
       CAST(IFNULL(SUM(x.total_price), 0) AS CHAR) AS tp,
       CAST(IFNULL(SUM(x.bq), 0) AS CHAR) AS bq
FROM (
  SELECT CAST(o.item_id AS CHAR) AS item,
         IFNULL(NULLIF(CAST(o.batch_number_id AS CHAR), ''), '0') AS b,
         IFNULL(CAST(o.bin_location_id AS CHAR), '') AS bin,
         IFNULL(NULLIF(CAST(o.handling_unit_id AS CHAR), ''), '0') AS hu,
         o.id, o.transaction_type, o.movement, o.inventory_category, o.total_price,
         COALESCE(o.base_qty, o.quantity) AS bq,
         MAX(CASE WHEN o.transaction_type = 'GDL-R' THEN o.id END) OVER () AS last_r
  FROM inventory_movement o
  WHERE o.organization_id = '{{node:code_node_inExtract.data.organizationIdSql}}'
    AND o.trx_no = '{{node:code_node_inExtract.data.gdNoSql}}'
    AND o.transaction_type IN ('GDL', 'GDL-R')
    AND o.is_deleted = 0
) x
WHERE x.transaction_type = 'GDL'
  AND x.movement = 'OUT'
  AND x.inventory_category = 'Reserved'
  AND x.id > IFNULL(x.last_r, 0)
GROUP BY x.item, x.b, x.bin, x.hu"""

taken = keys(d, set())
cols = [("item", "Item ID"), ("b", "Batch ID"), ("bin", "Bin ID"), ("hu", "Handling Unit ID"), ("tp", "Total Price"), ("bq", "Base Qty")]
resp = []
for i, (name, title) in enumerate(cols):
    k = "rvdc%02d%s" % (i, name[:2])
    assert k not in taken, k
    resp.append({"key": k, "name": name, "title": title, "description": "", "bsonType": "string", "isExpand": False, "children": []})

ex = find(d, "code_node_inExtract")["data"]
xcode = ex["script"]["code"]
xanchor = '  materialIds.filter((id) => /^[0-9]+$/.test(String(id))).join(",") || "0";\n'
assert xcode.count(xanchor) == 1 and xcode.count("  hasSnapshotId: snapshotId ? 1 : 0,\n") == 1
xcode = xcode.replace(xanchor, xanchor + (
    "// Quote-safe copies for Get Delivery Cost's SQL: the org id digits only, the GD number with ' and \\ escaped\n"
    'const organizationIdSql = /^[0-9]{1,20}$/.test(String(organizationId)) ? String(organizationId) : "0";\n'
    + r'''const gdNoSql = String(gdNo).replace(/\\/g, "\\\\").replace(/'/g, "''");''' + "\n"))
xcode = xcode.replace("  hasSnapshotId: snapshotId ? 1 : 0,\n", "  organizationIdSql,\n  gdNoSql,\n  hasSnapshotId: snapshotId ? 1 : 0,\n")
ex["script"]["code"] = xcode
shape = next(r for r in ex["response_json"] if r["name"] == "gdNo")
for k, name in (("in9orgs09", "organizationIdSql"), ("inAgdns10", "gdNoSql")):
    assert k not in taken, k
    ex["response_json"].append(dict(json.loads(json.dumps(shape)), key=k, name=name, title=name))

items = find(d, "sql_node_InItems")
new = json.loads(json.dumps(items))
new["id"] = "sql_node_inDlvCost"
for f in ("title", "nodeName", "name"):
    new["data"][f] = "Get Delivery Cost"
new["data"]["script"]["code"] = SQL
new["data"]["response_json"] = resp
at = next(i for i, n in enumerate(nodes) if n["id"] == "sql_node_InItems")
nodes.insert(at + 1, new)

cb = find(d, "code_node_inConflictBatch")["data"]["script"]
code = cb["code"]
anchor = 'const docId = {{node:code_node_inExtract.data.docId}} || "";\n'
assert code.count(anchor) == 1
block = (
    "// the cost each unit left at, so a revert never puts stock back at cost 0\n"
    "const dlvCostRaw = [{{node:sql_node_inDlvCost.data}}][0];\n"
    "const dlvCostRows = Array.isArray(dlvCostRaw) ? dlvCostRaw : (dlvCostRaw ? [dlvCostRaw] : []);\n"
    'const costPart = (v) => (v === null || v === undefined || v === "" ? "0" : String(v));\n'
    "const costAcc = {};\n"
    "const addCost = (k, tp, bq) => {\n"
    "  const a = costAcc[k] || (costAcc[k] = { tp: 0, bq: 0 });\n"
    "  a.tp += tp;\n"
    "  a.bq += bq;\n"
    "};\n"
    "for (const c of dlvCostRows) {\n"
    "  const bq = parseFloat(c && c.bq) || 0;\n"
    "  if (bq <= 0) continue;\n"
    "  const tp = parseFloat(c.tp) || 0;\n"
    '  addCost([c.item, c.b, c.bin, c.hu].map(costPart).join("|"), tp, bq);\n'
    '  addCost([c.item, c.b].map(costPart).join("|"), tp, bq);\n'
    "  addCost(costPart(c.item), tp, bq);\n"
    "}\n"
    "const deliveryCost = (r) => {\n"
    "  for (const k of [[r.material_id, r.batch_id, r.bin_location, r.handling_unit_id], [r.material_id, r.batch_id], [r.material_id]]) {\n"
    '    const a = costAcc[k.map(costPart).join("|")];\n'
    "    if (a && a.bq > 0) return q8(a.tp / a.bq);\n"
    "  }\n"
    "  return 0;\n"
    "};\n"
)
code = code.replace(anchor, anchor + block)
push = '      inventory_category: "Reserved",\n'
assert code.count(push) == 1
code = code.replace(push, push + "      unit_price: deliveryCost(r),\n")
cb["code"] = code

wn = find(d, "workflow_node_inAddInv")["data"]["body_params"]["list"]
assert not any(p["prop"] == "unit_price" for p in wn)
qi = next(i for i, p in enumerate(wn) if p["prop"] == "quantity")
wn.insert(qi + 1, {"prop": "unit_price", "operator": "", "valueType": "field", "value": "{{node:loop_inInvMovements.unit_price}}", "valueLabel": "", "propLabel": "Unit Price"})

open(path, "w", encoding="utf8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("patched", path)
