"""patch_engine_precision.py: the stock engine verifies stored decimals at the scale the platform stores them (2026-10-26).

The platform rounds every stock decimal on write to the tenant's number rule (su_code_num_precision, scope 1):
"Inventory Price" (inventory_movement unit_price / total_price) and "Inventory Qty" (the four movement quantities and the six
item_balance / item_batch_balance quantities), seeded 4 / 3 decimals, precision_rule 1, store_raw_value 0 on all 80 prod
tenants. The engine plans at 8 decimals and its checks compared exactly, so a FIFO price with more than 4 decimals failed the
AFTER_MOVEMENT_INSERT check although the stock was right: GUB GD-26/10/0528, planned 99.93685714 / 6995.5799998, stored
99.9369 / 6995.58 (prod-hotfix/2026-10-26-gub-gd0528-review).

INVENTORY_APPLY_OPERATION:
- sql_node_e7OzTOyD (balance re-read under lock, always one row or more) also returns `num_rules`: the tenant's rules for the
  stock columns, as INVENTORY_BULK_APPLY reads them (scope 1 Inventory Price / Inventory Qty, scope 2 per column of
  inventory_movement / item_balance / item_batch_balance), one "scope:rule_key:table_id:field:decimals:rule:raw" per row
  joined by ";" ('' when none), declared in its response_json.
- code_node_8rCPo75P puts them in plan.scale ({price, qty, columns}: {dp, rule} or null) and in the stored mutation_plan.
- effectFacts (pre-write, balance, movement and final checks) compares with near(): the stored value is the planned value,
  or sits on the rule's scale and is the planned value rounded half up (rule 1; either way at a tie) / within one step
  (2 toward zero, 3 away from zero). A column rule wins over its group's; none configured, or raw, compares exactly. reviewOutcome keeps plan.scale in the stored plan.
INVENTORY_OPERATION_RECONCILE:
- the same effectFacts, given the stored plan's scale; a plan stored before this change has none and gets the seeded 4 / 3.

Rendered as the repo keeps it: Prettier --parser json.
usage: python3 patch_engine_precision.py [--write]
"""
import json
import os
import re
import subprocess
import sys

ROOT = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/"
APPLY = ROOT + "INVENTORY_APPLY_OPERATION.json"
RECON = ROOT + "INVENTORY_OPERATION_RECONCILE.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
T = "'{{node:code_node_cW0Exw93.data.tenantId}}'"

FACTS_DEC = '  const DEC = ["unit_price", "total_price", "quantity", "base_qty", "actual_qty", "actual_base_qty"];\n'
FACTS_NEAR = FACTS_DEC + (
    "  // 2026-10-26: the platform stores each stock decimal rounded to the tenant's number rule (Inventory Price / Inventory Qty):\n"
    "  // a stored value matches when it is the planned value or the planned value rounded at that scale (null rule = exact)\n"
    '  const sc = input.scale || { price: { dp: 4, rule: "1" }, qty: { dp: 3, rule: "1" } }; // a plan stored before: the seeded rules\n'
    '  const ruleOf = (table, c) => (sc.columns && Object.prototype.hasOwnProperty.call(sc.columns, table + "." + c) ? sc.columns[table + "." + c] : c === "unit_price" || c === "total_price" ? sc.price : sc.qty);\n'
    "  const near = (a, b, r) => {\n"
    "    const x = D.parse(a);\n"
    "    const y = D.parse(b);\n"
    "    if (x === null || y === null) return false;\n"
    "    if (x === y) return true;\n"
    "    const dp = r ? Number(r.dp) : NaN;\n"
    "    if (!Number.isInteger(dp) || dp < 0 || dp >= 8) return false;\n"
    "    let unit = 1n;\n"
    "    for (let i = dp; i < 8; i++) unit *= 10n;\n"
    "    if (x % unit !== 0n) return false;\n"
    "    const d = x > y ? x - y : y - x;\n"
    '    return String(r.rule) === "1" ? 2n * d <= unit : d < unit; // rule 1 = half up; 2 / 3 (toward / away from zero): within one step\n'
    "  };\n"
)
FACTS_SWAPS = [
    ("        if (!D.same(val(r[c]), p.after[c])) {\n", '        if (!near(val(r[c]), p.after[c], ruleOf(s(p.table) || "item_balance", c))) {\n'),
    ("        if (!D.same(val(r[c]), p.before[c])) before = false;\n", '        if (!near(val(r[c]), p.before[c], ruleOf(s(p.table) || "item_balance", c))) before = false;\n'),
    ("      for (const c of DEC) if (!D.same(r[c], m[c])) diffs.push(",
     '      for (const c of DEC) if (!near(r[c], m[c], ruleOf("inventory_movement", c))) diffs.push('),
]
REVIEW_OLD = "mutation_plan: { balances: rv.plan.balances, movement_keys: rv.plan.movement_keys, priced: rv.plan.priced || [], checks: rv.plan.checks || [] } };"
REVIEW_NEW = "mutation_plan: { balances: rv.plan.balances, movement_keys: rv.plan.movement_keys, priced: rv.plan.priced || [], checks: rv.plan.checks || [], scale: rv.plan.scale || null } };"
CALLS = {
    "code_node_FyT3zuFi": ("effectFacts({ balances: rv.plan.balances, movements: [], effects: [], balRows: rows, movRows: [] })",
                           "effectFacts({ balances: rv.plan.balances, movements: [], effects: [], balRows: rows, movRows: [], scale: rv.plan.scale })"),
    "code_node_p0sOD8ej": ("effectFacts({ balances: rv.plan.balances, movements: [], effects: [], balRows: rows, movRows: [] })",
                           "effectFacts({ balances: rv.plan.balances, movements: [], effects: [], balRows: rows, movRows: [], scale: rv.plan.scale })"),
    "code_node_Pf6NFe7B": ("effectFacts({ balances: [], movements: rv.movementRows, effects: [], balRows: [], movRows: rows })",
                           "effectFacts({ balances: [], movements: rv.movementRows, effects: [], balRows: [], movRows: rows, scale: rv.plan.scale })"),
    "code_node_ncZJyNmS": ("effectFacts({ balances: rv.plan.balances, movements: rv.movementRows, effects: effects, balRows: reads.bal, movRows: reads.mov })",
                           "effectFacts({ balances: rv.plan.balances, movements: rv.movementRows, effects: effects, balRows: reads.bal, movRows: reads.mov, scale: rv.plan.scale })"),
}
RECON_CALL = ("effectFacts({ balances: plan.balances, movements: expected, effects: factEffects, balRows: reads.bal, movRows: reads.mov })",
              "effectFacts({ balances: plan.balances, movements: expected, effects: factEffects, balRows: reads.bal, movRows: reads.mov, scale: plan.scale })")

