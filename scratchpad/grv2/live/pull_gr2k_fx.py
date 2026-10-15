"""Read-only dev fixtures for the 2k live GR test payload: the PO's items (+ UOM rows, default bins), the plant's
default storage location / bin, its GR putaway setup and the inventory categories, in the client-API shapes the
phase-2 mock serves. Writes to <out_dir> (session scratchpad), never into the repo.

usage: python3 -I pull_gr2k_fx.py <out_dir> <po_id> <plant_id>
"""
import json
import os
import re
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402

OUT, PO, PLANT = sys.argv[1], sys.argv[2], sys.argv[3]
if not (PO.isdigit() and PLANT.isdigit()):
    sys.exit("ids must be digits")
os.makedirs(OUT, exist_ok=True)
BIG = 2 ** 53
DEC = re.compile(r"^-?\d+\.\d+$|^-?\d+(\.\d+)?[eE][-+]?\d+$")


def norm(v):
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, int):
        return str(v) if abs(v) > BIG else v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, str) and DEC.match(v):
        return float(v)
    return v


def rows(sql):
    return [{k: norm(v) for k, v in r.items()} for r in q("--dev", sql)]


ITEM_COLS = ("id,receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method,"
             "serial_number_management,based_uom,formula,material_code")
ids_sql = f"SELECT item_id FROM purchase_order_2ukyuanr_sub WHERE purchase_order_id = {PO} AND is_deleted = 0"
items = {}
for it in rows(f"SELECT {ITEM_COLS} FROM item WHERE is_deleted = 0 AND id IN ({ids_sql})"):
    it = dict(it, id=str(it["id"]), based_uom=None if it["based_uom"] is None else str(it["based_uom"]))
    it["table_uom_conversion"], it["table_default_bin"] = [], []
    items[it["id"]] = it
for u in rows("SELECT Item_id, alt_qty, alt_uom_id, base_qty, base_uom_id, over_receive_tolerance FROM item_mji552rc_sub "
              f"WHERE is_deleted = 0 AND Item_id IN ({ids_sql}) ORDER BY Item_id, id"):
    iid = str(u.pop("Item_id"))
    items[iid]["table_uom_conversion"].append({k: (str(v) if k.endswith("_id") and v is not None else v) for k, v in u.items()})
for b in rows(f"SELECT Item_id, plant_id, bin_location, storage_location FROM item_wu520fpw_sub WHERE is_deleted = 0 AND Item_id IN ({ids_sql}) ORDER BY Item_id, id"):
    iid = str(b.pop("Item_id"))
    items[iid]["table_default_bin"].append({k: (None if v is None else str(v)) for k, v in b.items()})

out = {
    "Item": items,
    "storage_location": rows(f"SELECT id, plant_id, is_deleted, is_default, location_type FROM storage_location WHERE plant_id = {PLANT} AND is_deleted = 0"),
    "bin_location": rows(f"SELECT id, storage_location_id, plant_id, is_default, is_deleted FROM bin_location WHERE plant_id = {PLANT} AND is_deleted = 0 AND is_default = 1"),
    "putaway_setup": rows(f"SELECT * FROM putaway_setup WHERE plant_id = {PLANT} AND is_deleted = 0"),
    "blade_dict": rows("SELECT id, code, dict_key, dict_value, sort, is_deleted FROM blade_dict WHERE code = 'inventory_category' AND is_deleted = 0 ORDER BY sort, id"),
}
with open(os.path.join(OUT, "tables.json"), "w") as f:
    json.dump(out, f, ensure_ascii=False)
print("items", len(items), "| with UOM rows", sum(1 for i in items.values() if i["table_uom_conversion"]),
      "| with default bins", sum(1 for i in items.values() if i["table_default_bin"]),
      "| batch", sum(1 for i in items.values() if i["item_batch_management"] == 1),
      "| serial", sum(1 for i in items.values() if i["serial_number_management"] == 1),
      "| inspection", sum(1 for i in items.values() if i["receiving_inspection"] == 1),
      "| costing", sorted({str(i["material_costing_method"]) for i in items.values()}))
print("storage_location", len(out["storage_location"]), "| default bins", len(out["bin_location"]), "| putaway_setup", len(out["putaway_setup"]),
      "| categories", len(out["blade_dict"]))
