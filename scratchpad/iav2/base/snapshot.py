"""Snapshots of what is LIVE on dev for Item Assembly V2 (read-only SELECTs through .dbtools/db).

Every base we lift from, patch or call is pinned at its enabled dev version; prod is compared by normalized JSON
(key order differs between environments for identical content).

usage: python3 snapshot.py           (re-pulls every snapshot into this folder, writes MANIFEST.json)
       python3 snapshot.py --check   (pulls, compares with the files here, writes nothing; exit 1 on a difference)
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from dbq import q  # noqa: E402

CHECK = "--check" in sys.argv
problems = []

WORKFLOWS = [  # name, id, dev version pinned, role
    ("IA_SAVE", 2098335576774463489, 12, "base of the guarded classic v12; lifted bodies (code_fillback, code_validate, code_receipt_prep, code_batch_decide)"),
    ("IA_REVERT", 2099319746652852225, 5, "must keep reverting V2-completed IAs (movement / FIFO / batch shapes)"),
    ("CHECK_REQUIRED_FIELD", 1988831880511062018, 8, "lifted in SUBMIT"),
    ("GLOBAL_INVENTORY_VALIDATION", 2056291728334573570, 11, "classic 402 pre-check callee; message texts"),
    ("GENERATE_BATCH", 2060178784435535873, 20, "called by SUBMIT for 'According To System Settings' parents (pass organization_id)"),
    ("INVENTORY_BULK_APPLY", 2109916822821744641, 10, "the engine, called unchanged by COMMIT I2 / I3 (two operations)"),
    ("INVENTORY_LOCK_TOKENS", 2105936479113383937, 5, "called by the engine"),
    ("INVENTORY_LOCK_SEED", 2111078356478234625, 5, "called by the engine"),
    ("ADD_INVENTORY", 2012005532688723970, 65, "classic IN callee; Batch row columns (add_node_F9KqZLfd); parity reference"),
    ("SUBTRACT_INVENTORY", 2012096660219564034, 59, "classic OUT callee; parity reference"),
    ("ACC_PRODUCER", 2013511169625042946, 119, "the client's post call (post_item_assembly)"),
    ("SQL_FETCH_POST_DATA", 2018512118312943617, 221, "posting fetch preconditions (POST ITEM ASSEMBLY branch)"),
]
FORMS = [  # name, table id, dev version pinned
    ("ia_form", 2098256587713404929, 36),
]
SCHEMAS = [("sm_item_assembly", 2098256587713404929), ("sm_item_assembly_tlm8ve69_sub", 2098269596661833730),
           ("batch", 1902719754154655746)]
PAGES = [  # name, page id, dev version pinned
    ("ia_list", 2098312073316716546, 22),
]
COLUMN_TABLES = ["sm_item_assembly", "sm_item_assembly_tlm8ve69_sub", "batch", "inventory_movement", "item_balance",
                 "item_batch_balance", "fifo_costing_history", "wa_costing_method", "gd_async_job", "gd_publish_step",
                 "inventory_balance_lock", "batch_number_config"]


def md5(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def norm(text):
    return json.dumps(json.loads(text), sort_keys=True, ensure_ascii=False)


def put(name, text):
    path = os.path.join(HERE, name)
    if CHECK:
        same = os.path.exists(path) and open(path, encoding="utf-8").read() == text
        print(("same     " if same else "DIFFERS  ") + name)
        if not same:
            problems.append(name + " differs from dev")
        return
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print("wrote    %s (%d chars, md5 %s)" % (name, len(text), md5(text)))


def one(env, sql):
    rows = q(env, sql)
    assert len(rows) == 1, (env, len(rows), sql[:200])
    return rows[0]


def prod_same(table, col, data_id, dev_text):
    rows = q("--prod", f"SELECT version_number AS v, {col} AS body FROM {table} WHERE data_id = {data_id} AND status = 'enabled' "
                       f"ORDER BY version_number DESC LIMIT 1")
    if not rows:
        return {"prod": "absent"}
    return {"prod_version": rows[0]["v"], "prod_same_normalized": norm(rows[0]["body"]) == norm(dev_text),
            "prod_md5": md5(rows[0]["body"])}


manifest = {"pulled_from": "dev (.dbtools/db --dev, SELECT only); prod compared by normalized JSON", "files": {}}

for name, wid, ver, role in WORKFLOWS:
    r = one("--dev", f"SELECT CAST(id AS CHAR) AS hid, version_number AS v, create_time AS t, script_json FROM su_code_workflow_history "
                     f"WHERE data_id = {wid} AND status = 'enabled' ORDER BY version_number DESC LIMIT 1")
    if int(r["v"]) != ver:
        problems.append("%s: dev enabled is v%s, pinned v%d" % (name, r["v"], ver))
    fn = "%s.v%s.json" % (name, r["v"])
    put(fn, r["script_json"])
    designing = q("--dev", f"SELECT version_number AS v, MD5(script_json) AS m FROM su_code_workflow_history WHERE data_id = {wid} AND status = 'designing'")
    manifest["files"][fn] = {"id": str(wid), "role": role, "history_id": r["hid"], "created": str(r["t"]), "md5": md5(r["script_json"]),
                             "designing": [{"v": d["v"], "same": d["m"] == md5(r["script_json"])} for d in designing],
                             **prod_same("su_code_workflow_history", "script_json", wid, r["script_json"])}

for name, tid, ver in FORMS:
    r = one("--dev", f"SELECT CAST(id AS CHAR) AS hid, version_number AS v, create_time AS t, form_json FROM su_code_tables_history "
                     f"WHERE data_id = {tid} AND status = 'enabled' ORDER BY version_number DESC LIMIT 1")
    if int(r["v"]) != ver:
        problems.append("%s: dev enabled is v%s, pinned v%d" % (name, r["v"], ver))
    fn = "%s_v%s.json" % (name, r["v"])
    put(fn, r["form_json"])
    cur = one("--dev", f"SELECT MD5(form_json) AS m FROM su_code_tables WHERE id = {tid}")
    manifest["files"][fn] = {"table_id": str(tid), "history_id": r["hid"], "created": str(r["t"]), "md5": md5(r["form_json"]),
                             "working_copy_same": cur["m"] == md5(r["form_json"]),
                             **prod_same("su_code_tables_history", "form_json", tid, r["form_json"])}

for tname, tid in SCHEMAS:
    s = one("--dev", f"SELECT schema_json FROM su_code_tables WHERE id = {tid}")
    fn = "schema_%s.json" % tname
    put(fn, s["schema_json"])
    manifest["files"][fn] = {"table_id": str(tid), "md5": md5(s["schema_json"])}

for name, pid, ver in PAGES:
    r = one("--dev", f"SELECT CAST(id AS CHAR) AS hid, version_number AS v, create_time AS t, page_json FROM su_code_pages_history "
                     f"WHERE data_id = {pid} AND status = 'enabled' ORDER BY version_number DESC LIMIT 1")
    if int(r["v"]) != ver:
        problems.append("%s: dev enabled is v%s, pinned v%d" % (name, r["v"], ver))
    fn = "%s_v%s.json" % (name, r["v"])
    put(fn, r["page_json"])
    designing = q("--dev", f"SELECT version_number AS v, MD5(page_json) AS m FROM su_code_pages_history WHERE data_id = {pid} AND status = 'designing'")
    manifest["files"][fn] = {"page_id": str(pid), "history_id": r["hid"], "created": str(r["t"]), "md5": md5(r["page_json"]),
                             "designing": [{"v": d["v"], "same": d["m"] == md5(r["page_json"])} for d in designing],
                             **prod_same("su_code_pages_history", "page_json", pid, r["page_json"])}

cols, idx = {}, {}
for t in COLUMN_TABLES:
    rows = q("--dev", "SELECT column_name AS name, column_type AS type, is_nullable AS nullable FROM information_schema.columns "
                      f"WHERE table_schema = DATABASE() AND table_name = '{t}' ORDER BY ordinal_position")
    cols[t] = [{"name": c["name"], "type": c["type"], "nullable": c["nullable"]} for c in rows]
    rows = q("--dev", "SELECT index_name AS name, non_unique AS nu, column_name AS col FROM information_schema.statistics "
                      f"WHERE table_schema = DATABASE() AND table_name = '{t}' ORDER BY index_name, seq_in_index")
    idx[t] = {}
    for x in rows:
        idx[t].setdefault(("UNIQUE " if int(x["nu"]) == 0 else "") + x["name"], []).append(x["col"])
put("columns.json", json.dumps({"columns": cols, "indexes": idx}, ensure_ascii=False, indent=1) + "\n")

if not CHECK:
    put("MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=1, default=str) + "\n")
if problems:
    print("PROBLEMS:", problems)
    sys.exit(1)
print("ok")
