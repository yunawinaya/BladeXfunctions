"""Read (read-only) every tenant's inventory number rules from su_code_num_precision on prod and dev into the rules file
replay_old.js --rules takes: {env: {default: null, tenants: {tenant: {price: dp, qty: dp}}}}. A tenant without an active
rule stores the raw value (dev 000000 stores 8 dp).

usage: python3 fetch_rules.py <out.json>
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "gdc", "pkv2tools"))
from dbq import q  # noqa: E402


def main():
    out = {"_note": "su_code_num_precision 'Inventory Price' / 'Inventory Qty', status 1, store_raw_value 0, rounded half-up"}
    for env in ("prod", "dev"):
        rows = q("--" + env, "SELECT tenant_id, rule_key, decimal_places, precision_rule FROM su_code_num_precision "
                             "WHERE is_deleted=0 AND status=1 AND store_raw_value=0 AND rule_key IN ('Inventory Price','Inventory Qty')")
        tenants = {}
        for r in rows:
            if str(r["precision_rule"]) != "1":
                raise SystemExit(f"{env} tenant {r['tenant_id']}: precision_rule {r['precision_rule']} is not the half-up rule this study models")
            tenants.setdefault(r["tenant_id"], {})["price" if r["rule_key"] == "Inventory Price" else "qty"] = int(r["decimal_places"])
        out[env] = {"default": None, "tenants": tenants}
        print(f"{env}: {len(tenants)} tenants with inventory number rules")
    json.dump(out, open(sys.argv[1], "w"), indent=1)


if __name__ == "__main__":
    main()
