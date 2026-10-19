"""Replay a real Goods Receiving through the revert logic, using live dev data.

This does not write anything. It fetches exactly what the workflow's own nodes
would fetch, feeds it through the two code nodes extracted from the workflow
JSON, and prints the conflicts and the writes that would follow.
"""
import sys, json, subprocess, os
sys.path.insert(0, "scratchpad")
from harness import load, run

DB = ".dbtools/db"
ENV = "--dev"

def q(sql):
    out = subprocess.run([DB, ENV, "--json", "--limit", "0", sql],
                         capture_output=True, text=True).stdout
    i = out.index("[")
    return json.loads(out[i:])

def s(v):
    return "" if v is None else str(v)

GR_ID = sys.argv[1] if len(sys.argv) > 1 else "2095080385470332929"

gr = q(f"SELECT * FROM goods_receiving WHERE id={GR_ID}")[0]
gr = {k: (str(v) if k.endswith("_id") or k == "id" else v) for k, v in gr.items()}
gr["po_id"] = json.loads(gr["po_id"]) if isinstance(gr.get("po_id"), str) and gr["po_id"].startswith("[") else gr.get("po_id")
gr["po_id"] = [str(x) for x in (gr["po_id"] or [])]
lines = q(f"SELECT * FROM goods_receiving_eg6l4ywi_sub WHERE goods_receiving_id={GR_ID} AND is_deleted=0 ORDER BY id")
gr["table_gr"] = [{k: (str(v) if (k.endswith("_id") or k == "id") and v is not None else v)
                   for k, v in ln.items()} for ln in lines]
GR_NO, ORG, PLANT = gr["gr_no"], s(gr["organization_id"]), s(gr["plant_id"])

movs = q(f"""SELECT CAST(id AS CHAR) id, transaction_type, movement, trx_no, parent_trx_no,
  CAST(item_id AS CHAR) item_id, CAST(plant_id AS CHAR) plant_id,
  CAST(bin_location_id AS CHAR) bin_location_id, CAST(batch_number_id AS CHAR) batch_number_id,
  CAST(handling_unit_id AS CHAR) handling_unit_id, inventory_category, quantity, base_qty,
  CAST(uom_id AS CHAR) uom_id, CAST(base_uom_id AS CHAR) base_uom_id, unit_price, costing_method_id
  FROM inventory_movement WHERE id > {GR_ID} AND organization_id='{ORG}'
  AND (trx_no='{GR_NO}' OR COALESCE(parent_trx_no,'')='{GR_NO}') AND is_deleted=0 ORDER BY id""")

items = [str(x) for x in {s(l.get("item_id")) for l in gr["table_gr"]} |
         {s(m["item_id"]) for m in movs} if x]
csv = ",".join(items) or "0"
item_rows = q(f"SELECT * FROM item WHERE id IN ({csv})")
for it in item_rows:
    it["id"] = str(it["id"])
    it["based_uom"] = s(it.get("based_uom"))
    it["table_uom_conversion"] = q(
        f"SELECT CAST(alt_uom_id AS CHAR) alt_uom_id, base_qty FROM item_mji552rc_sub "
        f"WHERE item_id={it['id']} AND is_deleted=0")

minlive = min([m["id"] for m in movs if m["transaction_type"] == "GRN"] or [str(GR_ID)])
later = q(f"""SELECT CAST(item_id AS CHAR) item_id, CAST(batch_number_id AS CHAR) batch_id,
  CAST(MAX(id) AS CHAR) max_id,
  SUBSTRING_INDEX(GROUP_CONCAT(CONCAT(transaction_type,' ',COALESCE(trx_no,'')) ORDER BY id DESC SEPARATOR '|'),'|',1) latest
  FROM inventory_movement WHERE id > {minlive} AND organization_id='{ORG}' AND plant_id={PLANT}
  AND item_id IN ({csv})
  AND NOT (transaction_type IN ('GRN','GRN-R') AND trx_no='{GR_NO}')
  AND NOT (transaction_type IN ('HU','HU-R') AND COALESCE(parent_trx_no,'')='{GR_NO}')
  AND NOT (transaction_type = 'TO - PA' AND COALESCE(parent_trx_no,'')='{GR_NO}')
  AND is_deleted=0 GROUP BY item_id, batch_number_id""")

fifo = q(f"""SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id,
  CAST(batch_id AS CHAR) batch_id, fifo_cost_price, fifo_initial_quantity,
  fifo_available_quantity, fifo_sequence FROM fifo_costing_history
  WHERE id > {GR_ID} AND organization_id='{ORG}' AND plant_id={PLANT}
  AND material_id IN ({csv}) AND is_deleted=0""")
wa = q(f"""SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id,
  CAST(batch_id AS CHAR) batch_id, wa_quantity, wa_cost_price FROM wa_costing_method
  WHERE organization_id='{ORG}' AND plant_id='{PLANT}' AND material_id IN ({csv})
  AND is_deleted=0 AND (batch_id IS NULL OR id > {GR_ID})""")
cost = q(f"""SELECT 'FIFO' t, CAST(material_id AS CHAR) material_id, COUNT(*) cnt
  FROM fifo_costing_history WHERE organization_id='{ORG}' AND plant_id={PLANT}
  AND material_id IN ({csv}) AND is_deleted=0 GROUP BY material_id
  UNION ALL SELECT 'WA', CAST(material_id AS CHAR), COUNT(*) FROM wa_costing_method
  WHERE organization_id='{ORG}' AND plant_id='{PLANT}' AND material_id IN ({csv})
  AND is_deleted=0 GROUP BY material_id""")

