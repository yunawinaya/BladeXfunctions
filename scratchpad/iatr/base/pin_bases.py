"""Pin the live DEV bases of the reserved-request plan (RESERVED_REQUEST_PLAN.md Task 0), read-only.

  python3 scratchpad/iatr/base/pin_bases.py        -> scratchpad/iatr/base/rr_<name>_v<N>.json + PINS.md (name, id, version, md5)
"""
import hashlib
import json
import os
import subprocess

ROOT = "/Users/yunawinaya/Developer/BladeXfunctions"
HERE = os.path.join(ROOT, "scratchpad/iatr/base")
DB = os.path.join(ROOT, ".dbtools/db")

WORKFLOWS = [("IA_TRANSFER_REQUEST", "1985966508400201729"), ("LOT_V2_SUBMIT", "2110992282596540417"),
             ("LOT_V2_PREPARE", "2110992359150977026"), ("LOT_V2_COMMIT", "2110992400045441026"),
             ("LOT_V2_WORKER", "2110992316335521793"), ("SM_LOCATION_TRANSFER", "2013133675374927874"),
             ("IA_HOLD", "2112752274794217473"), ("IA_SAVE", "2098335576774463489"), ("IA_V2_SUBMIT", "2112141238600376321")]
FORMS = ["sm_item_assembly", "sm_location_transfer", "picking_setup"]
PAGES = [("IA_LIST", "2098312073316716546"), ("LOT_LIST", "2013863255693197313"), ("SETTING", "1909260299874861057")]


def query(sql):
    out = subprocess.run([DB, "--dev", "--json", sql], capture_output=True, text=True, check=True).stdout
    i = out.find("[\n")
    return json.loads(out[i:]) if i >= 0 else []


def latest(table, col, data_id):
    rows = query("SELECT h.version_number AS v, h.%s AS body FROM %s h WHERE h.data_id = %s AND h.status = 'enabled' "
                 "ORDER BY h.version_number DESC LIMIT 1" % (col, table, data_id))
    if not rows:
        raise SystemExit("no enabled version for %s %s" % (table, data_id))
    return rows[0]["v"], rows[0]["body"]


def main():
    pins = []
    targets = [("workflow", n, i) for n, i in WORKFLOWS]
    for t in FORMS:
        rows = query("SELECT CAST(t.id AS CHAR) AS id FROM su_code_tables t WHERE t.table_name = '%s' AND t.is_deleted = 0" % t)
        targets.append(("form", t, rows[0]["id"]))
    targets += [("page", n, i) for n, i in PAGES]
    for kind, name, data_id in targets:
        table, col = {"workflow": ("su_code_workflow_history", "script_json"), "form": ("su_code_tables_history", "form_json"),
                      "page": ("su_code_pages_history", "page_json")}[kind]
        v, body = latest(table, col, data_id)
        path = os.path.join(HERE, "rr_%s_v%s.json" % (name, v))
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        pins.append((kind, name, data_id, v, hashlib.md5(body.encode("utf-8")).hexdigest(), os.path.basename(path)))
    with open(os.path.join(HERE, "PINS.md"), "w", encoding="utf-8") as f:
        f.write("# Reserved-request plan: pinned DEV bases (Task 0)\n\n| Kind | Name | Id | Version | md5 | File |\n|---|---|---|---|---|---|\n")
        for p in pins:
            f.write("| %s | %s | %s | v%s | %s | %s |\n" % p)
    for p in pins:
        print("%-8s %-22s %-20s v%-4s %s" % p[:5])


if __name__ == "__main__":
    main()
