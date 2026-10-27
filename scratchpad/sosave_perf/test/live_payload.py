"""Build an SO save request the way the form sends it, from a stored dev SO (read-only), for the live tests.

The key set and each key's value type come from a recorded request the V2 SUBMIT accepted (the template); values come from
the stored rows: ids as text, numbers as numbers, JSON text columns as text, list columns as lists, dates as the template
writes them.

usage: python3 live_payload.py --so <id> --template <request.json> --out <request.json>
                               [--mode edit|add|draft] [--status Issued|Draft] [--bump-line N] [--lines N]
  edit:  the stored SO itself (page_status Edit), optionally one line's quantity + 1
  add:   a new SO from its first N lines (no ids); draft: the same, saved as Draft
"""
import argparse
import json
import re
import subprocess
import uuid

DB = "/Users/yunawinaya/Developer/BladeXfunctions/.dbtools/db"
ap = argparse.ArgumentParser()
ap.add_argument("--so", required=True)
ap.add_argument("--template", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--mode", default="edit", choices=("edit", "add", "draft"))
ap.add_argument("--status", default="Issued")
ap.add_argument("--bump-line", type=int, default=0)
ap.add_argument("--lines", type=int, default=0)
a = ap.parse_args()
if not re.fullmatch(r"[0-9]{1,20}", a.so):
    raise SystemExit("--so: digits only")


def q(sql):
    out = subprocess.run([DB, "--dev", "--json", sql], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(out.stderr[-400:])
    return json.loads(out.stdout)


tpl = json.load(open(a.template))["allData"]
tpl_head = {k: v for k, v in tpl.items() if k != "table_so"}
tpl_line = tpl["table_so"][0]
head = q(f"SELECT * FROM sales_order WHERE id = {a.so} AND is_deleted = 0")
if not head:
    raise SystemExit("no such SO")
head = head[0]
lines = q(f"SELECT * FROM sales_order_axszx8cj_sub WHERE sales_order_id = {a.so} AND is_deleted = 0 ORDER BY CAST(line_index AS UNSIGNED), id")
if a.lines:
    lines = lines[: a.lines]
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def shaped(value, like):
    """the stored value in the template's representation of that key"""
    if isinstance(like, bool) or isinstance(like, (int, float)):
        if value in (None, ""):
            return 0
        n = float(value)
        return int(n) if n.is_integer() else n
    if isinstance(like, list):
        if value in (None, ""):
            return []
        if isinstance(value, str):
            try:
                v = json.loads(value)
                return v if isinstance(v, list) else []
            except ValueError:
                return []
        return value if isinstance(value, list) else []
    if value is None:
        return ""
    text = str(value)
    if isinstance(like, str) and DATE.match(like) and len(text) >= 10 and DATE.match(text[:10]):
        return text[:10]
    return text


def shape(row, template):
    out = {}
    for k, like in template.items():
        out[k] = shaped(row[k], like) if k in row else like
    return out


allData = shape(head, tpl_head)
table = []
for i, ln in enumerate(lines):
    l = shape(ln, tpl_line)
    l["fm_key"] = str(uuid.uuid4())
    if a.mode != "edit":
        l["id"] = ""
        l["delivered_qty"] = l["planned_qty"] = l["invoice_qty"] = l["posted_qty"] = l["return_qty"] = 0
        l["production_qty"] = l["production_planned_qty"] = 0
        l["line_status"] = ""
    table.append(l)
if a.bump_line:
    t = table[a.bump_line - 1]
    t["so_quantity"] = (t["so_quantity"] or 0) + 1
allData["table_so"] = table
if a.mode == "edit":
    allData.update(page_status="Edit", previous_status=head["so_status"], so_status=a.status)
else:
    allData.update(page_status="Add", previous_status="", id="", so_no="", so_status="Draft" if a.mode == "draft" else a.status,
                   gd_status="", si_status="Not Created", production_status="Not Created")
json.dump({"operation": "SUBMIT", "allData": allData}, open(a.out, "w"), ensure_ascii=False)
print(f"{a.mode} payload for SO {head['so_no']} ({a.so}): {len(table)} lines, status {allData['so_status']}"
      + (f", line {a.bump_line} so_quantity {table[a.bump_line - 1]['so_quantity']}" if a.bump_line else "") + f" -> {a.out}")
