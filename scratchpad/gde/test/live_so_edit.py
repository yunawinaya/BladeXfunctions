"""live_so_edit.py <tenant> <so_id> <mode> <line_pos> <qty> <out_request.json> [raise]: an SO_SAVE request that edits a stored, Issued
Sales Order as the SO form's Edit + Issue sends it: page_status Edit, every id kept, the counters as stored.
mode qty: line <line_pos> (1-based, id order) gets <qty>, its amounts = price x qty, the header totals recomputed;
mode add: a copy of line <line_pos> as a NEW line (no id) of <qty>, appended.
A 6th argument "raise" answers the cascade's 414 with "Add to delivery" (raiseGdQty Yes). Reads read-only (dev); the request
goes to the session scratchpad. Ids of 16+ digits go out as strings (the platform hands code JSON text).
"""
import importlib.util, json, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

spec = importlib.util.spec_from_file_location("g", "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/prepare/sql.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

tenant, so_id, mode, pos, qty, out = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
answer_raise = len(sys.argv) > 7 and sys.argv[7] == "raise"
assert tenant.isdigit() and so_id.isdigit() and mode in ("qty", "add")


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
assert h.get("so_status") in ("Issued", "Processing"), h.get("so_status")
SYS = ["create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id"]
for k in SYS:
    h.pop(k, None)
h.update({"page_status": "Edit", "previous_status": h.get("so_status")})
for l in lines:
    for k in SYS:
        l.pop(k, None)
target = lines[pos - 1]
price = float(target.get("so_item_price") or 0)
conv = float(target.get("packing_conversion") or 1) or 1
if mode == "qty":
    amount = round(price * qty, 8)
    target.update({"so_quantity": qty, "so_gross": amount, "so_amount": amount, "packing_qty": round(qty / conv, 8)})
    what = f"line {pos} ({target['id']}) so_quantity -> {qty:g}"
else:
    new = json.loads(json.dumps(target))
    for k in ("id", "sales_order_id"):
        new.pop(k, None)
    amount = round(price * qty, 8)
    new.update({"so_quantity": qty, "so_gross": amount, "so_amount": amount, "packing_qty": round(qty / conv, 8), "delivered_qty": 0, "planned_qty": 0,
                "production_planned_qty": 0, "return_qty": 0, "line_status": None, "production_status": "Not Created", "line_index": len(lines) + 1})
    lines.append(new)
    what = f"a new line (a copy of line {pos}, item {target.get('item_name')}) of {qty:g}"
total = round(sum(float(l.get("so_amount") or 0) for l in lines), 8)
rate = float(h.get("exchange_rate") or 1)
h.update({"so_total_gross": total, "so_total": total, "myr_total_amount": round(total * rate, 8), "table_so": lines})
if answer_raise:
    h["raiseGdQty"] = "Yes"
json.dump({"allData": h}, open(out, "w"))
print(f"edit of {h.get('so_no')} ({h.get('so_status')}): {what}; {len(lines)} line(s), total {total:g}" + (" [raiseGdQty Yes]" if answer_raise else ""))
