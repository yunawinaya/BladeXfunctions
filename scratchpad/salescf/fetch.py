"""fetch.py: the enabled version of every workflow and form this project patches -> base/<env>/<NAME>.json (the exact stored
JSON text) and base/<env>/versions.json. Read-only.

usage: python3 scratchpad/salescf/fetch.py --env dev|prod
"""
import argparse
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "..", ".dbtools", "db")

WORKFLOWS = {
    "SI_SAVE": "2029040374929154050",
    "SO_Convert_SI": "2029006184569364481",
    "GD_Convert_SI": "2070069049332416514",
    "SO_SAVE": "1988908545345945602",
    "GOODS_DELIVERY": "2017151544868491265",
    "GD_BULK_PREPARE": "2104840044642754561",
    "GD_BULK_COMMIT": "2104840402446245890",
    "SO_AUTO_GD": "2076557490389835777",
    "SO_Convert_GD": "1985267806223810561",
    "GD_COMPLETE_SUBMIT": "2110182609618337794",
}
FORMS = {"form_goods_delivery": "goods_delivery", "form_sales_invoice": "sales_invoice"}


def query(env, sql):
    p = subprocess.run([DB, "--" + env, "--json", sql], capture_output=True, text=True)
    lines = [ln for ln in p.stdout.splitlines() if not ln.startswith("[DEV]") and not ln.startswith("[PROD]")]
    if p.returncode != 0 or not lines:
        raise RuntimeError("query failed (%s): %s" % (env, (p.stderr or p.stdout)[-800:]))
    return json.loads("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["dev", "prod"], required=True)
    env = ap.parse_args().env
    out = os.path.join(HERE, "base", env)
    os.makedirs(out, exist_ok=True)
    versions = {}
    for name, wid in WORKFLOWS.items():
        rows = query(env, "SELECT id, version_number, create_time, script_json FROM su_code_workflow_history WHERE data_id = %s "
                          "AND status = 'enabled' ORDER BY version_number DESC LIMIT 1" % wid)
        r = rows[0]
        open(os.path.join(out, name + ".json"), "w", encoding="utf-8").write(r["script_json"])
        versions[name] = {"kind": "workflow", "dataId": wid, "version": r["version_number"], "historyId": str(r["id"]), "enabledAt": r["create_time"]}
    for name, table in FORMS.items():
        rows = query(env, "SELECT t.id AS table_id, h.id, h.version_number, h.create_time, h.form_json FROM su_code_tables_history h "
                          "JOIN su_code_tables t ON t.id = h.data_id WHERE t.table_name = '%s' AND t.tenant_id = '000000' "
                          "AND h.status = 'enabled' ORDER BY h.version_number DESC LIMIT 1" % table)
        r = rows[0]
        open(os.path.join(out, name + ".json"), "w", encoding="utf-8").write(r["form_json"])
        versions[name] = {"kind": "form", "dataId": str(r["table_id"]), "version": r["version_number"], "historyId": str(r["id"]),
                          "enabledAt": r["create_time"]}
    json.dump(versions, open(os.path.join(out, "versions.json"), "w"), indent=1)
    for name, v in versions.items():
        print("%-20s %-8s v%-5s %s" % (name, v["kind"], v["version"], v["enabledAt"]))
    print("%d items -> %s" % (len(versions), out))


if __name__ == "__main__":
    main()