SQL_OLD = "       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,\n"
SQL_NEW = SQL_OLD + (
    "       IFNULL((SELECT GROUP_CONCAT(CONCAT_WS(':', p.scope_type, IFNULL(p.rule_key, ''), IFNULL(p.table_id, ''), IFNULL(p.field_name, ''),\n"
    "                                             IFNULL(p.decimal_places, ''), IFNULL(p.precision_rule, ''), IFNULL(p.store_raw_value, 0)) SEPARATOR ';')\n"
    "                 FROM su_code_num_precision p\n"
    "                WHERE p.tenant_id = " + T + "\n"
    "                  AND p.status = 1\n"
    "                  AND p.is_deleted = 0\n"
    "                  AND ((p.scope_type = '1' AND p.rule_key IN ('Inventory Price', 'Inventory Qty'))\n"
    "                    OR (p.scope_type = '2' AND p.table_id IN ('1902259348776800257', '1902698977724317697', '1902718803880558594')))), '') AS num_rules,\n"
)

REVAL_FN = "const revalidate = function revalidate(guard, persist, balances) {\n"
REVAL_NEW = (
    "// the tenant's number rules for the stock columns, read with the balances: rows \"scope:rule_key:table_id:field:decimals:rule:raw\"\n"
    "// joined by \";\" (scope 1 = Inventory Price / Inventory Qty, scope 2 = one column of a stock table, which wins). The platform\n"
    "// stores each stock decimal rounded to them, so the checks compare at that scale (null = not configured or raw: exact)\n"
    "const numScale = function numScale(text) {\n"
    '  const TABLE = { "1902259348776800257": "inventory_movement", "1902698977724317697": "item_balance", "1902718803880558594": "item_batch_balance" };\n'
    "  const out = { price: null, qty: null, columns: {} };\n"
    '  for (const row of String(text || "").split(";")) {\n'
    '    const f = row.split(":");\n'
    "    if (f.length !== 7 || !/^[0-9]+$/.test(f[4])) continue;\n"
    '    const rule = f[6] === "1" ? null : { dp: Number(f[4]), rule: f[5] };\n'
    '    if (f[0] === "1" && f[1] === "Inventory Price") out.price = rule;\n'
    '    else if (f[0] === "1" && f[1] === "Inventory Qty") out.qty = rule;\n'
    '    else if (f[0] === "2" && TABLE[f[2]] && f[3]) out.columns[TABLE[f[2]] + "." + f[3]] = rule;\n'
    "  }\n"
    "  return out;\n"
    "};\n"
) + REVAL_FN
READ_OLD = (
    '  let leaseUntil = "";\n'
    "  for (const r of arr(b.item)) {\n"
    "    if (r && !dbNow && r.db_now) dbNow = String(r.db_now);\n"
    "    if (r && !leaseUntil && r.lease_until) leaseUntil = String(r.lease_until);\n"
    "  }\n"
)
READ_NEW = (
    '  let leaseUntil = "";\n'
    '  let numRules = "";\n'
    "  for (const r of arr(b.item)) {\n"
    "    if (r && !dbNow && r.db_now) dbNow = String(r.db_now);\n"
    "    if (r && !leaseUntil && r.lease_until) leaseUntil = String(r.lease_until);\n"
    "    if (r && !numRules && r.num_rules) numRules = String(r.num_rules);\n"
    "  }\n"
)
PLAN_OLD = "  const plan = { balances: [], movement_keys: guard.effects.filter((e) => e.movementKey).map((e) => e.movementKey).sort(), priced: priced, checks: checks };\n"
PLAN_NEW = "  const plan = { balances: [], movement_keys: guard.effects.filter((e) => e.movementKey).map((e) => e.movementKey).sort(), priced: priced, checks: checks, scale: numScale(numRules) };\n"
STORE_OLD = "mutation_plan: { balances: plan.balances, movement_keys: plan.movement_keys, priced: plan.priced, checks: plan.checks, planned_at: dbNow }"
STORE_NEW = "mutation_plan: { balances: plan.balances, movement_keys: plan.movement_keys, priced: plan.priced, checks: plan.checks, scale: plan.scale, planned_at: dbNow }"


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


