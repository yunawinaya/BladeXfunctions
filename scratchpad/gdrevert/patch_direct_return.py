"""patch_direct_return.py [--write]: GD_PROCESS_REVERT (Goods Delivery/RevertCompletedGD/GDrevertInventoryProcessWorkflow.json, dev v13)
also puts back the stock a completion delivered with no reservation behind it. Completion's "deliver remaining directly from
unrestricted (no reserved record needed)" branch writes GDL OUT Unrestricted movements and no on_reserved_gd row, so the
revert, which works from the reservations, never returned that stock (prod 836238 JO-01054 / JO-01069).
- sql_node_inDirectOut (after sql_node_inDlvCost): per item / batch / bin / handling unit, the GD's GDL movements in the day
  after its active snapshot (= the completion's: the snapshot is written before them), the net quantity that left (OUT -
  IN, base units) and the cost of the Unrestricted outs.
- code_node_inConflictBatch: after the reservation returns, each balance's net out minus what the reservations put back
  (in base units) goes back to Unrestricted at the cost it left at (ADD, isMovingInv 0 as the loop already sends).
  Handling-unit stock is left to the HU revert (V2 sends those deliveries to the classic revert unchanged).
Exact text edits on the repo JSON; every anchor must match once."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
F = R + "Goods Delivery/RevertCompletedGD/GDrevertInventoryProcessWorkflow.json"
DAY = 86400000 << 22
SQL = """SELECT CAST(o.item_id AS CHAR) AS item,
       IFNULL(NULLIF(CAST(o.batch_number_id AS CHAR), ''), '0') AS b,
       IFNULL(CAST(o.bin_location_id AS CHAR), '') AS bin,
       IFNULL(NULLIF(CAST(o.handling_unit_id AS CHAR), ''), '0') AS hu,
       CAST(IFNULL(SUM(CASE WHEN UPPER(o.movement) = 'OUT' THEN 1 ELSE -1 END * COALESCE(o.base_qty, o.quantity)), 0) AS CHAR) AS net_bq,
       CAST(IFNULL(SUM(CASE WHEN UPPER(o.movement) = 'OUT' AND o.inventory_category = 'Unrestricted' THEN o.total_price END), 0) AS CHAR) AS u_tp,
       CAST(IFNULL(SUM(CASE WHEN UPPER(o.movement) = 'OUT' AND o.inventory_category = 'Unrestricted' THEN COALESCE(o.base_qty, o.quantity) END), 0) AS CHAR) AS u_bq,
       MAX(o.parent_trx_no) AS parent_no
FROM inventory_movement o
WHERE o.id > CAST('{{node:code_node_inParseSnap.data.snapshotRecordId}}' AS UNSIGNED)
  AND o.id < CAST('{{node:code_node_inParseSnap.data.snapshotRecordId}}' AS UNSIGNED) + %d
  AND o.organization_id = '{{node:code_node_inExtract.data.organizationIdSql}}'
  AND o.trx_no = '{{node:code_node_inExtract.data.gdNoSql}}'
  AND o.transaction_type = 'GDL'
  AND o.is_deleted = 0
GROUP BY 1, 2, 3, 4""" % DAY
COLS = [("item", "Item ID"), ("b", "Batch ID"), ("bin", "Bin ID"), ("hu", "Handling Unit ID"), ("net_bq", "Net Base Qty Out"), ("u_tp", "Unrestricted Out Total Price"),
        ("u_bq", "Unrestricted Out Base Qty"), ("parent_no", "Parent Trx No")]
ANCHOR = "\n// 2. Fragment soft-deletes\n"
BLOCK = """
// 1b. Stock the completion delivered with no reservation behind it (straight from Unrestricted): what left in the
// completion, less what the reservations above put back, goes back to Unrestricted at the cost it left at
const directRaw = [{{node:sql_node_inDirectOut.data}}][0];
const directRows = Array.isArray(directRaw) ? directRaw : (directRaw ? [directRaw] : []);
const toBase = (it, uom, qty) => {
  if (!it || !uom || String(uom) === String(it.based_uom)) return qty;
  const c = (it.table_uom_conversion || []).find((u) => String(u.alt_uom_id) === String(uom));
  return c ? qty * (parseFloat(c.base_qty) || 1) : qty;
};
const reservedBack = {};
for (const m of inventoryMovements) {
  const k = [m.material_id, m.batch_id, m.location_id, m.handling_unit_id].map(costPart).join("|");
  reservedBack[k] = (reservedBack[k] || 0) + toBase(m.itemData, m.material_uom, m.quantity);
}
for (const d of directRows) {
  if (costPart(d.hu) !== "0") continue;
  const k = [d.item, d.b, d.bin, d.hu].map(costPart).join("|");
  const qty = q8((parseFloat(d.net_bq) || 0) - (reservedBack[k] || 0));
  const it = itemDataMap[String(d.item)] || null;
  if (qty <= EPS || !it || Number(it.stock_control) === 0) continue;
  const ubq = parseFloat(d.u_bq) || 0;
  inventoryMovements.push({
    material_id: String(d.item),
    quantity: qty,
    material_uom: it.based_uom != null ? String(it.based_uom) : "",
    location_id: d.bin != null ? String(d.bin) : "",
    batch_id: costPart(d.b) === "0" ? null : String(d.b),
    handling_unit_id: null,
    inventory_category: "Unrestricted",
    unit_price: ubq > 0 ? q8((parseFloat(d.u_tp) || 0) / ubq) : deliveryCost({ material_id: d.item, batch_id: d.b, bin_location: d.bin, handling_unit_id: d.hu }),
    parent_no: d.parent_no || "",
    itemData: it,
    index: inventoryMovements.length,
  });
}
"""


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return n
        for v in n.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, nid)
            if r:
                return r
    return None


raw = open(F, encoding="utf-8").read()
doc = json.loads(raw)
assert find(doc, "sql_node_inDirectOut") is None, "already patched"
cost = find(doc, "sql_node_inDlvCost")
node = json.loads(json.dumps(cost))
node["id"] = "sql_node_inDirectOut"
for k in ("title", "nodeName", "name"):
    node["data"][k] = "Get Direct Delivery"
node["data"]["script"]["code"] = SQL
node["data"]["response_json"] = [{"key": "rvdo%02d%s" % (i, c[:2]), "name": c, "title": t, "description": "", "bsonType": "string", "isExpand": False, "children": []}
                                 for i, (c, t) in enumerate(COLS)]
top = doc["nodes"]
top.insert([n["id"] for n in top].index("sql_node_inDlvCost") + 1, node)
cb = find(doc, "code_node_inConflictBatch")
code = cb["data"]["script"]["code"]
assert code.count(ANCHOR) == 1, "the fragment anchor"
cb["data"]["script"]["code"] = code.replace(ANCHOR, BLOCK + ANCHOR)
print("GD_PROCESS_REVERT: + sql_node_inDirectOut (after sql_node_inDlvCost), code_node_inConflictBatch +%d chars" % len(BLOCK))
if "--write" in sys.argv:
    open(F, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=2) + ("\n" if raw.endswith("\n") else ""))
    print("wrote", F)
