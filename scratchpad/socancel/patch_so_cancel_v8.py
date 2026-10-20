"""patch_so_cancel_v8.py [--write]: SO_CANCEL (Bulk Actions/Sales & Distribution/Sales Order/SOcancelWorkflow.json, dev + prod v7)
refuses to cancel a sales order while GD V2 work is in flight on it, before any write:
- a delivery of the sales order is Processing (a GD Created / Edit / Completed / Cancel V2 job holds it);
- an unfinished background save of a new delivery names the sales order (CREATE_GD_FROM_FORM, from the GD form or SO_AUTO_GD; the
  same statuses GD_SO_CONVERT_CHECK counts as busy), which has no goods_delivery row to find yet.
One more branch in the Parallel Fetch reads those jobs (the id made digits-only first, the SQL is raw text); Classify answers 400 with
the reason. Needs the V2 job table (gd_async_job): on prod it arrives with the full deployment, so never paste this version on its own.
Formatting: prettier (reproduces the committed file byte for byte)."""
import json
import os
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
FILE = R + "Bulk Actions/Sales & Distribution/Sales Order/SOcancelWorkflow.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")

SOID = r"""// SO_CANCEL - the sales order id, digits only, for the background-save read (the SQL is raw text)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const raw = [{{workflowparams:so_id}}][0];
const id = s(Array.isArray(raw) ? raw[0] : raw);
return { soIdSql: /^[0-9]{1,20}$/.test(id) ? id : "0" };"""

JOBS = """SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status
  FROM gd_async_job j
 WHERE j.job_status IN ('QUEUED', 'VALIDATING', 'CALCULATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'RECONCILING_GD', 'REQUIRES_REVIEW')
   AND j.tenant_id = '{{system:tenantId}}'
   AND j.command = 'CREATE_GD_FROM_FORM'
   AND j.is_deleted = 0
   AND j.source_so_ids LIKE '%"{{node:code_node_SXsoid.data.soIdSql}}"%'
 LIMIT 20"""

OLD_HEAD = """const gdList = {{node:search_gd.data.data}} || [];
const ppList = {{node:search_pp.data.data}} || [];
const siList = {{node:search_si.data.data}} || [];
"""
NEW_HEAD = """const gdList = {{node:search_gd.data.data}} || [];
const ppList = {{node:search_pp.data.data}} || [];
const siList = {{node:search_si.data.data}} || [];
const jobRows = [{{node:sql_node_SXjobs.data}}][0];
// GD V2 work in flight on this SO: a delivery in Processing, or a new delivery still saving in the background
const busyGd = gdList.filter((d) => d.gd_status === "Processing");
const busyJobs = (Array.isArray(jobRows) ? jobRows : jobRows ? [jobRows] : []).filter((r) => r && r.job_id);
"""
OLD_IF = """if (createdGd.length > 0 || createdPp.length > 0) {"""
NEW_IF = """if (busyGd.length > 0 || busyJobs.length > 0) {
  code = "400";
  message = busyGd.length > 0
    ? "Goods delivery " + busyGd.map((d) => d.delivery_no).join(", ") + " is being processed in the background. Try again when it finishes."
    : "A goods delivery for this sales order is still being saved in the background. Try again when it finishes.";
} else if (createdGd.length > 0 || createdPp.length > 0) {"""


def field(key, name, bson="string"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False}


def patch(d):
    nodes = d["nodes"]
    pf = next(n for n in nodes if n["id"] == "parallel_fetch")
    if any(b["id"] == "cai_jobs" for b in pf["blocks"]):
        raise SystemExit("already patched (cai_jobs exists)")
    code_soid = {"id": "code_node_SXsoid", "type": "code-node",
                 "data": {"language": "javascript", "code": "", "timeout": 30000, "title": "SO ID (digits)", "isValidator": True,
                          "nodeName": "SO ID (digits)", "name": "SO ID (digits)", "response_json": [field("wf_soidsql", "soIdSql")],
                          "script": {"type": "javascript", "code": SOID}},
                 "blocks": []}
    sql_jobs = {"id": "sql_node_SXjobs", "type": "sql-node",
                "data": {"database_id": "", "sql": "", "params": {}, "title": "Get Unfinished GD Saves", "isValidator": True,
                         "nodeName": "Get Unfinished GD Saves", "name": "Get Unfinished GD Saves", "script": {"type": "sql", "code": JOBS},
                         "response_json": [dict(field("wf_jobid", "job_id"), children=[]), dict(field("wf_jobstatus", "job_status"), children=[])]},
                "blocks": []}
    item = {"id": "cai_jobs", "type": "condition-all-node-item",
            "data": {"title": "GD Jobs", "filter": {"list": [{"id": 1783100000361, "parentId": 1783100000360, "isTop": True, "prop": "", "operator": "",
                                                              "valueType": "", "value": "", "type": "leaf", "level": 1}]},
                     "expression": {"code": ""}, "displayContent": "sdk.form.setCondition", "isValidator": True, "nodeName": "GD Jobs", "name": "GD Jobs",
                     "condition_type": "ConditionRule"},
            "blocks": [code_soid, sql_jobs]}
    pf["blocks"].append(item)
    cc = next(n for n in nodes if n["id"] == "code_classify")
    code = cc["data"]["script"]["code"]
    for a, b in ((OLD_HEAD, NEW_HEAD), (OLD_IF, NEW_IF)):
        assert code.count(a) == 1, "Classify is not the v7 text: " + a[:50]
        code = code.replace(a, b)
    cc["data"]["script"]["code"] = code
    return d


def pretty(d):
    compact = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


if __name__ == "__main__":
    raw = open(FILE, encoding="utf-8").read()
    d = json.loads(raw)
    assert pretty(d) == raw, "the file is not in prettier form: patch would reformat it"
    out = pretty(patch(d))
    print("SO_CANCEL: %d -> %d chars" % (len(raw), len(out)))
    if "--write" in sys.argv:
        open(FILE, "w", encoding="utf-8").write(out)
        print("wrote", FILE)
