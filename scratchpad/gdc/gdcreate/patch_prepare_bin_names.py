"""patch_prepare_bin_names.py: GD_BULK_PREPARE reads bin names only for the bins its allocation can use (2026-10-30, the user's yes).

sql_node_rCfSqwDY's BIN branch read the plant's first 500 bins by id. Kenhin's plant has 1,500, and its main bin "501" is
the 501st, so since 10-23 every auto-allocated line from it stored "1. 2011257408998285313: 200 KG" in view_stock (876 lines).
The bin list only names bins in that summary. Now the branch reads the bins of the balance rows the IBAL / BBAL branches load
(same filters: these materials at this plant, unrestricted_qty > 0), by primary key, the way the BATCH branch already reads
batches. The UNION sits in a derived table (an IN (... UNION ...) runs per row); LIMIT 500 stays as a cap.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_prepare_bin_names.py [--write]
"""
import json
import os
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_PREPARE.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
T = "'{{node:code_node_kYqf0Zfd.data.tenantId}}'"
ORG = "'{{node:code_node_FniXEIuQ.data.organizationId}}'"
PLANT = "{{node:code_node_FniXEIuQ.data.plantId}}"
MATS = "{{node:code_node_FniXEIuQ.data.autoMaterialIdsSql}}"
BL_WHERE = f"bl.tenant_id = {T} AND bl.organization_id = {ORG} AND bl.plant_id = {PLANT} AND bl.is_deleted = 0"
OLD = f"""  FROM (SELECT bl.id, bl.bin_location_combine
          FROM bin_location bl
         WHERE {BL_WHERE}
         ORDER BY bl.id LIMIT 500) x"""
BAL = f"b.tenant_id = {T} AND b.organization_id = {ORG} AND b.plant_id = {PLANT} AND b.is_deleted = 0 AND b.material_id IN ({MATS}) AND b.unrestricted_qty > 0"
NEW = f"""  FROM (SELECT bl.id, bl.bin_location_combine
          FROM bin_location bl
          JOIN (SELECT b.location_id FROM item_balance b WHERE {BAL}
                UNION
                SELECT b.location_id FROM item_batch_balance b WHERE {BAL}) u
            ON u.location_id = bl.id
         WHERE {BL_WHERE}
         ORDER BY bl.id LIMIT 500) x"""


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


def patch(doc):
    script = find(doc, "sql_node_rCfSqwDY")["data"]["script"]
    assert script["code"].count(OLD) == 1, "anchor found %d times (already patched?)" % script["code"].count(OLD)
    script["code"] = script["code"].replace(OLD, NEW)
    return doc


if __name__ == "__main__":
    raw = open(P, encoding="utf-8").read()
    doc = json.loads(raw)
    assert render(doc) == raw, "the repo file does not round-trip"
    out = render(patch(doc))
    print("GD_BULK_PREPARE: BIN names for the balance rows' bins only; %+d chars" % (len(out) - len(raw)))
    if "--write" in sys.argv:
        open(P, "w", encoding="utf-8").write(out)
        print("written")
    else:
        print("ok (dry): pass --write")
