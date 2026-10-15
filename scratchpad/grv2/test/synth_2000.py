"""Harness (e) input: a synthetic N-line Goods Receiving, as PREPARE's SQL would read it, built from REAL dev rows (a
template GR and its first line, the tenant's items with their UOM rows, its putaway setup / loading bay / numbering
rule, its batch number configs) and synthetic ids for what does not exist (the lines, one PO with N lines, their
on-order rows). Read-only; writes nothing to the DB.

usage: python3 synth_2000.py --dev <template_gr_id> <N> <out.json> [--batch-every K] [--category "In Transit"]
  --batch-every K: every K-th line takes a batch-managed item, alternately auto-numbered and a manual number
Output holds dev data: write it to the session scratchpad.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "prepare"))
from dbq import q  # noqa: E402
from sql import SQL, SUBMIT_SQL  # noqa: E402


def fill(sql, vals):
    return re.sub(r"\{\{node:[^}.]+\.data\.([A-Za-z]+)\}\}", lambda m: vals[m.group(1)], sql)


def main():
    env, gr_id, n, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    every = int(sys.argv[sys.argv.index("--batch-every") + 1]) if "--batch-every" in sys.argv else 0
    category = sys.argv[sys.argv.index("--category") + 1] if "--category" in sys.argv else None
    g = q(env, f"SELECT tenant_id, organization_id, CAST(plant_id AS CHAR) plant FROM goods_receiving WHERE id = {gr_id}")[0]
    vals = {"tenantId": g["tenant_id"], "grId": gr_id, "organizationId": g["organization_id"], "plantId": g["plant"]}
    S = {k: q(env, fill(SQL[k], vals)) for k in ("hdr", "lines", "setup", "bnc")}
    hdr = json.loads(S["hdr"][0]["j"])
    tmpl = json.loads(S["lines"][0]["j"])
    t = g["tenant_id"]
    org = g["organization_id"]
    plain = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM item WHERE tenant_id = '{t}' AND organization_id = '{org}' AND is_deleted = 0 AND stock_control = 1 "
                                      "AND item_batch_management = 0 AND serial_number_management = 0 AND material_costing_method = 'First In First Out' ORDER BY id LIMIT 2000")]
    batchy = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM item WHERE tenant_id = '{t}' AND organization_id = '{org}' AND is_deleted = 0 AND stock_control = 1 "
                                       "AND item_batch_management = 1 AND serial_number_management = 0 AND (material_costing_method IS NULL OR material_costing_method <> 'Weighted Average') ORDER BY id LIMIT 20")]
    ids = sorted(set(plain + batchy), key=int)
    S["items"] = q(env, fill(SUBMIT_SQL["items"], dict(vals, itemIdsSql=",".join(ids))))
    items = {json.loads(r["j"])["id"]: json.loads(r["j"]) for r in S["items"]}
    po_id = 9100000000000000000 + int(gr_id) % 1000000
    po_no = "SYN-PO-" + gr_id[-6:]
    base_line = 9200000000000000000 + (int(gr_id) % 1000000) * 10000
    base_po_line = 9300000000000000000 + (int(gr_id) % 1000000) * 10000
    base_oo = 9400000000000000000 + (int(gr_id) % 1000000) * 10000
    lines, pol, oo = [], [], []
    for i in range(n):
        use_batch = every and batchy and i % every == 0
        item_id = batchy[(i // every) % len(batchy)] if use_batch else plain[i % len(plain)]
        it = items[item_id]
        uom = int(it["based_uom"]) if it.get("based_uom") else tmpl.get("item_uom")
        line = dict(tmpl)
        line.update({"id": base_line + i, "item_id": int(item_id), "item_name": it.get("material_name"), "item_desc": it.get("material_desc"),
                     "item_uom": uom, "base_item_uom": uom, "ordered_qty_uom": uom, "to_received_qty_uom": uom, "base_ordered_qty_uom": uom,
                     "ordered_qty": 10, "base_ordered_qty": 10, "to_received_qty": 5, "received_qty": 5, "base_received_qty": 5, "initial_received_qty": 0,
                     "unit_price": 12.5, "total_price": 62.5, "line_po_id": po_id, "line_po_no": po_no, "po_line_item_id": base_po_line + i,
                     "item_batch_no": ("Auto-generated batch number" if (i // every) % 2 == 0 else "SYN-B" + str(i)) if use_batch else "-",
                     "line_index": str(i + 1), "is_split": "No", "parent_or_child": "Parent", "parent_index": i, "parent_id": None, "item_bundle_id": None,
                     "temp_hu_data": None, "manufacturing_date": None, "expired_date": None, "inspection_required": "No"})
        if category:
            line["inv_category"] = category
        lines.append({"j": json.dumps(line)})
        pol.append({"j": json.dumps({"id": str(base_po_line + i), "purchase_order_id": str(po_id), "item_id": item_id, "item_name": it.get("material_name"),
                                     "quantity": 10, "quantity_uom": str(uom), "po_amount": 125, "received_qty": 0, "created_received_qty": 0,
                                     "outstanding_quantity": 10, "line_status": "Issued", "line_index": str(i + 1)})})
        oo.append({"j": json.dumps({"id": str(base_oo + i), "po_line_id": str(base_po_line + i), "po_id": str(po_id), "open_qty": 10, "received_qty": 0,
                                    "scheduled_qty": 10, "material_id": item_id, "plant_id": g["plant"], "organization_id": org, "purchase_order_number": po_no})})
    hdr["gr_status"] = "Processing"
    hdr["po_id"] = [str(po_id)]
    S["hdr"] = [{"j": json.dumps(hdr)}]
    S["lines"] = lines
    S["pol"] = pol
    S["poh"] = [{"j": json.dumps({"id": str(po_id), "purchase_order_no": po_no, "po_status": "Issued", "gr_status": "", "exchange_rate": 1, "organization_id": org})}]
    S["oo"] = oo
    S["batches"] = []
    S["lock"] = [{"step_name": "LOCK|1", "result_ref": "TEST-KEY"}]
    S["_vals"] = vals
    json.dump(S, open(out, "w"))
    sizes = {k: sum(len(json.dumps(r)) for r in v) for k, v in S.items() if isinstance(v, list)}
    print(out, n, "lines", len(ids), "items;", "sql-node bytes", sizes, "total", sum(sizes.values()))


if __name__ == "__main__":
    main()
