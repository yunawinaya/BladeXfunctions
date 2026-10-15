"""Read-only dev fixtures for the Putaway form harness (Phase 4 desktop form).
Writes customer data to the session scratchpad (argv[1]), never into the repo.

  python3 pull_fixtures.py <out_dir>

- to_<id>.json   one real transfer order: header + flat line rows + records rows, exactly as the tables hold them
                 (the harness turns them into the form model the way the platform loads a record)
- items.json     Item id -> { id, is_deleted, serial_number_management, table_default_bin[] } for every line item of the
                 real TOs plus 2,000 live items of tenant 711077 (the synthetic 2,000-line TO)
- plant.json     putaway_setup, the plant's default storage location + bins, every bin of the storage locations the
                 lines use (onStorageLocationIdChange reads them)
"""
import json
import os
import re
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
from dbq import q  # noqa: E402

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
BIG = 2 ** 53
DEC = re.compile(r"^-?\d+\.\d+$|^-?\d+(\.\d+)?[eE][-+]?\d+$")
# real dev TOs (tenant 000000, plant ...202): 16 batch lines Created; In Progress with 3 bundle lines + records; one HU
# line; 200 batch lines
TOS = ["2105558352827682817", "2101960464552890370", "2072259808180891650", "2074350264504156162"]
ID_COLS = {"id", "plant_id", "gr_no", "supplier_id", "to_id_type", "item_code", "batch_no", "item_uom", "source_bin",
           "target_location", "storage_location", "po_no", "gr_line_id", "item_bundle_id", "parent_id", "project_id",
           "transfer_order_putaway_id", "organization_id", "qi_id", "assigned_to", "create_user", "update_user",
           "create_dept", "handling_unit_id", "tenant_id"}


def norm(k, v):
    if isinstance(v, bool) or v is None:
        return v
    if k in ID_COLS and isinstance(v, int):
        return str(v)
    if isinstance(v, int):
        return str(v) if abs(v) > BIG else v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, str) and DEC.match(v) and k not in ID_COLS and k not in ("line_index", "to_id"):
        return float(v)
    return v


def rows(sql):
    return [{k: norm(k, v) for k, v in r.items()} for r in q("--dev", sql)]


def dump(name, obj):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(obj, f, ensure_ascii=False, default=str)
    print("wrote", name)


tenant = None
plant = None
item_ids = set()
sl_ids = set()
for to_id in TOS:
    hdr = rows(f"SELECT * FROM transfer_order_putaway WHERE id={to_id} AND is_deleted=0")[0]
    lines = rows(f"SELECT * FROM transfer_order_putaway_jz8m9w3h_sub WHERE transfer_order_putaway_id={to_id} AND is_deleted=0 ORDER BY id")
    recs = rows(f"SELECT * FROM transfer_order_putaway_vrqs3cmr_sub WHERE transfer_order_putaway_id={to_id} AND is_deleted=0 ORDER BY id")
    tenant, plant = hdr["tenant_id"], hdr["plant_id"]
    for ln in lines:
        if ln.get("item_code"):
            item_ids.add(ln["item_code"])
        if ln.get("storage_location"):
            sl_ids.add(ln["storage_location"])
    dump(f"to_{to_id}.json", {"header": hdr, "lines": lines, "records": recs})


def items_by_ids(ids_sql):
    items = rows(f"SELECT id, is_deleted, serial_number_management, material_code FROM item WHERE id IN ({ids_sql})")
    bins = rows(f"SELECT Item_id, plant_id, bin_location, storage_location FROM item_wu520fpw_sub "
                f"WHERE is_deleted=0 AND Item_id IN ({ids_sql}) ORDER BY Item_id, id")
    out = {}
    for it in items:
        it["id"] = str(it["id"])
        it["table_default_bin"] = []
        out[it["id"]] = it
    for b in bins:
        iid = str(b.pop("Item_id"))
        if iid in out:
            out[iid]["table_default_bin"].append({k: (str(v) if v is not None else v) for k, v in b.items()})
    return out


items = items_by_ids(",".join(sorted(item_ids)))
# the TOs' tenant has ~200 items: the synthetic TO takes 2,000 distinct items of the plan's 2k test tenant (711077)
more = [str(r["id"]) for r in q("--dev", "SELECT id FROM item WHERE is_deleted=0 AND tenant_id='711077' ORDER BY id LIMIT 2000")]
items.update(items_by_ids(",".join(more)))
dump("items.json", items)

dump("plant.json", {
    "plant_id": plant,
    "tenant_id": tenant,
    "putaway_setup": rows(f"SELECT id, plant_id, is_deleted, putaway_mode, default_strategy_id, fallback_strategy_id, movement_type, "
                          f"putaway_required, auto_completed_gr, is_loading_bay, default_loading_bay FROM putaway_setup WHERE plant_id={plant}"),
    "storage_location": rows(f"SELECT id, plant_id, is_deleted, is_default, location_type FROM storage_location WHERE plant_id={plant} AND is_deleted=0"),
    "bin_location": rows(f"SELECT id, plant_id, storage_location_id, is_default, is_deleted FROM bin_location WHERE plant_id={plant} AND is_deleted=0"),
    "synthetic_item_ids": more,
})
