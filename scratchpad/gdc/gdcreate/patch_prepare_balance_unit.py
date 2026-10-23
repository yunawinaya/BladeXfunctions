"""patch_prepare_balance_unit.py: GD_BULK_PREPARE - the stock balance's unit, checked on the batch row too, and both units
named in the refusal (user 2026-10-23, Kenhin 528521: 105 refusals "the balance row's unit differs from the material's base
unit", no unit named).

1. The batch row: INVENTORY_APPLY_OPERATION refuses an item_batch_balance row whose material_uom is not the effect's base unit
   ("uom X on the item_batch_balance row"), but PREPARE checked only the item_balance row - a batch item passed PREPARE and
   failed inside COMMIT. sql_node_zegvDynS's BATCH_ROWS now carries the row's unit (uom) and the two validation nodes
   (code_node_J5T1G2s9 Validate, code_node_egoCivrm Finish) refuse it the same way, after the row-count check.
2. The messages name both units as "unit <id>", which the GD form's refusal alert turns into names (gdV2UnitNames).
Same error code (GD_ITEM_NOT_SUPPORTED), same field. Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_prepare_balance_unit.py [--write]
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


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert "AS uom\\n  FROM item_batch_balance" not in raw, "already patched"
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610233)

facts = find(doc, "sql_node_zegvDynS")["data"]
code = facts["script"]["code"]
code = sub(code, "COUNT(*) AS n\n  FROM item_batch_balance b", "COUNT(*) AS n, CAST(MAX(b.material_uom) AS CHAR) AS uom\n  FROM item_batch_balance b", "BATCH_ROWS select")
code = sub(code, "'' AS qty, COUNT(*) AS n\n  FROM item_serial_balance s", "'' AS qty, COUNT(*) AS n, '' AS uom\n  FROM item_serial_balance s", "SERIAL_ROWS select")
facts["script"]["code"] = code
names = [r["name"] for r in facts["response_json"]]
assert names == ["kind", "material_id", "location_id", "batch_id", "qty", "n"], names
proto = copy.deepcopy(facts["response_json"][names.index("batch_id")])
proto.update({"key": K.key(), "name": "uom", "title": "uom"})
facts["response_json"].append(proto)

SUBS = [
    ('batchRows[s(r.material_id) + "," + s(r.location_id) + "," + s(r.batch_id)] = { n: Number(r.n) || 0, qty: s(r.qty) };',
     'batchRows[s(r.material_id) + "," + s(r.location_id) + "," + s(r.batch_id)] = { n: Number(r.n) || 0, qty: s(r.qty), uom: s(r.uom) };',
     "batch facts"),
    ('err(line, "temp_qty_data", "GD_ITEM_NOT_SUPPORTED", "allocation " + seq + ": the balance row\'s unit differs from the material\'s base unit", seq);',
     'err(line, "temp_qty_data", "GD_ITEM_NOT_SUPPORTED", "allocation " + seq + ": the stock balance at this bin is in unit " + s(rows[0].material_uom) + ", but the item\'s base unit is unit " + baseUom + ": the stock and the item must use the same unit", seq);',
     "item_balance message"),
    ('            aOk = false;\n          }\n        } else if (blockers["BATCH_ROWS|"',
     '            aOk = false;\n          } else if (aOk && s(br.uom) && s(br.uom) !== baseUom) {\n'
     '            // INVENTORY_APPLY_OPERATION refuses this row too: refused here, not inside COMMIT\n'
     '            err(line, "temp_qty_data", "GD_ITEM_NOT_SUPPORTED", "allocation " + seq + ": the stock of batch " + s(a.batch_id) + " at this bin is in unit " + s(br.uom) + ", but the item\'s base unit is unit " + baseUom + ": the stock and the item must use the same unit", seq);\n'
     '            aOk = false;\n          }\n        } else if (blockers["BATCH_ROWS|"',
     "batch unit check"),
]
for nid in ("code_node_J5T1G2s9", "code_node_egoCivrm"):
    sc = find(doc, nid)["data"]["script"]
    c = sc["code"]
    for old, new, what in SUBS:
        c = sub(c, old, new, nid + " " + what)
    sc["code"] = c

out = render(doc)
json.loads(out)
print("GD_BULK_PREPARE + balance unit (batch row, both units named): %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
