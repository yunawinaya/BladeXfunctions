"""patch_convert_check_run.py: GD_SO_CONVERT_CHECK - the SO list's Convert to GD recovers a batch whose answer it lost (user
2026-10-23: LSH's SO_AUTO_GD run for 4 sales orders took 90 s - two went to the classic save - the list's request gave up and
it reported "No answer from the server" for all 4, although all 4 were converted).

New optional inputs run_so_ids (the batch's sales orders) and run_since_s (seconds since the list sent it): a third parallel
read finds the newest SO_AUTO_GD run of the tenant with exactly those sales orders, started in that window, and run_json
answers {run_id, status, result, error} - result is the run's own answer (created / blocked / queued). The run record is
written when the run ends, so run_json is "null" while it still runs. Workflow ids are the same on dev and prod.
Backward compatible: so_ids / job_ids callers get the same fields, plus run_json "null". Patched in place (keys kept).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_convert_check_run.py [--write]
"""
import copy
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
SO_AUTO_GD_ID = "2076557490389835777"


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r
    return None


def sub(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def field_like(proto, name):
    f = copy.deepcopy(proto)
    f.update({"key": K.key(), "name": name, "title": name, "description": ""})
    return f


SQL_RUN = """SELECT CAST(i.id AS CHAR) AS run_id,
       i.status,
       LEFT(IFNULL(i.request_json_data, ''), 20000) AS request,
       LEFT(IFNULL(i.response_json_data, ''), 60000) AS response,
       LEFT(IFNULL(i.error_msg, ''), 500) AS error_msg
  FROM su_code_workflow_inst i
 WHERE {{node:code_node_SCguard.data.runSoId}} <> 0
   AND i.workflow_id = %s
   AND i.tenant_id = '{{system:tenantId}}'
   AND i.is_deleted = 0
   AND i.create_time >= CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') - INTERVAL {{node:code_node_SCguard.data.runSinceS}} SECOND
   AND i.request_json_data LIKE '%%"{{node:code_node_SCguard.data.runSoId}}"%%'
 ORDER BY i.id DESC
 LIMIT 5""" % SO_AUTO_GD_ID

RUN_PICK = r"""// the convert run the SO list lost the answer of: the newest run with exactly the asked sales orders (run_json "null" while it runs)
const want = JSON.parse([{{node:code_node_SCguard.data.runIdsJson}}][0] || "[]");
let run = null;
for (const r of asList([{{node:sql_node_SCrun.data}}][0]).filter((r) => r && s(r.run_id))) {
  let req = {};
  try {
    const o = JSON.parse(s(r.request));
    req = (o && o.request_json) || o || {};
  } catch (e) {
    req = {};
  }
  const got = Array.from(new Set((Array.isArray(req.so_ids) ? req.so_ids : []).map(s)));
  if (got.length !== want.length || want.some((x) => got.indexOf(x) < 0)) continue;
  let result = null;
  try {
    const o = JSON.parse(s(r.response));
    result = o && o.data && typeof o.data === "object" ? o.data : null;
  } catch (e) {
    result = null;
  }
  run = { run_id: s(r.run_id), status: s(r.status), result: result, error: s(r.error_msg) };
  break;
}
"""

raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert "run_so_ids" not in raw, "already patched"
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610237)

# 1. inputs and the answer field
req = doc["request_json"]
assert [f["name"] for f in req] == ["so_ids", "job_ids"]
f = field_like(req[1], "run_so_ids")
f["description"] = "a convert batch whose answer the SO list lost: its sales order ids (a list of digits, or comma-separated)"
req.append(f)
f = field_like(req[1], "run_since_s")
f["description"] = "seconds since the SO list sent that batch (1 to 3600, default 600): the run started at most this long ago"
req.append(f)
doc["response_json"].append(field_like(doc["response_json"][-1], "run_json"))

