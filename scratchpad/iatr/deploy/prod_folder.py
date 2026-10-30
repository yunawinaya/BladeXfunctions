"""Prod paste folder - the IA transfer request (ENH-20261027-001) and the IA split's No. of Split (10-28). Read-only on dev and prod:
for each of the 12 targets it pulls the enabled copy on prod and on dev, compares prod with the dev base the change was built on
(canonical JSON: key order ignored), checks the paste file is what dev runs now, and writes <n>_<name>.prod_base.json (prod now:
the before-check and the rollback) and <n>_<name>.prod_paste.json (dev now) into prod-hotfix/2026-10-28-ia-transfer-request/.

usage: python3 scratchpad/iatr/deploy/prod_folder.py [--write]"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "prod-hotfix", "2026-10-28-ia-transfer-request")
DB = os.path.join(REPO, ".dbtools", "db")
LOT = "Stock Movement/Location Transfer/AsyncV2/"
# n, name, kind, id (form: its table), the file to paste (= dev), the dev base the change was built on
TARGETS = [
    (1, "LOT_form", "form", "sm_location_transfer", LOT + "LOTform.json", "scratchpad/iatr/base/lot_form_v113.json"),
    (2, "IA_form", "form", "sm_item_assembly", "Item Assembly & BOM/SmallCycle/IAform.json",
     "prod-hotfix/2026-10-27-ia-row-batches-flat-level/1_IA_form.prod_paste.json"),
    (3, "LOT_list", "page", "2013863255693197313", LOT + "LOTlistPage.json", "scratchpad/iatr/base/lot_list_v49.json"),
    (4, "IA_list", "page", "2098312073316716546", "Item Assembly & BOM/AsyncV2/IAlistPage.json", "scratchpad/iatr/base/ia_list_v31.json"),
    (5, "SM_LOCATION_TRANSFER", "workflow", "2013133675374927874", LOT + "SM_LOCATION_TRANSFER.json", "scratchpad/iatr/base/lot_wf/SM_LOCATION_TRANSFER.json"),
    (6, "LOT_V2_PREPARE", "workflow", "2110992359150977026", LOT + "LOT_V2_PREPARE.json", "scratchpad/iatr/base/lot_wf/LOT_V2_PREPARE.json"),
    (7, "LOT_V2_COMMIT", "workflow", "2110992400045441026", LOT + "LOT_V2_COMMIT.json", "scratchpad/iatr/base/lot_wf/LOT_V2_COMMIT.json"),
    (8, "LOT_V2_WORKER", "workflow", "2110992316335521793", LOT + "LOT_V2_WORKER.json", "scratchpad/iatr/base/lot_wf/LOT_V2_WORKER.json"),
    (9, "LOT_V2_SUBMIT", "workflow", "2110992282596540417", LOT + "LOT_V2_SUBMIT.json", "scratchpad/iatr/base/lot_wf/LOT_V2_SUBMIT.json"),
    (10, "IA_TRANSFER_REQUEST", "workflow", "1985966508400201729", "Item Assembly & BOM/TransferRequest/IA_TRANSFER_REQUEST.json",
     "scratchpad/iatr/base/workflow5_v2.json"),
    (11, "IA_SAVE", "workflow", "2098335576774463489", "Item Assembly & BOM/SmallCycle/IA_SAVE.json", "scratchpad/iatr/base/IA_SAVE_head.json"),
    (12, "IA_V2_SUBMIT", "workflow", "2112141238600376321", "Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json", "scratchpad/iatr/base/IA_V2_SUBMIT_head.json"),
]
SQL = {
    "form": """SELECT h.version_number v, CAST(h.data_id AS CHAR) id, h.form_json j FROM su_code_tables_history h JOIN su_code_tables t ON t.id = h.data_id
               WHERE t.table_name = '%s' AND h.status = 'enabled' ORDER BY h.version_number DESC LIMIT 1""",
    "page": """SELECT version_number v, CAST(data_id AS CHAR) id, page_json j FROM su_code_pages_history WHERE data_id = %s AND status = 'enabled'
               ORDER BY version_number DESC LIMIT 1""",
    "workflow": """SELECT h.version_number v, CAST(h.data_id AS CHAR) id, h.script_json j, w.name FROM su_code_workflow_history h
                   JOIN su_code_workflow w ON w.id = h.data_id WHERE h.data_id = %s AND h.status = 'enabled' ORDER BY h.version_number DESC LIMIT 1""",
}


def enabled(env, kind, ref):
    r = subprocess.run([DB, env, "--json", SQL[kind] % ref], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-400:]
    t = r.stdout.split("\n")
    k = [i for i, l in enumerate(t) if l.strip() in ("[", "[]") or l.startswith("[{")][0]
    rows = json.loads("\n".join(t[k:]))
    assert len(rows) == 1, (env, kind, ref, rows)
    return rows[0]


def canon(text_or_obj):
    o = json.loads(text_or_obj) if isinstance(text_or_obj, str) else text_or_obj
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def main():
    write = "--write" in sys.argv
    if write:
        os.makedirs(OUT, exist_ok=True)
    rows = []
    for n, name, kind, ref, paste, base in TARGETS:
        prod = enabled("--prod", kind, ref)
        dev = enabled("--dev", kind, ref)
        paste_obj = json.load(open(os.path.join(REPO, paste), encoding="utf-8"))
        base_obj = json.load(open(os.path.join(REPO, base), encoding="utf-8"))
        prod_c, dev_c = canon(prod["j"]), canon(dev["j"])
        rows.append((n, name, kind, prod["id"], prod.get("name") or "", prod["v"], dev["v"], prod_c == canon(base_obj), canon(paste_obj) == dev_c, prod_c == dev_c))
        if write:
            stem = os.path.join(OUT, "%d_%s" % (n, name))
            json.dump(json.loads(prod["j"]), open(stem + ".prod_base.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            json.dump(paste_obj, open(stem + ".prod_paste.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("%-3s %-21s %-8s %-20s %-22s %6s %5s  %-24s %-14s" % ("n", "target", "kind", "id", "prod name", "prod v", "dev v", "prod = our dev base", "paste = dev"))
    for n, name, kind, pid, pname, pv, dv, base_ok, paste_ok, same in rows:
        print("%-3s %-21s %-8s %-20s %-22s %6s %5s  %-24s %-14s%s" % (n, name, kind, pid, pname[:22], pv, dv, "IDENTICAL" if base_ok else "DIFFERS",
                                                                     "IDENTICAL" if paste_ok else "DIFFERS", "  (prod already = dev)" if same else ""))
    if write:
        print("wrote", OUT)


if __name__ == "__main__":
    main()
