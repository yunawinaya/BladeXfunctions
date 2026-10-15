"""PO_LINE_IMPORT on dev, read-only: its code + SQL + the live GET_ITEM_UNIT_PRICE_BULK on real items, and the PO form's own
Batch Add (onConfirm_batchAddItem, deployed form) on the same items and price answer: the rows must be identical.
Rows with the file's own values are checked against what the file gave.

usage: python3 dev_parity.py <out dir outside the repo> [n_items] [n_rows]   (tenant 000000, org / plant / supplier of the
       2k test PO; n_rows > n_items cycles the items)
"""
import json
import os
import random
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scratchpad", "grv2"))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402
import build_po_import as B  # noqa: E402

OUT = sys.argv[1]
assert not os.path.abspath(OUT).startswith(ROOT), "fixtures hold dev data: write them outside the repo"
N_ITEMS = int(sys.argv[2]) if len(sys.argv) > 2 else 120
N_ROWS = int(sys.argv[3]) if len(sys.argv) > 3 else N_ITEMS
TENANT, ORG, PLANT = "000000", "1123598813738675201", "1123598813738675201"
SUP = os.environ.get("SUP", "2064263864972914690")
os.makedirs(OUT, exist_ok=True)
P = lambda n: os.path.join(OUT, n)


def node(step, payload):
    json.dump(payload, open(P(step + ".in.json"), "w"))
    subprocess.run(["node", os.path.join(HERE, "steps.js"), step, P(step + ".in.json"), P(step + ".out.json")], check=True)
    return json.load(open(P(step + ".out.json")))


# items: those with several UOMs and this supplier's descriptions first, then any
items = q("--dev", f"""SELECT i.material_code code,
  (SELECT COUNT(*) FROM item_mji552rc_sub c WHERE c.Item_id = i.id AND c.is_deleted = 0) n_conv,
  (SELECT COUNT(*) FROM item_eimnda1q_sub b WHERE b.Item_id = i.id AND b.is_deleted = 0 AND b.supplier_id = '{SUP}') n_bind
  FROM item i WHERE i.tenant_id = '{TENANT}' AND i.organization_id = '{ORG}' AND i.is_deleted = 0 AND COALESCE(i.is_active, 1) = 1
   AND i.material_code IS NOT NULL AND i.material_code <> ''
   AND EXISTS (SELECT 1 FROM item_mji552rc_sub c WHERE c.Item_id = i.id AND c.is_deleted = 0 AND (c.purchase_default_uom = 1 OR c.alt_uom_id = i.based_uom))
 ORDER BY (n_bind > 0) DESC, (n_conv > 1) DESC, i.id DESC LIMIT {N_ITEMS}""")
codes = [r["code"] for r in items]
dups = q("--dev", f"SELECT material_code c FROM item WHERE tenant_id = '{TENANT}' AND organization_id = '{ORG}' AND is_deleted = 0 GROUP BY material_code HAVING COUNT(*) > 1")
dup = {r["c"].lower().rstrip() for r in dups}
codes = [c for c in codes if c.lower().rstrip() not in dup]
print("items", len(codes), "| with this supplier's description", sum(1 for r in items if r["n_bind"]), "| with several UOMs", sum(1 for r in items if r["n_conv"] > 1))
rng = random.Random(15)
rows = [{"Item Code": codes[i % len(codes)], "Quantity": rng.choice([1, 2, 5, 10, 12.5, 100])} for i in range(N_ROWS)]

t0 = time.time()
guard = node("guard", {"rows": rows, "tenantId": TENANT, "organizationId": ORG, "supplierId": SUP, "plantId": PLANT})
assert guard["route"] == "GO", guard["message"]
vals = {"tenantId": TENANT, "organizationId": ORG, "supplierId": SUP, "codesSql": guard["codesSql"]}
sql = re.sub(r"\{\{node:code_node_PIguard\.data\.(\w+)\}\}", lambda m: vals[m.group(1)], B.items_sql())
t1 = time.time()
irows = q("--dev", sql)
t2 = time.time()
print("guard %d rows | item SQL: %d items, %.0f KB, %.2f s" % (guard["count"], len(irows), len(json.dumps(irows)) / 1e3, t2 - t1))
resolved = node("resolve", {"guard": guard, "items": irows})
assert resolved["route"] == "GO", resolved["errors"][:5]
req = {"document_type": "PO", "supp_cust_id": SUP, "plant_id": PLANT, "item_data": resolved["itemData"]}
json.dump(req, open(P("price.req.json"), "w"))
t3 = time.time()
subprocess.run(["node", os.path.join(ROOT, "scratchpad", "gdc", "tools", "runwf.mjs"), B.PRICE[1], P("price.req.json"), P("price.out.json")], check=True, cwd=ROOT)
t4 = time.time()
pres = json.load(open(P("price.out.json")))
priced = (pres.get("data") or {}).get("data") or []
print("GET_ITEM_UNIT_PRICE_BULK: %d of %d lines priced, %.2f s" % (len(priced), len(req["item_data"]), t4 - t3))
out = node("rows", {"resolved": resolved, "priced": priced})
imp = json.loads(out["rowsJson"])
alt = json.loads(resolved["altUomJson"])
for r in imp:
    r["alt_uom"] = alt[r["item_id"]]  # as the form puts it back
print("import rows %d | rows %.0f KB + alt_uom %.0f KB | total %.1f s" % (len(imp), len(out["rowsJson"]) / 1e3, len(resolved["altUomJson"]) / 1e3, time.time() - t0))

# Batch Add on the same items: the dialog's items (as Item reads hand them: the UOM / supplier sub-tables as arrays)
itemObj = {}
for r in irows:
    o = json.loads(r["j"]) if isinstance(r["j"], str) else r["j"]
    itemObj[o["material_code"].lower().rstrip()] = o
itemArray = []
for row in rows:
    o = itemObj[row["Item Code"].lower().rstrip()]
    conv = [{k: v for k, v in c.items() if k != "uom_name"} for c in o["conv"]]
    itemArray.append({"id": o["id"], "material_name": o["material_name"], "material_desc": o["material_desc"], "item_category": o["item_category"],
                      "further_description": o["further_description"], "based_uom": o["based_uom"], "mat_purchase_tax_id": o["mat_purchase_tax_id"],
                      "table_uom_conversion": conv, "table_sup_item_bind": o["binds"]})
ba = node("batchadd", {"itemArray": itemArray, "priced": priced, "supplierId": SUP, "plantId": PLANT})["table_po"]
bad = 0
for i, (a, b) in enumerate(zip(imp, ba)):
    b = {k: v for k, v in b.items() if k != "fm_key" and v is not None}
    a = {k: v for k, v in a.items() if v is not None}
    if a != b:
        bad += 1
        if bad <= 3:
            ks = sorted(set(a) | set(b))
            print("  DIFF row", i + 2, {k: (a.get(k), b.get(k)) for k in ks if a.get(k) != b.get(k)})
print("Batch Add parity: %d rows, %d differ%s" % (len(imp), bad, "" if len(imp) == len(ba) else " (row counts %d vs %d)" % (len(imp), len(ba))))
sys.exit(1 if bad or len(imp) != len(ba) else 0)
