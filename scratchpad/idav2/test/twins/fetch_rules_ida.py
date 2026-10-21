"""Package E copy for Item Disassembly (tpl/iav2/live/fetch_rules_ia.py; dev only: IDA is not on prod). Read (read-only) every dev
tenant's number rules the way INVENTORY_BULK_APPLY reads them (sql_node_IBprec: su_code_num_precision, status 1, "Inventory Price" /
"Inventory Qty" + column rules of the six inventory tables) into the rules file replay_ida.js --rules takes: {"dev": {tenant: [rule rows]}} (each row with its id: a rule applies to the runs after it was created).
replay_ida.js turns a tenant's rows into planBulk's `precision` exactly like code_node_IBplan does. A tenant without rows gets no rounding.

usage: python3 fetch_rules_ida.py <out.json>     (outside the repo)
"""
import json, os, sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "live"))
import idalib  # noqa: E402

TABLES = ("1902698977724317697", "1902718803880558594", "1902947165008400386", "1902948453171433474", "1902259348776800257", "1902719754154655746")


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    idalib.guard_out(sys.argv[1])
    out = {"_note": "su_code_num_precision rows as INVENTORY_BULK_APPLY sql_node_IBprec reads them, per tenant"}
    rows = idalib.q("SELECT tenant_id, CAST(id AS CHAR) id, scope_type, rule_key, CAST(table_id AS CHAR) table_id, field_name, decimal_places, precision_rule, store_raw_value "
                    "FROM su_code_num_precision WHERE status = 1 AND is_deleted = 0 AND ((scope_type = '1' AND rule_key IN ('Inventory Price', 'Inventory Qty')) "
                    "OR (scope_type = '2' AND table_id IN (" + ",".join("'" + t + "'" for t in TABLES) + ")))")
    tenants = {}
    for r in rows:
        t = r.pop("tenant_id")
        tenants.setdefault(t, []).append({k: (None if v is None else str(v)) for k, v in r.items()})
    out["dev"] = tenants
    print(f"dev: {len(tenants)} tenants with inventory number rules ({len(rows)} rows, {sum(1 for r in rows if str(r['scope_type']) == '2')} column rules)")
    json.dump(out, open(sys.argv[1], "w"), indent=1)


if __name__ == "__main__":
    main()