def swap(code, old, new, what):
    assert code.count(old) == 1, "%s: anchor found %d times" % (what, code.count(old))
    return code.replace(old, new)


def patch_facts(code, nid):
    code = swap(code, FACTS_DEC, FACTS_NEAR, nid + " DEC")
    for old, new in FACTS_SWAPS:
        code = swap(code, old, new, nid + " compare")
    assert "D.same(val(" not in code and "!D.same(r[c]" not in code, nid + ": an exact compare is left in effectFacts"
    return code


def load(path):
    raw = open(path, encoding="utf-8").read()
    doc = json.loads(raw)
    assert render(doc) == raw, path + " does not round-trip"
    return raw, doc


raw_a, app = load(APPLY)
raw_r, rec = load(RECON)
assert "num_rules" not in raw_a and "numScale" not in raw_a, "already patched"

sql = find(app, "sql_node_e7OzTOyD")["data"]
sql["script"]["code"] = swap(sql["script"]["code"], SQL_OLD, SQL_NEW, "sql_node_e7OzTOyD")
taken = set(re.findall(r'"key": "([a-z0-9]{8})"', raw_a))
key = next(k for k in ("nmrls26a", "nmrls26b", "nmrls26c") if k not in taken)
names = [e["name"] for e in sql["response_json"]]
assert "num_rules" not in names
sql["response_json"].insert(names.index("lease_until") + 1, {"key": key, "name": "num_rules", "title": "num_rules", "description": "", "bsonType": "string", "isExpand": False, "children": []})

rv = find(app, "code_node_8rCPo75P")["data"]["script"]
rv["code"] = swap(rv["code"], REVAL_FN, REVAL_NEW, "revalidate")
rv["code"] = swap(rv["code"], READ_OLD, READ_NEW, "revalidate read")
rv["code"] = swap(rv["code"], PLAN_OLD, PLAN_NEW, "plan")
rv["code"] = swap(rv["code"], STORE_OLD, STORE_NEW, "stored plan")

for nid, (old, new) in CALLS.items():
    c = find(app, nid)["data"]["script"]
    c["code"] = patch_facts(c["code"], nid)
    c["code"] = swap(c["code"], old, new, nid + " call")
    c["code"] = swap(c["code"], REVIEW_OLD, REVIEW_NEW, nid + " reviewOutcome")

c = find(rec, "code_node_mDGats0w")["data"]["script"]
c["code"] = patch_facts(c["code"], "code_node_mDGats0w")
c["code"] = swap(c["code"], RECON_CALL[0], RECON_CALL[1], "reconcile call")

out_a, out_r = render(app), render(rec)
print("INVENTORY_APPLY_OPERATION: num_rules read + plan.scale + near() in 4 checks; %+d chars" % (len(out_a) - len(raw_a)))
print("INVENTORY_OPERATION_RECONCILE: near() with the stored plan's scale; %+d chars" % (len(out_r) - len(raw_r)))
if "--write" in sys.argv:
    open(APPLY, "w", encoding="utf-8").write(out_a)
    open(RECON, "w", encoding="utf-8").write(out_r)
    print("written")
else:
    print("ok (dry): pass --write")
