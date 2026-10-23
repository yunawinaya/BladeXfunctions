"""patch_nonstock_fit.py: the GD Created V2 fit lets non-stock items (stock_control 0 and show_delivery 0) through to GD_BULK_PREPARE
(patch_prepare_nonstock.py), which delivers them as description-only lines like the old save (user 2026-10-23: LSH's charge
lines sent 22 of its 25 classic GDs of the day to the slow frozen save).

Every copy of the fit changes alike:
- v2fit_lib.js (verbatim in GD_ASYNC_SUBMIT code_node_GSfitPlan / code_node_GSfit and SO_AUTO_GD code_v2plan): the fit read
  marks such an item f1 = NS (v2fit.py: sql_node_GSfit / sql_v2facts, still the same text), and gdV2Fit skips the stock checks
  for it;
- the GD form's gdV2Route (gdV2_onClick_save_as_created, extracted verbatim into code_v2plan): the item-flag check passes it.
Switch GD_V2_NONSTOCK_ENABLED (false = such a delivery stays on the old save): declared in the form handler, in
code_node_GSfit and in code_v2plan; a copy that does not declare it reads it as on (typeof guard), so the verbatim copies
need no other change. Items with stock_control 0 and show_delivery 1, and lines with no material, are unchanged.

The GD form is built on the LIVE dev form (base file below; another developer published v1489 at 14:43, changing mounted /
onChange_plant / onChange_soID - not this handler); only gdV2_onClick_save_as_created changes. Rendered as each file is kept.

usage: python3 patch_nonstock_fit.py [--write]
"""
import json
import os
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
HERE = os.path.dirname(os.path.abspath(__file__))
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
LIB = HERE + "/code/v2fit_lib.js"
FIT_PY = HERE + "/v2fit.py"
SUBMIT = R + "Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json"
SOA = R + "Goods Delivery/SOconvertGDCreatedWorkflow.json"
MIRROR = R + "Goods Delivery/AsyncV2/gdV2_onClick_save_as_created.js"
FORM_BASE = HERE + "/nonstock/GD_form.live_v1489.json"
FORM_OUT = HERE + "/nonstock/GD_form.v1489_nonstock.json"
HANDLER = "gdV2_onClick_save_as_created"

LIB_EDITS = [
    ("// facts: rows of the fit read - SETUP (f1 picking_mode), ITEM (f1 stock_control, f2 costing method, f3 batch, f4 serial,\n",
     "// facts: rows of the fit read - SETUP (f1 picking_mode), ITEM (f1 stock_control or NS, f2 costing method, f3 batch, f4 serial,\n"),
    ("    const it = item[material];\n    if (it) {\n      const what = at + \": material \" + material + \" \";\n",
     "    const it = item[material];\n"
     "    // a non-stock item (NS: stock_control 0, show_delivery 0): GD_BULK_PREPARE delivers it as a description-only line, as the\n"
     "    // old save does (2026-10-23); no stock check applies. Switch GD_V2_NONSTOCK_ENABLED, on unless a caller sets it false\n"
     "    const nonStock = !!it && s(it.f1) === \"NS\" && (typeof GD_V2_NONSTOCK_ENABLED === \"undefined\" || GD_V2_NONSTOCK_ENABLED === true);\n"
     "    if (it && !nonStock) {\n      const what = at + \": material \" + material + \" \";\n"),
]
SQL_EDIT = ("       COALESCE(CAST(i.stock_control AS CHAR), '') AS f1,\n",
            "       CASE WHEN i.stock_control = 0 AND i.show_delivery = 0 THEN 'NS' ELSE COALESCE(CAST(i.stock_control AS CHAR), '') END AS f1,\n")
ROUTE_EDIT = ('      if (!f) return "line " + label + ": the item master of material " + s(l.material_id) + " could not be read";\n'
              '      if (String(f.stock_control) !== "1") return ',
              '      if (!f) return "line " + label + ": the item master of material " + s(l.material_id) + " could not be read";\n'
              '      // a non-stock item (stock_control 0, show_delivery 0): GD_BULK_PREPARE delivers it as a description-only line (2026-10-23)\n'
              '      if (String(f.stock_control) === "0" && String(f.show_delivery) === "0" && (typeof GD_V2_NONSTOCK_ENABLED === "undefined" || GD_V2_NONSTOCK_ENABLED === true)) return "";\n'
              '      if (String(f.stock_control) !== "1") return ')