# 2. the guard
guard = find(doc, "code_node_SCguard")["data"]
code = guard["script"]["code"]
code = sub(code, "const jobIds = list([{{workflowparams:job_ids}}][0]);\n",
           "const jobIds = list([{{workflowparams:job_ids}}][0]);\n"
           "// a convert batch whose answer the SO list lost: its SO_AUTO_GD run (the batch's sales orders, started at most run_since_s ago)\n"
           "const runIds = list([{{workflowparams:run_so_ids}}][0]);\n"
           "const since = Number(s([{{workflowparams:run_since_s}}][0]) || 600);\n", "guard inputs")
code = sub(code, "const bad = ids.concat(jobIds).filter(", "const bad = ids.concat(jobIds, runIds).filter(", "guard bad")
code = sub(code, 'const why = !ids.length && !jobIds.length ? "no sales order ids or job ids" : ',
           'const why = !ids.length && !jobIds.length && !runIds.length ? "no sales order ids, job ids or convert run" : ', "guard why empty")
code = sub(code, 'jobIds.length > 200 ? "at most 200 jobs per check" : "";',
           'jobIds.length > 200 ? "at most 200 jobs per check" : runIds.length > 50 ? "at most 50 sales orders per convert run" : !(since >= 1 && since <= 3600) ? "run_since_s: 1 to 3600 seconds" : "";', "guard why limits")
code = sub(code, "jobIdsJson: JSON.stringify(why ? [] : jobIds), ",
           "jobIdsJson: JSON.stringify(why ? [] : jobIds), runSoId: why || !runIds.length ? \"0\" : runIds[0], runIdsJson: JSON.stringify(why ? [] : runIds), runSinceS: String(Math.round(since)), ", "guard return")
guard["script"]["code"] = code
names = [r["name"] for r in guard["response_json"]]
at = names.index("jobIdsJson") + 1
guard["response_json"][at:at] = [field_like(guard["response_json"][names.index("jobIdsJson")], n) for n in ("runSoId", "runIdsJson", "runSinceS")]

# 3. the read: a third parallel branch
par = find(doc, "condition_all_SCreads")
assert [b["id"] for b in par["blocks"]] == ["cai_SCbusy", "cai_SCjobs"]
par["data"]["title"] = "Reads in parallel: busy sales orders, asked jobs, the lost convert run"
item = copy.deepcopy(par["blocks"][1])
item["id"] = "cai_SCrun"
for k in ("title", "nodeName", "name"):
    item["data"][k] = "The lost convert run"
item["blocks"] = [K.sql("sql_node_SCrun", "The SO_AUTO_GD run of a batch whose answer the SO list lost (newest first, its sales orders checked by the result)", SQL_RUN,
                        ["run_id", "status", "request", "response", "error_msg"])]
par["blocks"].append(item)

# 4. the result and both answers
res = find(doc, "code_node_SCresult")["data"]
code = res["script"]["code"]
code = sub(code, "return { code: \"200\", ", RUN_PICK + "return { code: \"200\", ", "result run")
code = sub(code, "jobs_json: JSON.stringify(jobs), jobs_count: String(jobs.length) };",
           "jobs_json: JSON.stringify(jobs), jobs_count: String(jobs.length), run_json: JSON.stringify(run) };", "result return")
code = sub(code, "and the asked jobs (jobs_json)", "the asked jobs (jobs_json) and the lost convert run (run_json)", "result title")
res["script"]["code"] = code
res["response_json"].append(field_like(res["response_json"][-1], "run_json"))

done = find(doc, "return_node_SCdone")["data"]["response_value"]["list"]
proto = copy.deepcopy(done[-1])
proto.update({"prop": "run_json", "propLabel": "run_json", "value": "{{node:code_node_SCresult.data.run_json}}"})
done.append(proto)
rej = find(doc, "return_node_SCreject")["data"]["response_value"]["list"]
proto = copy.deepcopy(rej[-1])
assert proto["valueType"] == "value"
proto.update({"prop": "run_json", "propLabel": "run_json", "value": "null"})
rej.append(proto)

out = render(doc)
json.loads(out)
ids = re.findall(r'"id": "([A-Za-z0-9_\-]+)"', out)
assert len(ids) == len(set(ids)), "duplicate node ids"
print("GD_SO_CONVERT_CHECK + lost convert run: %d chars (was %d)" % (len(out), len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
