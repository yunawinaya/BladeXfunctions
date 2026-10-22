#!/usr/bin/env python3
"""MIN-01 ON blocker 2b: classic GD refuses the whole save before any write while an ENGINE run holds one of its ITEM keys.

Patches the live GD_UNUSED_FN_NEW v55 (base/GD_UNUSED_FN_NEW.live.json -> out/GD_UNUSED_FN_NEW.json). Inserted right before
`IF Check Only` (if_CheckOnly01), after code_node_QrF4F4Hx has built inventoryMovements, so it runs for both calls:
  GOODS_DELIVERY's pre-flight (checkOnly 1): a refusal there stops the save before GOODS_DELIVERY writes anything;
  the real run (GOODS_DELIVERY, PICKING_PLAN): a refusal stops before this workflow's reservation rows and movements.
One read of the lock rows of every ITEM|<material>|<bin> key in inventoryMovements: token 0 under a non-CL| owner (an engine run,
or a half release) = 400. Classic CL| holders are left out: the children queue behind them. Check-then-act: an engine run can still
take a key after this read, so it narrows the mid-loop window, it does not close it.
Switch CL_LOCK_ENABLED (flip together with the four classic children); doc_no MIN01-TEST... runs it while OFF.

Usage: python3 -I build_gd_precheck.py [--on] [--test-keys ITEM|mat|bin,...]
  --test-keys: TEST ONLY - check these keys instead of the movements (out/GD_UNUSED_FN_NEW.testkeys.json)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_subtract_lock as L  # noqa: E402

BASE = os.path.join(L.ROOT, "base", "GD_UNUSED_FN_NEW.live.json")
PRE_SQL = (
    "SELECT l.lock_key, l.free_token, l.owner_operation_id, l.last_owner_operation_id\n"
    "  FROM inventory_balance_lock l\n"
    " WHERE l.tenant_id = '{{node:code_node_CLgdKey.data.tenant}}'\n"
    "   AND l.organization_id = '{{node:code_node_CLgdKey.data.org}}'\n"
    "   AND l.is_deleted = 0\n"
    "   AND l.lock_key IN (SELECT jt.k FROM JSON_TABLE('{{node:code_node_CLgdKey.data.keysJson}}', '$[*]' COLUMNS (k VARCHAR(128) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) jt)\n"
    "   AND l.free_token = 0\n"
    "   AND l.owner_operation_id NOT LIKE 'CL|%'"
)


def build(on, test_keys):
    doc = json.load(open(BASE, encoding="utf-8"))
    src = ("const mv = [];\n" "const fixed = " + json.dumps(test_keys) + ";\n") if test_keys else (
        "const raw = [{{node:code_node_QrF4F4Hx.data.inventoryMovements}}][0];\n"
        "const mv = Array.isArray(raw) ? raw : [];\n" "const fixed = null;\n")
    key = L.code_node(
        "code_node_CLgdKey", "Classic lock pre-check: switch and the delivery's ITEM keys",
        "// MIN-01: refuse the whole delivery before any write while an engine run holds one of its ITEM keys; the classic children\n"
        "// would otherwise answer 400 busy in the middle of the movement loop. Same switch as the children's CL_LOCK_ENABLED.\n"
        f"const CL_LOCK_ENABLED = {'true' if on else 'false'};\n"
        + L.S +
        "const docNo = s([{{workflowparams:doc_no}}][0]);\n"
        "const org = s([{{workflowparams:organization_id}}][0]);\n"
        "const tenant = s([{{system:tenantId}}][0]);\n"
        + src +
        "const keys = {};\n"
        "for (const m of mv) {\n"
        "  const mat = s(m && m.material_id);\n"
        "  const bin = s(m && m.bin_location);\n"
        "  if (/^[0-9]{1,20}$/.test(mat) && /^[0-9]{1,20}$/.test(bin)) keys[\"ITEM|\" + mat + \"|\" + bin] = true;\n"
        "}\n"
        "const list = fixed || Object.keys(keys).sort();\n"
        "// DEV tests: a delivery numbered MIN01-TEST... runs the check while the switch is OFF\n"
        "const wanted = CL_LOCK_ENABLED || docNo.indexOf(\"MIN01-TEST\") === 0;\n"
        "const ok = /^[0-9]{1,19}$/.test(org) && /^[0-9]{1,20}$/.test(tenant) && list.length > 0;\n"
        "return { on: wanted && ok ? \"YES\" : \"NO\", org: org, tenant: tenant, keysJson: JSON.stringify(list), count: list.length };",
        [("on", "string"), ("org", "string"), ("tenant", "string"), ("keysJson", "string"), ("count", "int")])
    read = L.sql_node("sql_node_CLgdLk", "Classic lock pre-check: the delivery's keys held by an engine run",
                      PRE_SQL, [("lock_key", "string"), ("free_token", "int"), ("owner_operation_id", "string"),
                                ("last_owner_operation_id", "string")])
    check = L.code_node(
        "code_node_CLgdChk", "Classic lock pre-check: busy?",
        L.S +
        "const raw = [{{node:sql_node_CLgdLk.data}}][0];\n"
        "const rows = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((r) => r && r.lock_key);\n"
        "const n = rows.length;\n"
        "return {\n  busy: n ? \"YES\" : \"NO\",\n"
        "  message: n ? \"Stock of \" + n + \" item / bin pair(s) on this delivery is being updated by another document. Please try again in a moment. (\" +\n"
        "    rows.map((r) => s(r.lock_key).replace(/^ITEM\\|/, \"\")).slice(0, 5).join(\", \") + \")\" : \"\",\n};",
        [("busy", "string"), ("message", "string")])
    refuse = L.if_expr("if_CLgdBusy", "IF an engine run holds one of them: answer 400, write nothing",
                       "'{{node:code_node_CLgdChk.data.busy}}' == 'YES'",
                       [L.return_node("return_node_CLgdBusy", [("code", "value", "400"),
                                                               ("message", "field", "{{node:code_node_CLgdChk.data.message}}")])])
    if_on = L.if_expr("if_CLgdOn", "IF the classic lock is on: check the delivery's keys before any write",
                      "'{{node:code_node_CLgdKey.data.on}}' == 'YES'", [read, check, refuse])
    holder = L.parent_list(doc, "if_CheckOnly01")
    at = [i for i, x in enumerate(holder) if x.get("id") == "if_CheckOnly01"][0]
    if holder[at - 1].get("id") != "code_node_QrF4F4Hx":
        sys.exit("if_CheckOnly01 is no longer right after code_node_QrF4F4Hx: the base changed")
    holder[at:at] = [key, if_on]
    return doc


if __name__ == "__main__":
    on = "--on" in sys.argv
    tk = sys.argv[sys.argv.index("--test-keys") + 1].split(",") if "--test-keys" in sys.argv else None
    doc = build(on, tk)
    L.check(doc)
    bodies = []
    L.walk(doc, lambda x: bodies.append((x["id"], x["data"]["script"]["code"]))
           if x.get("type") == "code-node" and "CLgd" in x.get("id", "") else None)
    for nid, code in bodies:
        js = L.re.sub(r"\{\{[^}]+\}\}", "null", code)
        r = L.subprocess.run(["node", "-e", "new Function(process.argv[1])", js], capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"{nid}: JS does not parse\n{r.stderr[:600]}")
    out = os.path.join(L.ROOT, "out", "GD_UNUSED_FN_NEW" + (".testkeys" if tk else "") + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print(f"ok: {len(bodies)} pre-check code nodes parse; " + ("ON" if on else "OFF") + (" test keys" if tk else "") + " -> " + os.path.relpath(out, os.getcwd()))
