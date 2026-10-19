"""Read (read-only) every tenant's number rules the way INVENTORY_BULK_APPLY reads them (sql_node_IBprec: su_code_num_precision,
status 1, "Inventory Price" / "Inventory Qty" + column rules of the six inventory tables) into the rules file replay_sa.js
--rules takes: {env: {tenant: [rule rows]}}. replay_sa.js turns a tenant's rows into planBulk's `precision` exactly like
code_node_IBplan does. A tenant without rows gets no rounding (raw 8 dp) - as the deployed engine would.
Copied from scratchpad/sav2/tpl/smv2/parity/fetch_rules.py (= smv2 LOT parity; originally scratchpad/grv2/parity); only this docstring changed.

usage: python3 fetch_rules.py <out.json> [--env prod|dev|both]
"""
import json, os, sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbq import q  # noqa: E402

TABLES = ("1902698977724317697", "1902718803880558594", "1902947165008400386", "1902948453171433474", "1902259348776800257", "1902719754154655746")


def main():
    which = sys.argv[sys.argv.index("--env") + 1] if "--env" in sys.argv else "both"
    out = {"_note": "su_code_num_precision rows as INVENTORY_BULK_APPLY sql_node_IBprec reads them, per tenant"}
    for env in ("prod", "dev") if which == "both" else (which,):
        rows = q("--" + env, "SELECT tenant_id, scope_type, rule_key, CAST(table_id AS CHAR) table_id, field_name, decimal_places, precision_rule, store_raw_value "
                             "FROM su_code_num_precision WHERE status = 1 AND is_deleted = 0 AND ((scope_type = '1' AND rule_key IN ('Inventory Price', 'Inventory Qty')) "
                             "OR (scope_type = '2' AND table_id IN (" + ",".join("'" + t + "'" for t in TABLES) + ")))")
        tenants = {}
        for r in rows:
            t = r.pop("tenant_id")
            tenants.setdefault(t, []).append({k: (None if v is None else str(v)) for k, v in r.items()})
        out[env] = tenants
        print(f"{env}: {len(tenants)} tenants with inventory number rules ({len(rows)} rows, {sum(1 for r in rows if str(r['scope_type']) == '2')} column rules)")
    json.dump(out, open(sys.argv[1], "w"), indent=1)


if __name__ == "__main__":
    main()
