"""Snapshots of what is LIVE on dev for SM V2 / Location Transfer (read-only SELECTs through .dbtools/db).

usage: python3 snapshot.py           (re-pulls every snapshot into this folder and checks the MD5s)
       python3 snapshot.py --check   (pulls, compares with the files here, writes nothing; exit 1 on a difference)
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from dbq import q  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CHECK = "--check" in sys.argv
WF_ID = 2013133675374927874          # SM_LOCATION_TRANSFER
WF_V82_MD5 = "48690c5886be1917615d1133aeadcaac"
LOT_TABLE = 2013791389687349250      # sm_location_transfer (Location Transfer)
LOT_LINES = 2013831779991814146      # sm_location_transfer_d2c7o1jd_sub
LIST_PAGE = 2013863255693197313      # Location Transfer list page
PROD_FILE = os.path.join(REPO, "prod-hotfix", "2026-10-08-bug-register", "SM_LOCATION_TRANSFER.PROD.json")
COLUMN_TABLES = ["sm_location_transfer", "sm_location_transfer_d2c7o1jd_sub", "in_transit_detail", "gd_async_job", "gd_publish_step"]
INDEX_TABLES = ["gd_async_job", "gd_publish_step", "sm_location_transfer"]
problems = []


def md5(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()


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


def one(sql):
    rows = q("--dev", sql)
    assert len(rows) == 1, (len(rows), sql[:200])
    return rows[0]


def nodes_of(doc):
    out = {}

    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get("id"), str) and isinstance(o.get("data"), dict) and "type" in o:
                out[o["id"]] = o
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(doc)
    return out


def body(n):
    d = n.get("data") or {}
    return ((d.get("script") or {}).get("code")) if isinstance(d.get("script"), dict) else None


manifest = {"pulled_from": "dev (.dbtools/db --dev, SELECT only)", "files": {}}

# ------------------------------------------------------------------ SM_LOCATION_TRANSFER v82 (enabled)
r = one(f"SELECT CAST(id AS CHAR) AS id, version_number, status, create_time, MD5(script_json) AS md5, script_json FROM su_code_workflow_history "
        f"WHERE data_id = {WF_ID} AND status = 'enabled'")
assert int(r["version_number"]) == 82, r["version_number"]
assert r["md5"] == WF_V82_MD5 and md5(r["script_json"]) == WF_V82_MD5, (r["md5"], md5(r["script_json"]))
raw = r["script_json"]
put("SM_LOCATION_TRANSFER.v82.json", raw)
v82 = json.loads(raw)
put("SM_LOCATION_TRANSFER.v82.pretty.json", json.dumps(v82, ensure_ascii=False, indent=1) + "\n")
live = one(f"SELECT version_number, MD5(script_json) AS md5 FROM su_code_workflow WHERE id = {WF_ID}")
designing = q("--dev", f"SELECT version_number, MD5(script_json) AS md5 FROM su_code_workflow_history WHERE data_id = {WF_ID} AND status = 'designing'")
manifest["files"]["SM_LOCATION_TRANSFER.v82.json"] = {
    "source": "su_code_workflow_history id %s (data_id %d, version 82, status enabled, created %s)" % (r["id"], WF_ID, r["create_time"]),
    "md5": WF_V82_MD5, "chars": len(raw), "su_code_workflow": "version %s md5 %s" % (live["version_number"], live["md5"]),
    "designing_rows": [{"version": d["version_number"], "md5": d["md5"], "same_as_v82": d["md5"] == WF_V82_MD5} for d in designing],
    "pretty_copy": "SM_LOCATION_TRANSFER.v82.pretty.json (json indent=1; for reading only - lift/compare from the raw file)",
}

# v82 vs the prod snapshot of 2026-10-08: node ids, node types, every script body (code / sql)
prod = nodes_of(json.load(open(PROD_FILE, encoding="utf-8")))
dev = nodes_of(v82)
only_dev = sorted(set(dev) - set(prod))
only_prod = sorted(set(prod) - set(dev))
type_diff = sorted(i for i in set(dev) & set(prod) if dev[i]["type"] != prod[i]["type"])
body_diff = sorted(i for i in set(dev) & set(prod) if body(dev[i]) != body(prod[i]))
data_diff = sorted(i for i in set(dev) & set(prod) if json.dumps(dev[i]["data"], sort_keys=True) != json.dumps(prod[i]["data"], sort_keys=True))
with_body = sum(1 for i in dev if body(dev[i]) is not None)
manifest["files"]["SM_LOCATION_TRANSFER.v82.json"]["vs_prod_hotfix_2026_10_08"] = {
    "file": os.path.relpath(PROD_FILE, REPO), "nodes_dev": len(dev), "nodes_prod_file": len(prod), "only_dev": only_dev, "only_prod_file": only_prod,
    "type_differs": type_diff, "script_bodies_compared": with_body, "script_body_differs": body_diff, "node_data_differs": data_diff,
}
print("v82 vs prod file: %d / %d nodes, only dev %s, only prod %s, %d bodies compared, bodies differ %s, node data differs %s" % (
    len(dev), len(prod), only_dev, only_prod, with_body, body_diff, data_diff))
if only_dev or only_prod or type_diff or body_diff:
    problems.append("v82 differs from the prod hotfix file in node ids / types / bodies")

# ------------------------------------------------------------------ LOT form v107 (enabled) + the table schemas
f = one(f"SELECT CAST(id AS CHAR) AS id, version_number, status, create_time, MD5(form_json) AS md5, form_json FROM su_code_tables_history "
        f"WHERE data_id = {LOT_TABLE} AND status = 'enabled'")
assert int(f["version_number"]) == 107, f["version_number"]
assert md5(f["form_json"]) == f["md5"]
put("lot_form_v107.json", f["form_json"])
cur = one(f"SELECT MD5(form_json) AS md5 FROM su_code_tables WHERE id = {LOT_TABLE}")
manifest["files"]["lot_form_v107.json"] = {
    "source": "su_code_tables_history id %s (data_id %d = sm_location_transfer, version 107, status enabled, created %s)" % (f["id"], LOT_TABLE, f["create_time"]),
    "md5": f["md5"], "chars": len(f["form_json"]), "su_code_tables.form_json_same": cur["md5"] == f["md5"],
}
for tid, name in ((LOT_TABLE, "lot_schema_header.json"), (LOT_LINES, "lot_schema_lines.json")):
    s = one(f"SELECT table_name, MD5(schema_json) AS md5, schema_json FROM su_code_tables WHERE id = {tid}")
    put(name, s["schema_json"])
    manifest["files"][name] = {"source": "su_code_tables.schema_json id %d (%s), current" % (tid, s["table_name"]), "md5": s["md5"], "chars": len(s["schema_json"])}

# ------------------------------------------------------------------ LOT list page v47 (enabled) vs the designing v48 row
p = one(f"SELECT CAST(id AS CHAR) AS id, version_number, status, create_time, MD5(page_json) AS md5, page_json FROM su_code_pages_history "
        f"WHERE data_id = {LIST_PAGE} AND status = 'enabled'")
assert int(p["version_number"]) == 47, p["version_number"]
put("lot_list_v47.json", p["page_json"])
d48 = q("--dev", f"SELECT CAST(id AS CHAR) AS id, version_number, status, create_time, MD5(page_json) AS md5, page_json FROM su_code_pages_history "
                 f"WHERE data_id = {LIST_PAGE} AND status = 'designing'")
pc = one(f"SELECT version_number, MD5(page_json) AS md5 FROM su_code_pages WHERE id = {LIST_PAGE}")
entry = {"source": "su_code_pages_history id %s (data_id %d, version 47, status enabled, created %s)" % (p["id"], LIST_PAGE, p["create_time"]),
         "md5": p["md5"], "chars": len(p["page_json"]), "su_code_pages": "version %s md5 %s" % (pc["version_number"], pc["md5"]), "designing": []}
for d in d48:
    same = d["md5"] == p["md5"]
    put("lot_list_v%s_designing.json" % d["version_number"], d["page_json"])
    entry["designing"].append({"id": d["id"], "version": d["version_number"], "created": str(d["create_time"]), "md5": d["md5"], "chars": len(d["page_json"]),
                               "same_as_v47": same, "file": "lot_list_v%s_designing.json (NOT live; someone's draft - not resolved here)" % d["version_number"]})
manifest["files"]["lot_list_v47.json"] = entry

# ------------------------------------------------------------------ the sub-workflows V2 lifts / calls / copies messages from (enabled)
SUBS = [("CHECK_REQUIRED_FIELD", 1988831880511062018, 8, "c3c37c0e255bb39851347b527f7a8199"),
        ("GLOBAL_INVENTORY_VALIDATION", 2056291728334573570, 11, None),
        ("INVENTORY_BULK_APPLY", 2109916822821744641, 7, None)]
for name, wid, ver, want in SUBS:
    w = one(f"SELECT CAST(id AS CHAR) AS id, version_number, MD5(script_json) AS md5, script_json FROM su_code_workflow_history WHERE data_id = {wid} AND status = 'enabled'")
    assert int(w["version_number"]) == ver, (name, w["version_number"])
    assert want is None or w["md5"] == want, (name, w["md5"])
    put("%s.v%d.json" % (name, ver), w["script_json"])
    manifest["files"]["%s.v%d.json" % (name, ver)] = {"source": "su_code_workflow_history id %s (data_id %d, version %d, enabled)" % (w["id"], wid, ver), "md5": w["md5"],
                                                      "chars": len(w["script_json"])}

# ------------------------------------------------------------------ columns + unique indexes
cols = {}
for t in COLUMN_TABLES:
    rows = q("--dev", "SELECT column_name AS name, column_type AS type, is_nullable AS nullable, column_default AS dflt FROM information_schema.columns "
                      f"WHERE table_schema = DATABASE() AND table_name = '{t}' ORDER BY ordinal_position")
    assert rows, t
    cols[t] = [{"name": c["name"], "type": c["type"], "nullable": c["nullable"], "default": c["dflt"]} for c in rows]
idx = {}
for t in INDEX_TABLES:
    rows = q("--dev", "SELECT index_name AS name, non_unique AS nu, seq_in_index AS seq, column_name AS col FROM information_schema.statistics "
                      f"WHERE table_schema = DATABASE() AND table_name = '{t}' ORDER BY index_name, seq_in_index")
    out = {}
    for x in rows:
        if int(x["nu"]) == 0:
            out.setdefault(x["name"], []).append(x["col"])
    idx[t] = out
put("columns.json", json.dumps({"columns": cols, "unique_indexes": idx}, ensure_ascii=False, indent=1) + "\n")
manifest["files"]["columns.json"] = {"source": "information_schema.columns / statistics on dev", "tables": COLUMN_TABLES, "unique_index_tables": INDEX_TABLES}

put("MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=1, default=str) + "\n")
if problems:
    print("PROBLEMS:", problems)
    sys.exit(1)
print("ok")
