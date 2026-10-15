"""Read-only dev fixtures for the Phase 2 GR client harness and the PO_Convert_GR parity run.
Writes customer data to the session scratchpad (argv[1]), never into the repo.

  python3 pull_fixtures.py <out_dir>
"""
import json
import os
import re
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
BIG = 2 ** 53
DEC = re.compile(r"^-?\d+\.\d+$|^-?\d+(\.\d+)?[eE][-+]?\d+$")


def norm(v):
    """Client-API shapes: snowflake ids as strings, decimals as numbers."""
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


def dump(name, obj):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(obj, f, ensure_ascii=False)
    print("wrote", name)


ITEM_COLS = ("id,receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method,"
             "serial_number_management,based_uom,formula,material_code")
UOM_COLS = "Item_id,alt_qty,alt_uom_id,base_qty,base_uom_id,over_receive_tolerance"
BIN_COLS = "Item_id,plant_id,bin_location,storage_location"


def items_by_ids(ids_sql):
    items = rows(f"SELECT {ITEM_COLS} FROM item WHERE is_deleted=0 AND id IN ({ids_sql})")
    uoms = rows(f"SELECT {UOM_COLS} FROM item_mji552rc_sub WHERE is_deleted=0 AND Item_id IN ({ids_sql}) ORDER BY Item_id, id")
    bins = rows(f"SELECT {BIN_COLS} FROM item_wu520fpw_sub WHERE is_deleted=0 AND Item_id IN ({ids_sql}) ORDER BY Item_id, id")
    out = {}
    for it in items:
        it = dict(it, id=str(it["id"]), based_uom=str(it["based_uom"]) if it["based_uom"] is not None else None)
        it["table_uom_conversion"], it["table_default_bin"] = [], []
        out[it["id"]] = it
    for u in uoms:
        iid = str(u.pop("Item_id"))
        u = {k: (str(v) if k.endswith("_id") and v is not None else v) for k, v in u.items()}
        out[iid]["table_uom_conversion"].append(u)
    for b in bins:
        iid = str(b.pop("Item_id"))
        out[iid]["table_default_bin"].append({k: (str(v) if v is not None else v) for k, v in b.items()})
    return out


# 1. PO/20261009/001 (tenant 496474, 50 lines): header + lines in the search-node shape PO_Convert_GR reads
po = rows("SELECT * FROM purchase_order WHERE purchase_order_no='PO/20261009/001' AND is_deleted=0")[0]
lines = rows(f"SELECT * FROM purchase_order_2ukyuanr_sub WHERE purchase_order_id={po['id']} AND is_deleted=0 ORDER BY line_index, id")
for ln in lines:
    for k in ("id", "item_id", "quantity_uom", "item_category_id", "tariff_id", "project_id", "parent_id", "item_bundle_id"):
        if ln.get(k) is not None:
            ln[k] = str(ln[k])
po = {k: (str(v) if k in ("id", "po_supplier_id", "project_id") and v is not None else v) for k, v in po.items()}
po["table_po"] = lines
dump("po_50.json", po)
dump("items_50.json", items_by_ids(f"SELECT item_id FROM purchase_order_2ukyuanr_sub WHERE purchase_order_id={po['id']} AND is_deleted=0"))

# 2. 2,000 real items of tenant 711077 (the plan's 2k test tenant)
ids = [str(r["id"]) for r in q("--dev", "SELECT id FROM item WHERE is_deleted=0 AND tenant_id='711077' ORDER BY id LIMIT 2000")]
dump("items_2000.json", items_by_ids(",".join(ids)))
uom_rows = rows("SELECT id, uom_name FROM unit_of_measurement WHERE is_deleted=0 AND tenant_id IN ('711077','496474') LIMIT 50")
dump("uoms.json", [str(r["id"]) for r in uom_rows])

# 3. plant config: default storage location + bin of the 50-line PO's plant, every GR putaway setup shape, inventory categories
plant = str(po["po_plant"])
dump("plant.json", {
    "plant_id": plant,
    "storage_location": rows(f"SELECT id FROM storage_location WHERE plant_id={plant} AND is_deleted=0 AND is_default=1 AND location_type='Common'"),
    "bin_location": rows(f"SELECT id, storage_location_id, is_default FROM bin_location WHERE plant_id={plant} AND is_deleted=0 AND is_default=1"),
    "putaway_setups": rows("SELECT id, plant_id, movement_type, putaway_required, category, show_hu FROM putaway_setup "
                           "WHERE is_deleted=0 AND movement_type='Good Receiving' AND tenant_id IN ('496474','711077','000000')"),
    "inventory_category": rows("SELECT id, code, dict_key, dict_value, sort FROM blade_dict WHERE code='inventory_category' AND is_deleted=0 ORDER BY sort, id"),
})

# 4. every recorded PO_Convert_GR run: the code node's resolved inputs and its recorded answer
wf = q("--dev", "SELECT id FROM su_code_workflow WHERE is_deleted=0 AND name='PO_Convert_GR'")[0]["id"]
runs = []
for r in q("--dev", f"SELECT id, status, nodes_data FROM su_code_workflow_inst WHERE workflow_id={wf} ORDER BY id"):
    nd = json.loads(r["nodes_data"] or "[]", strict=False, parse_int=lambda x: x if abs(int(x)) > BIG else int(x))
    cn = [n for n in nd if n.get("node_id") == "code_node_PoGrMap"]
    if not cn:
        continue
    req = json.loads(cn[0]["request_json_data"], strict=False, parse_int=lambda x: x if abs(int(x)) > BIG else int(x))
    resp = json.loads(cn[0]["response_json_data"] or "null", strict=False, parse_int=lambda x: x if abs(int(x)) > BIG else int(x))
    runs.append({"id": str(r["id"]), "status": r["status"], "variableMap": req.get("variableMap"), "response": resp})
dump("po_convert_runs.json", runs)
