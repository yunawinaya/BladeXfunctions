"""patch_prepare_nonstock.py: GD_BULK_PREPARE takes non-stock items (stock_control 0 and show_delivery 0) the way the old save
does (user 2026-10-23: LSH's charge lines send 22 of its 25 classic GDs of the day to the slow frozen save; a 4-SO convert took
90 s and lost its answer).

The old save (GOODS_DELIVERY, code_node_IyJHrBst's descriptive-line branch, code_node_kJx9p9Nh, code_node_QtyCheckBatch)
delivers such an item as a description-only line: no allocation, no reservation, no movement, nothing to pick; it needs a
description; it counts against its sales order line with no over-delivery tolerance and adds to the line's planned_qty on
Created; it is stamped picking_status Completed (picking required, not from a Picking, header without one) and
packing_status Completed (not from a Picking) - the same stamps V2 already gives an item bundle row.

PREPARE (Validate code_node_J5T1G2s9 and Finish code_node_egoCivrm carry the same per-line code; both get the same edits):
- the item read (sql_node_tCdXcJ5e) adds show_delivery;
- a non-stock line skips the costing / batch / serial / price / unit checks, needs a description, refuses allocations,
  asks no zero-quantity confirmation unless its quantity is 0, uses no over-delivery tolerance, and goes into the sales
  order projection like any line;
- it gets one NONE stage row (the no-allocation shape COMMIT already stamps), no effect and no reservation;
- its GD row is the row as submitted + the header stamps + the bundle row's Created stamps, temp_qty_data "[]".
Items with stock_control 0 and show_delivery 1, and lines with no material, are still refused (they stay on the old save).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_prepare_nonstock.py [--write]
"""
import copy
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_PREPARE.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r
    return None


def sub(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


EDITS = [
    ("non-stock flag",
     "    const it = items[line.material_id];\n    const lineIdx = line.line_no;\n",
     "    const it = items[line.material_id];\n"
     "    // a non-stock item (stock_control 0, show_delivery 0): the old save delivers it as a description-only line\n"
     "    // (code_node_IyJHrBst) - no unit, stock or allocation; it counts against its sales order line with no tolerance\n"
     "    const nonStock = !!it && String(it.stock_control) === \"0\" && String(it.show_delivery) === \"0\";\n"
     "    const lineIdx = line.line_no;\n"),
    ("item checks",
     "    } else {\n      if (String(it.stock_control) !== \"1\") {\n",
     "    } else if (nonStock) {\n"
     "      if (!s((line.raw || {}).material_name) && !s((line.raw || {}).gd_material_desc)) {\n"
     "        err(line, \"material_name\", \"GD_INVALID_DATA\", \"row has no material_id and no description\");\n"
     "        lineOk = false;\n"
     "      }\n"
     "      if (line.allocations.length) {\n"
     "        err(line, \"temp_qty_data\", \"GD_INVALID_DATA\", \"the material is not stock-controlled: the line takes no stock, but it carries \" + line.allocations.length + \" allocation(s)\");\n"
     "        lineOk = false;\n"
     "      }\n"
     "    } else {\n      if (String(it.stock_control) !== \"1\") {\n"),
    ("unit conversion",
     "    if (it && lineOk) {\n      if (line.uom_id !== baseUom) {\n",
     "    if (it && lineOk && !nonStock) {\n      if (line.uom_id !== baseUom) {\n"),
    ("zero quantity",
     "    if (qtyUnits === 0n || !line.allocations.length) confirmations.ZERO_QUANTITY = true;\n",
     "    if (qtyUnits === 0n || (!line.allocations.length && !nonStock)) confirmations.ZERO_QUANTITY = true;\n"),
    ("tolerance",
     "          const tolUnits = tolRows.length === 1 ? ",
     "          const tolUnits = nonStock ? 0n : tolRows.length === 1 ? "),
    ("line entry",
     "    lines.push({ line: line, it: it, ok: lineOk, baseUom: baseUom, baseQty: D.fmt(lineBaseUnits), allocs: allocOut });\n",
     "    lines.push({ line: line, it: it, ok: lineOk, baseUom: baseUom, baseQty: D.fmt(lineBaseUnits), allocs: allocOut, nonStock: nonStock });\n"),
    ("GD row",
     "    stampHeader(out);\n    out.material_id = line.material_id;\n    out.gd_order_uom_id = line.uom_id;\n",
     "    if (L.nonStock) {\n"
     "      // the old save's descriptive-line row: as submitted + the header stamps + the bundle row's Created stamps\n"
     "      stampHeader(out);\n"
     "      out.material_id = line.material_id;\n"
     "      out.gd_qty = line.quantity;\n"
     "      out.line_index = line.line_index || String(line.line_no);\n"
     "      out.job_line_key = jobId + \"|\" + line.stable_line_key + \"|0\";\n"
     "      out.temp_qty_data = \"[]\";\n"
     "      if (bundlePicking) out.picking_status = \"Completed\";\n"
     "      if (!fromPicking) out.packing_status = \"Completed\";\n"
     "      if (raw.line_so_id !== undefined) out.line_so_id = line.so_id || null;\n"
     "      if (raw.so_line_item_id !== undefined) out.so_line_item_id = line.so_line_id || null;\n"
     "      return { key: line.stable_line_key, parent: line.parent_key || \"\", row: out };\n"
     "    }\n"
     "    stampHeader(out);\n    out.material_id = line.material_id;\n    out.gd_order_uom_id = line.uom_id;\n"),
]

raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert "const nonStock = " not in raw, "already patched"
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610239)

# 1. the item read: show_delivery
items = find(doc, "sql_node_tCdXcJ5e")["data"]
items["script"]["code"] = sub(items["script"]["code"], "       CAST(i.stock_control AS CHAR) AS stock_control,\n",
                              "       CAST(i.stock_control AS CHAR) AS stock_control,\n       CAST(i.show_delivery AS CHAR) AS show_delivery,\n", "item read")
names = [r["name"] for r in items["response_json"]]
proto = copy.deepcopy(items["response_json"][names.index("stock_control")])
proto.update({"key": K.key(), "name": "show_delivery", "title": "show_delivery"})
items["response_json"].insert(names.index("stock_control") + 1, proto)

# 2. Validate and Finish: the same per-line edits
for nid in ("code_node_J5T1G2s9", "code_node_egoCivrm"):
    sc = find(doc, nid)["data"]["script"]
    c = sc["code"]
    for what, old, new in EDITS:
        c = sub(c, old, new, nid + " " + what)
    sc["code"] = c

out = render(doc)
json.loads(out)
print("GD_BULK_PREPARE + non-stock lines: %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
