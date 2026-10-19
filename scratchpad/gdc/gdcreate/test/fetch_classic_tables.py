"""fetch_classic_tables.py <tenant> <plant> <organization> <convert.out.json> <out.json>: the rows the classic
func_processGDLineItem reads through the client db for one conversion, read-only from dev and shaped as the client API
returns them (ids as strings, numeric columns as numbers, Item with its table_uom_conversion / table_packing_detail
subform rows nested), keyed by the collection name the handler uses."""
import json
import subprocess
import sys
from decimal import Decimal

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
tenant, plant, org, conv_file, out_file = sys.argv[1:6]


def q(sql):
    out = subprocess.run([R + ".dbtools/db", "--dev", "--json", "--limit", "200000", sql], capture_output=True, text=True, check=True).stdout
    return json.loads(out, parse_int=str, parse_float=str)


def cols(table):
    rows = q("SELECT COLUMN_NAME c, DATA_TYPE t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '%s'" % table)
    return {r["c"]: r["t"] for r in rows}


NUM = {"int", "tinyint", "smallint", "mediumint", "decimal", "double", "float"}


def shape(table, rows):
    types = cols(table)
    out = []
    for r in rows:
        o = {}
        for k, v in r.items():
            t = types.get(k, "")
            if v is None:
                o[k] = None
            elif t == "bigint":
                o[k] = str(v)
            elif t in NUM:
                d = Decimal(str(v))
                o[k] = int(d) if t in {"int", "tinyint", "smallint", "mediumint"} else float(d)
            elif t == "json":
                try:
                    o[k] = json.loads(v) if isinstance(v, str) else v
                except ValueError:
                    o[k] = v
            else:
                o[k] = v
        out.append(o)
    return out


conv = json.load(open(conv_file))["data"]["data"][0]
items = json.loads(conv.get("all_item") or "[]")
mats = sorted({str(i.get("itemId")) for i in items if str(i.get("itemId") or "").isdigit()})
solines = sorted({str(i.get("so_line_item_id")) for i in items if str(i.get("so_line_item_id") or "").isdigit()})
so_ids = sorted({str(x) for x in (conv.get("so_id") or [])})
M = ",".join(mats) or "0"
T = {}
item_rows = shape("item", q("SELECT * FROM item WHERE tenant_id = '%s' AND id IN (%s)" % (tenant, M)))
uom = shape("item_mji552rc_sub", q("SELECT * FROM item_mji552rc_sub WHERE Item_id IN (%s) AND is_deleted = 0" % M))
pack = shape("item_vabbbwt2_sub", q("SELECT * FROM item_vabbbwt2_sub WHERE Item_id IN (%s) AND is_deleted = 0" % M))
for it in item_rows:
    it["table_uom_conversion"] = [u for u in uom if str(u.get("Item_id")) == it["id"]]
    it["table_packing_detail"] = [p for p in pack if str(p.get("Item_id")) == it["id"]]
T["Item"] = item_rows
for tb in ("item_balance", "item_batch_balance", "item_serial_balance"):
    T[tb] = shape(tb, q("SELECT * FROM %s WHERE tenant_id = '%s' AND plant_id = %s AND material_id IN (%s)" % (tb, tenant, plant, M)))
T["batch"] = shape("batch", q("SELECT * FROM batch WHERE tenant_id = '%s' AND material_id IN (%s)" % (tenant, M)))
locs = sorted({r["location_id"] for tb in ("item_balance", "item_batch_balance", "item_serial_balance") for r in T[tb] if r.get("location_id")})
T["bin_location"] = shape("bin_location", q("SELECT * FROM bin_location WHERE tenant_id = '%s' AND id IN (%s)" % (tenant, ",".join(locs) or "0")))
T["on_reserved_gd"] = shape("on_reserved_gd", q("SELECT * FROM on_reserved_gd WHERE tenant_id = '%s' AND parent_line_id IN (%s)" % (tenant, ",".join(solines) or "0")))
T["handling_unit_atu7sreg_sub"] = shape("handling_unit_atu7sreg_sub", q("SELECT * FROM handling_unit_atu7sreg_sub WHERE tenant_id = '%s' AND material_id IN (%s)" % (tenant, M)))
T["picking_setup"] = shape("picking_setup", q("SELECT * FROM picking_setup WHERE tenant_id = '%s' AND organization_id = '%s'" % (tenant, org)))
T["sales_order"] = shape("sales_order", q("SELECT * FROM sales_order WHERE tenant_id = '%s' AND id IN (%s)" % (tenant, ",".join(so_ids) or "0")))
json.dump(T, open(out_file, "w"))
print({k: len(v) for k, v in T.items()})
