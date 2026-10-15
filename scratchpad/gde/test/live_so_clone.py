"""live_so_clone.py <tenant> <so_id> <qty_per_line> <out_request.json>: an SO_SAVE request that clones an Issued-able copy of a
stored Sales Order, as the SO form's Clone + Issue would send it: page_status Clone, no ids, a new number from the same
rule (so_no '' + so_no_type), every line at <qty_per_line> with its amounts (price x qty) and the header totals recomputed,
the delivery / production counters and statuses reset. Reads read-only (dev); the request goes to the session scratchpad.
Ids of 16+ digits go out as strings (the platform hands code JSON text: a bare 19-digit number would lose precision).
"""
import importlib.util, json, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

spec = importlib.util.spec_from_file_location("g", "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/prepare/sql.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

tenant, so_id, qty, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
assert tenant.isdigit() and so_id.isdigit()


def obj(row):
    def fix(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, int) and len(str(abs(v))) >= 16:
            return str(v)
        if isinstance(v, dict):
            return {k: fix(x) for k, x in v.items()}
        if isinstance(v, list):
            return [fix(x) for x in v]
        return v
    return fix(json.loads(row["j"]))


h = obj(q("--dev", f"SELECT {g.jobj('h', 'sales_order')} AS j FROM sales_order h WHERE h.tenant_id = '{tenant}' AND h.id = {so_id} AND h.is_deleted = 0")[0])
lines = [obj(r) for r in q("--dev", f"SELECT {g.jobj('l', 'sales_order_axszx8cj_sub')} AS j FROM sales_order_axszx8cj_sub l WHERE l.tenant_id = '{tenant}' "
                                       f"AND l.sales_order_id = {so_id} AND l.is_deleted = 0 ORDER BY l.id")]
assert lines and all(not l.get("item_bundle_id") for l in lines), "plain lines only"
SYS = ["id", "create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id"]
for k in SYS + ["so_no"]:
    h.pop(k, None)
h.update({"so_no": "", "so_status": "Issued", "gd_status": None, "si_status": "Not Created", "production_status": "Not Created", "partially_delivered": None,
          "fully_delivered": None, "page_status": "Clone", "previous_status": None})
table = []
total = 0.0
for i, l in enumerate(lines):
    for k in SYS + ["sales_order_id"]:
        l.pop(k, None)
    price = float(l.get("so_item_price") or 0)
    amount = round(price * qty, 8)
    total += amount
    conv = float(l.get("packing_conversion") or 1) or 1
    l.update({"so_quantity": qty, "so_gross": amount, "so_amount": amount, "delivered_qty": 0, "planned_qty": 0, "production_planned_qty": 0, "line_status": None,
              "production_status": "Not Created", "packing_qty": round(qty / conv, 8), "line_index": i + 1})
    table.append(l)
rate = float(h.get("exchange_rate") or 1)
h.update({"so_total_gross": round(total, 8), "so_total": round(total, 8), "myr_total_amount": round(total * rate, 8), "table_so": table})
json.dump({"allData": h}, open(out, "w"))
print(f"clone of {so_id}: {len(table)} line(s) x {qty:g}, total {total:g} ({h.get('so_currency')}), MYR {total * rate:.4f}; rule {h.get('so_no_type')}")