def strids(rows):
    return [{k: (str(v) if (k.endswith("_id") or k == "id") and v is not None else v)
             for k, v in r.items()} for r in rows]

putaway = strids(q(f"SELECT * FROM transfer_order_putaway WHERE gr_no='{GR_ID}' AND is_deleted=0"))
for t in putaway:
    t["table_putaway_item"] = strids(q(
        f"SELECT * FROM transfer_order_putaway_jz8m9w3h_sub WHERE transfer_order_putaway_id={t['id']} AND is_deleted=0"))
qi = strids(q(f"SELECT * FROM basic_inspection_lot WHERE goods_receiving_no='{GR_ID}' AND is_deleted=0"))
transit = strids(q(f"SELECT * FROM in_transit_detail WHERE doc_id='{GR_ID}' AND doc_type='Goods Receiving' AND is_deleted=0"))
batch = strids(q(f"SELECT * FROM batch WHERE transaction_no='{GR_NO}' AND organization_id='{ORG}' AND is_deleted=0"))
pi = strids(q(f"SELECT * FROM purchase_invoice WHERE organization_id='{ORG}' AND is_deleted=0 AND JSON_CONTAINS(gr_id, JSON_QUOTE('{GR_ID}'))"))
batchids = [m["batch_number_id"] for m in movs if m.get("batch_number_id")] or ["-1"]
batchbal = strids(q(f"SELECT * FROM item_batch_balance WHERE batch_id IN ({','.join(batchids)}) AND plant_id={PLANT} AND is_deleted=0"))
itembal = strids(q(f"SELECT * FROM item_balance WHERE material_id IN ({csv}) AND plant_id={PLANT} AND is_deleted=0"))
huids = [m["handling_unit_id"] for m in movs if m.get("handling_unit_id")] or ["-1"]
hu = strids(q(f"SELECT * FROM handling_unit WHERE id IN ({','.join(huids)}) AND is_deleted=0"))
poids = gr["po_id"] or ["-1"]
po = strids(q(f"SELECT * FROM purchase_order WHERE id IN ({','.join(poids)}) AND is_deleted=0"))
for x in po:
    x["table_po"] = strids(q(f"SELECT * FROM purchase_order_2ukyuanr_sub WHERE purchase_order_id={x['id']} AND is_deleted=0"))
polines = [s(l.get("po_line_item_id")) for l in gr["table_gr"] if l.get("po_line_item_id")] or ["-1"]
onorder = strids(q(f"SELECT * FROM on_order_purchase_order WHERE po_line_id IN ({','.join(polines)}) AND is_deleted=0"))

M = load("Goods Receiving/RevertCompletedGR/GRrevertCompletedWorkflow.json")
prm = run(M["code_node_grRvParams"]["data"]["script"]["code"],
          {"wp": {"gr_id": str(GR_ID), "gr_no": GR_NO, "organization_id": ORG}, "node": {}})
prep = run(M["code_node_grRvPrep"]["data"]["script"]["code"], {"wp": {}, "node": {
    "code_node_grRvParams": {"data": prm},
    "get_node_grRvGr": {"data": {"data": gr, "count": 1}},
    "sql_node_grRvMovs": {"data": movs}}})

print(f"=== {GR_NO}  status={gr['gr_status']}  putaway={gr['putaway_status']}")
print(f"movements fetched : {[(m['transaction_type'], m['movement'], m['base_qty']) for m in movs]}")
print(f"refuse            : {prep['refuse']} {prep['refuseMessage']}")
if prep["refuse"] == 1:
    sys.exit(0)
print(f"live rows         : {[(r['id'], r['base_qty']) for r in prep['liveRows']]}")
print(f"stock sits at     : {[(l['location_id'], l['inventory_category'], l['qty']) for l in prep['locations']]}")

build = run(M["code_node_grRvBuild"]["data"]["script"]["code"], {"wp": {}, "node": {
    "code_node_grRvPrep": {"data": prep},
    "sql_node_grRvLater": {"data": later}, "sql_node_grRvFifo": {"data": fifo},
    "sql_node_grRvWa": {"data": wa}, "sql_node_grRvCostCounts": {"data": cost},
    "search_node_grRvPi": {"data": {"data": pi}},
    "search_node_grRvBatchBal": {"data": {"data": batchbal}},
    "search_node_grRvItemBal": {"data": {"data": itembal}},
    "search_node_grRvHu": {"data": {"data": hu}},
    "search_node_grRvPo": {"data": {"data": po}},
    "search_node_grRvOnOrder": {"data": {"data": onorder}},
    "search_node_grRvItems": {"data": {"data": item_rows}},
    "search_node_grRvPutaway": {"data": {"data": putaway}},
    "search_node_grRvQi": {"data": {"data": qi}},
    "search_node_grRvTransit": {"data": {"data": transit}},
    "search_node_grRvBatch": {"data": {"data": batch}}}})

print(f"conflicts         : {[c['type'] + ': ' + c['message'] for c in build['conflicts']] or 'none'}")
print(f"subtract          : {[(x['material_id'], x['quantity'], x['location_id'], x['inventory_category']) for x in build['subtracts']]}")
print(f"fifo removed      : {[x['fifoDeleteId'] for x in build['subtracts'] if x['hasFifoDelete']]}")
print(f"putaway cancelled : {build['putawayDeletes']}")
print(f"in transit        : {build['transitUpdates']}")
print(f"inspection        : {build['qiDeletes']}")
print(f"PO lines          : {build['poLineUpdates']}")
print(f"on order          : {build['onOrderUpdates']}")
print(f"PO headers        : {build['poHeaderUpdates']}")
