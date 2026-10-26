"""build_contention_so.py: a dev SO Save V2 SUBMIT request that copies SO/20260901-001's 100 items into a NEW Issued SO, so two
big GD creations compete for the same stock (the GD-create oldest-first contention test, 2026-10-26, user's request).

Inputs (read-only dev reads, saved by the caller):
- <dir>/submit_tpl_wp.json: a recorded SO_SAVE_SUBMIT workflowparams (operation + allData), for the field set and shapes;
- <dir>/so1_head.json, <dir>/so1_lines.json: `.dbtools/db --dev --json` rows of sales_order / sales_order_axszx8cj_sub.
Writes <dir>/so2_submit.req.json. Ids go out as strings (19-digit ids do not survive a JS number). Nothing is sent here: the
request is run with scratchpad/gdc/tools/runwf.mjs <SO_SAVE_SUBMIT id> after a review.

usage: python3 build_contention_so.py <dir> [qty per line, default 10]
"""
import json
import sys
import uuid

d = sys.argv[1]
qty = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0


def rows(path):
    raw = open(path, encoding="utf-8").read()
    return json.loads(raw[raw.find("\n[") + 1:])


def fit(tpl_value, db_value):
    """The DB value in the shape the form sends for this field (the template's type decides)."""
    if db_value is None:
        return tpl_value if isinstance(tpl_value, (list, dict)) else ("" if isinstance(tpl_value, str) else tpl_value)
    if isinstance(tpl_value, bool):
        return bool(db_value)
    if isinstance(tpl_value, (int, float)) and not isinstance(tpl_value, bool):
        try:
            v = float(db_value)
            return int(v) if v.is_integer() else v
        except (TypeError, ValueError):
            return tpl_value
    if isinstance(tpl_value, (list, dict)):
        if isinstance(db_value, str):
            try:
                return json.loads(db_value)
            except ValueError:
                return tpl_value
        return db_value
    return str(db_value)


wp = json.load(open(d + "/submit_tpl_wp.json", encoding="utf-8"))
head = rows(d + "/so1_head.json")[0]
lines = rows(d + "/so1_lines.json")
tpl = wp["allData"]
tpl_line = tpl["table_so"][0]

data = {}
for k, v in tpl.items():
    if k == "table_so":
        continue
    data[k] = fit(v, head[k]) if k in head else v
data.update({"id": "", "page_status": "Add", "previous_status": "", "so_status": "Issued", "so_no": "", "so_date": "2026-10-26",
             "so_shipping_date": "", "so_description": "Contention test copy of SO/20260901-001 (GD session, dev)", "so_ref_doc": [],
             "sqt_no": "", "sqt_id": [], "partially_delivered": "0 / %d" % len(lines), "fully_delivered": "0 / %d" % len(lines),
             "gd_status": "", "si_status": "Not Created", "production_status": "Not Created", "to_status": "", "has_sr": 0})

out_lines = []
total = 0.0
for i, ln in enumerate(lines, 1):
    row = {}
    for k, v in tpl_line.items():
        row[k] = fit(v, ln[k]) if k in ln else v
    price = float(ln.get("so_item_price") or 0)
    row.update({"id": "", "fm_key": str(uuid.uuid4()), "line_index": i, "line_status": "Issued", "so_quantity": qty, "packing_qty": qty,
                "so_gross": round(price * qty, 4), "so_amount": round(price * qty, 4), "delivered_qty": 0, "planned_qty": 0,
                "outstanding_quantity": 0, "return_qty": 0, "invoice_qty": 0, "posted_qty": 0, "production_qty": 0,
                "production_planned_qty": 0, "production_status": "", "packing_status": "", "packing_no": "", "si_status": "",
                "from_historical": 0})
    total += price * qty
    out_lines.append(row)
data["table_so"] = out_lines
for k in ("so_total_gross", "so_total", "myr_total_amount"):
    if k in data:
        data[k] = round(total, 4)

req = {"operation": "SUBMIT", "allData": data}
open(d + "/so2_submit.req.json", "w", encoding="utf-8").write(json.dumps(req, ensure_ascii=False))
print("so2 request: %d lines, qty %s each, total %.2f, customer %s, plant %s" % (len(out_lines), qty, total, data.get("customer_name"), data.get("plant_name")))
