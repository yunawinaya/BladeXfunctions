#!/usr/bin/env python3
"""MIN-01 A1 / A2 (RF-03 owner check): a Reserved subtract may not take the bucket below the open Item Assembly holds on its row.

Patches the live SUBTRACT_INVENTORY v60 (A1) or SUBTRACT_INVENTORY_NEW v26 (A2), both of which already carry the classic lock.
Inserted right after `IF Insufficient quantity` (if_1rlS6mFL), before any costing read or write:
  code_node_FLgate (switch IA_FLOOR_ENABLED, gate: category Reserved, transaction type not IA) -> if_FLon ->
  sql_node_FLholds (open IA hold rows on this material + bin + plant + org (+ batch), summed per unit) -> code_node_FLcheck
  (base units as code_node_wBfvXM2G converts; the bucket as code_node_DUBS9GZF reads it) -> if_FLrefuse -> 400 + errorMessage.
Transaction type IA is exempt: IA_SAVE's completion takes Reserved only up to its own holds, and since IA_SAVE v23 (fb, 22 Oct) it
refuses picks sent from Reserved. Holds are read before the classic lock is taken: a hold that lands between this check and the
write is not seen (documented gap). Direct calls with trx_no MIN01-TEST... run the check while the switch is OFF.

Usage: python3 -I build_floor.py sub|subnew [--on] [--fake-hold <base qty>]
  --fake-hold: TEST ONLY - the hold query returns one fixed hold of that many base units (out/<name>.fakehold.json).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_subtract_lock as L  # noqa: E402

CFG = {"sub": ("SUBTRACT_INVENTORY.live_v60.json", "SUBTRACT_INVENTORY.json"),
       "subnew": ("SUBTRACT_INVENTORY_NEW.live_v26.json", "SUBTRACT_INVENTORY_NEW.json")}

HOLDS_SQL = (
    "SELECT CAST(o.item_uom AS CHAR) AS uom, SUM(o.open_qty) AS open_qty,\n"
    "       GROUP_CONCAT(DISTINCT o.doc_no ORDER BY o.doc_no SEPARATOR ', ') AS docs\n"
    "  FROM on_reserved_gd o\n"
    " WHERE o.tenant_id = '{{node:code_node_FLgate.data.tenant}}'\n"
    "   AND o.is_deleted = 0\n"
    "   AND o.doc_type = 'Item Assembly'\n"
    "   AND o.status IN ('Allocated', 'Processing', 'Releasing')\n"
    "   AND o.open_qty > 0\n"
    "   AND o.organization_id = '{{node:code_node_FLgate.data.org}}'\n"
    "   AND o.plant_id = {{node:code_node_FLgate.data.plant}}\n"
    "   AND o.material_id = {{node:code_node_FLgate.data.mat}}\n"
    "   AND o.bin_location = {{node:code_node_FLgate.data.bin}}\n"
    "   AND {{node:code_node_FLgate.data.batchCond}}\n"
    " GROUP BY o.item_uom"
)


def build(which, on, fake_hold):
    base, _ = CFG[which]
    doc = json.load(open(os.path.join(L.ROOT, "base", base), encoding="utf-8"))
    gate = L.code_node(
        "code_node_FLgate", "IA floor: switch and gate",
        "// MIN-01 RF-03: a Reserved subtract may not take the bucket below the open Item Assembly holds on this row. The IA's own\n"
        "// completion (transaction type IA) is exempt: it takes Reserved only up to its own holds.\n"
        f"const IA_FLOOR_ENABLED = {'true' if on else 'false'};\n"
        + L.S +
        "const D = /^[0-9]{1,20}$/;\n"
        "const cat = s([{{workflowparams:inventory_category}}][0]);\n"
        "const tt = s([{{workflowparams:transaction_type}}][0]);\n"
        "const trx = s([{{workflowparams:trx_no}}][0]);\n"
        "const mat = s([{{workflowparams:material_id}}][0]);\n"
        "const bin = s([{{workflowparams:location_id}}][0]);\n"
        "const plant = s([{{workflowparams:plant_id}}][0]);\n"
        "const org = s([{{workflowparams:organization_id}}][0]);\n"
        "const batch = s([{{workflowparams:batch_id}}][0]);\n"
        "const tenant = s([{{system:tenantId}}][0]);\n"
        "// DEV tests: a direct call with trx_no MIN01-TEST... runs the check while the switch is OFF\n"
        "const wanted = (IA_FLOOR_ENABLED || trx.indexOf(\"MIN01-TEST\") === 0) && cat === \"Reserved\" && tt !== \"IA\";\n"
        "const ok = D.test(mat) && D.test(bin) && D.test(plant) && /^[0-9]{1,19}$/.test(org) && D.test(tenant) && (batch === \"\" || D.test(batch));\n"
        "if (wanted && !ok) console.log(\"IA floor skipped: ids are not digits\", mat, bin, plant, org, batch);\n"
        "return { on: wanted && ok ? \"YES\" : \"NO\", mat: mat, bin: bin, plant: plant, org: org, tenant: tenant,\n"
        "  batchCond: batch ? \"o.batch_id = \" + batch : \"o.batch_id IS NULL\" };",
        [("on", "string"), ("mat", "string"), ("bin", "string"), ("plant", "string"), ("org", "string"), ("tenant", "string"),
         ("batchCond", "string")])
    sql = HOLDS_SQL if fake_hold is None else (
        f"SELECT CAST(i.based_uom AS CHAR) AS uom, {float(fake_hold)} AS open_qty, 'IA-FAKE-HOLD-TEST' AS docs\n"
        "  FROM item i WHERE i.id = {{node:code_node_FLgate.data.mat}}")
    holds = L.sql_node("sql_node_FLholds", "IA floor: open Item Assembly holds on this row", sql,
                       [("uom", "string"), ("open_qty", "number"), ("docs", "string")])
    holds["data"]["tableId"] = "1935880014687440897"
    holds["data"]["table_id"] = {"source": "On Reserved Goods Delivery:Table:1935880014687440897",
                                 "rules": {"collectionId": "1935880014687440897", "list": []}}
    check = L.code_node(
        "code_node_FLcheck", "IA floor: would this subtract cut into the IA holds?",
        "// held = the open IA hold rows in base units (each row's unit converted as code_node_wBfvXM2G converts); the bucket is the\n"
        "// one code_node_DUBS9GZF checked (the batch row when batched)\n"
        "const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));\n"
        "const itemData = {{node:code_node_TC1cqaOy.data.itemData}} || {};\n"
        "const conv = Array.isArray(itemData.table_uom_conversion) ? itemData.table_uom_conversion : [];\n"
        "const raw = [{{node:sql_node_FLholds.data}}][0];\n"
        "const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];\n"
        "let held = 0;\n"
        "const docs = [];\n"
        "for (const r of rows) {\n"
        "  const c = conv.find((x) => String(x.alt_uom_id) === String(r.uom));\n"
        "  held = q8(held + q8(r.open_qty) * (c ? Number(c.base_qty) || 1 : 1));\n"
        "  if (r.docs) docs.push(r.docs);\n"
        "}\n"
        "const reservedNow = q8({{node:code_node_DUBS9GZF.data.currentCategoryQty}});\n"
        "const after = q8(reservedNow - q8({{node:code_node_wBfvXM2G.data.baseQty}}));\n"
        "const refuse = held > 0 && after < held;\n"
        "return {\n  refuse: refuse ? \"YES\" : \"NO\", held: held, after: after,\n"
        "  message: refuse ? \"Reserved stock of this item at this bin is held for Item Assembly \" + docs.join(\", \") + \" (\" + held + \" held, \" +\n"
        "    reservedNow + \" reserved). Release it from the Item Assembly first.\" : \"\",\n};",
        [("refuse", "string"), ("held", "number"), ("after", "number"), ("message", "string")])
    refuse = L.if_expr("if_FLrefuse", "IF it would: answer 400, write nothing",
                       "'{{node:code_node_FLcheck.data.refuse}}' == 'YES'",
                       [L.return_node("return_node_FLrefuse", [("code", "value", "400"),
                                                               ("errorMessage", "field", "{{node:code_node_FLcheck.data.message}}")])])
    if_on = L.if_expr("if_FLon", "IF the IA floor applies: read the IA holds on this row", "'{{node:code_node_FLgate.data.on}}' == 'YES'",
                      [holds, check, refuse])
    holder = L.parent_list(doc, "if_1rlS6mFL")
    at = [i for i, x in enumerate(holder) if x.get("id") == "if_1rlS6mFL"][0]
    holder[at + 1:at + 1] = [gate, if_on]
    return doc


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which not in CFG:
        sys.exit("usage: build_floor.py sub|subnew [--on] [--fake-hold <base qty>]")
    on = "--on" in sys.argv
    fake = sys.argv[sys.argv.index("--fake-hold") + 1] if "--fake-hold" in sys.argv else None
    doc = build(which, on, fake)
    L.check(doc)
    bodies = []
    L.walk(doc, lambda x: bodies.append((x["id"], x["data"]["script"]["code"]))
           if x.get("type") == "code-node" and "FL" in x.get("id", "") else None)
    for nid, code in bodies:
        js = L.re.sub(r"\{\{[^}]+\}\}", "null", code)
        r = L.subprocess.run(["node", "-e", "new Function(process.argv[1])", js], capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"{nid}: JS does not parse\n{r.stderr[:600]}")
    print(f"ok: {len(bodies)} IA-floor code nodes parse")
    name = CFG[which][1].replace(".json", ".fakehold.json" if fake is not None else ".json")
    out = os.path.join(L.ROOT, "out", "floor_" + name)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print(("ON" if on else "OFF") + (f" fake hold {fake}" if fake else "") + " build -> " + os.path.relpath(out, os.getcwd()))