SWITCH = ("// Switch: true = items neither stock-controlled nor shown in delivery (stock_control 0, show_delivery 0) go through GD Created\n"
          "// V2 as description-only lines (GD_BULK_PREPARE); false = a delivery with such an item stays on the old save\n"
          "const GD_V2_NONSTOCK_ENABLED = true;\n")
FORM_SWITCH = ("const ASYNC_GD_ENABLED = true;\n", "const ASYNC_GD_ENABLED = true;\n" + SWITCH)


def sub(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def renderer(raw):
    """the repo's rendering of this file: Prettier over compact or default json.dumps, whichever round-trips"""
    for seps in ((",", ":"), (", ", ": ")):
        def render(doc, seps=seps):
            return subprocess.run(["node", PRETTIER, "--parser", "json"], input=json.dumps(doc, ensure_ascii=False, separators=seps),
                                  capture_output=True, text=True, check=True).stdout
        if render(json.loads(raw)) == raw:
            return render
    raise SystemExit("no rendering round-trips the file")


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


def ev_list(o):
    if isinstance(o, dict):
        if isinstance(o.get("eventScript"), list):
            return o["eventScript"]
        for v in o.values():
            r = ev_list(v)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = ev_list(v)
            if r is not None:
                return r
    return None


def esc(s, ascii_only):
    return json.dumps(s, ensure_ascii=ascii_only)[1:-1]


out = {}
# 1. the library and the fit read (sources)
lib0 = open(LIB, encoding="utf-8").read()
lib1 = lib0
for old, new in LIB_EDITS:
    lib1 = sub(lib1, old, new, "lib")
out[LIB] = lib1
fit0 = open(FIT_PY, encoding="utf-8").read()
out[FIT_PY] = sub(fit0, *SQL_EDIT, "v2fit.py")

# 2. GD_ASYNC_SUBMIT: both lib copies, the read, the switch in the deciding node
raw = open(SUBMIT, encoding="utf-8").read()
render = renderer(raw)
doc = json.loads(raw)
for nid in ("code_node_GSfitPlan", "code_node_GSfit"):
    sc = find(doc, nid)["data"]["script"]
    sc["code"] = sub(sc["code"], lib0, lib1, nid + " lib")
sc = find(doc, "code_node_GSfit")["data"]["script"]
sc["code"] = SWITCH + sc["code"]
sc = find(doc, "sql_node_GSfit")["data"]["script"]
sc["code"] = sub(sc["code"], *SQL_EDIT, "sql_node_GSfit")
out[SUBMIT] = render(doc)

# 3. SO_AUTO_GD: the lib copy, the gdV2Route copy, the read, the switch
raw = open(SOA, encoding="utf-8").read()
render = renderer(raw)
doc = json.loads(raw)
sc = find(doc, "code_v2plan")["data"]["script"]
c = sub(sc["code"], lib0, lib1, "code_v2plan lib")
c = sub(c, *ROUTE_EDIT, "code_v2plan gdV2Route")
sc["code"] = SWITCH + c
sc = find(doc, "sql_v2facts")["data"]["script"]
sc["code"] = sub(sc["code"], *SQL_EDIT, "sql_v2facts")
out[SOA] = render(doc)

# 4. the GD form's handler: the repo mirror and the live dev form (text level: the form does not round-trip json.dumps)
mirror0 = open(MIRROR, encoding="utf-8").read()
mirror1 = sub(sub(mirror0, *ROUTE_EDIT, "mirror gdV2Route"), *FORM_SWITCH, "mirror switch")
out[MIRROR] = mirror1
form = open(FORM_BASE, encoding="utf-8").read()
live = [e for e in ev_list(json.loads(form)) if e.get("name") == HANDLER][0]["func"]
assert live == mirror0, "the live form's handler is not the repo mirror: rebuild on the live form"
for old, new in (ROUTE_EDIT, FORM_SWITCH):
    hits = [a for a in (False, True) if form.count(esc(old, a)) == 1]
    assert hits, "form: patch point not found once: " + old[:70]
    form = form.replace(esc(old, hits[0]), esc(new, hits[0]))
assert [e for e in ev_list(json.loads(form)) if e.get("name") == HANDLER][0]["func"] == mirror1, "the patched form's handler is not the patched mirror"
out[FORM_OUT] = form

for p, text in out.items():
    if p.endswith(".json"):
        json.loads(text)
    print("%-95s %d chars" % (p.replace(R, ""), len(text)))
if "--write" in sys.argv:
    for p, text in out.items():
        open(p, "w", encoding="utf-8").write(text)
    print("written")
else:
    print("ok (dry): pass --write")
