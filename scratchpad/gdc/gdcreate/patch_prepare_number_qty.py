"""patch_prepare_number_qty.py: GD_BULK_PREPARE stores temp_qty_data gd_quantity as a NUMBER (2026-10-26, the user's yes).

code_node_egoCivrm (Finish) rebuilds every stock line's temp_qty_data from the staged allocations, whose quantity is a decimal
STRING (fmt() in auto-allocation, s() in the parse node). So since 10-08 every V2-created stock line stored "gd_quantity":"100",
where the classic save and every other writer store numbers. KF 073522's loading-bay Picking merge added them as text:
PICK-FG2610-160 refused "temp_qty_data total (100100100100100) != gd_qty (500)". Number() of the staged decimal (validated
positive, at most 8 decimals) is exact for JSON. The decimal COLUMNS the node writes (reserved_qty, open_qty, ...) stay strings:
the platform stores those as decimals. Existing open lines are left as they are (consumers read them tolerantly).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_prepare_number_qty.py [--write]
"""
import json
import os
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_PREPARE.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
OLD = "gd_quantity: A.a.quantity, plant_id: plant"
NEW = "gd_quantity: Number(A.a.quantity), plant_id: plant"


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r is not None:
                return r
    return None


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip"
code = find(doc, "code_node_egoCivrm")["data"]["script"]
assert code["code"].count(OLD) == 1, "anchor found %d times (already patched?)" % code["code"].count(OLD)
code["code"] = code["code"].replace(OLD, NEW)
out = render(doc)
print("GD_BULK_PREPARE: temp_qty_data gd_quantity as a number; %+d chars" % (len(out) - len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
