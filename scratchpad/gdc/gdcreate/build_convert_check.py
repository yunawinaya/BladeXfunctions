"""build_convert_check.py: GD_SO_CONVERT_CHECK (read-only), called by the SO list's Convert to GD before converting. It answers
which of the selected sales orders still have a delivery saving in the background (an unfinished CREATE_GD_FROM_FORM save,
the statuses GD_ASYNC_SUBMIT's same sales order guard refuses on), so the list does not convert them again.

usage: python3 build_convert_check.py [--write]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

OUT = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")

GUARD = r"""// GD_SO_CONVERT_CHECK - Guard: the sales orders to convert (digits only, at most 500) as a JSON list for the read
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (raw) => Array.from(new Set((Array.isArray(raw) ? raw : s(raw).split(",")).map(s).filter((x) => x)));
const ids = list([{{workflowparams:so_ids}}][0]);
// SO_AUTO_GD's V2 deliveries: the SO list follows its queued jobs by id
const jobIds = list([{{workflowparams:job_ids}}][0]);
const bad = ids.concat(jobIds).filter((x) => !/^[0-9]{1,20}$/.test(x));
const why = !ids.length && !jobIds.length ? "no sales order ids or job ids" : bad.length ? "ids must be digits" : ids.length > 500 ? "at most 500 sales orders per check" : jobIds.length > 200 ? "at most 200 jobs per check" : "";
return { route: why ? "REJECT" : "GO", soIdsJson: JSON.stringify(why ? [] : ids), jobIdsJson: JSON.stringify(why ? [] : jobIds), count: String(ids.length), code: why ? "400" : "200", message: why };"""

SQL = """SELECT t.sid AS so_id,
       CAST(j.id AS CHAR) AS job_id,
       j.job_status
  FROM JSON_TABLE('{{node:code_node_SCguard.data.soIdsJson}}', '$[*]' COLUMNS (sid VARCHAR(20) PATH '$')) t
  JOIN gd_async_job j
    ON j.tenant_id = '{{system:tenantId}}'
   AND j.command = 'CREATE_GD_FROM_FORM'
   AND j.is_deleted = 0
   AND j.job_status IN ('QUEUED', 'VALIDATING', 'CALCULATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'RECONCILING_GD', 'REQUIRES_REVIEW')
   AND j.source_so_ids LIKE CONCAT('%"', t.sid, '"%') COLLATE utf8mb4_general_ci
 ORDER BY t.sid, j.id
 LIMIT 500"""

SQL_JOBS = """SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       IFNULL(j.gd_no, '') AS gd_no,
       IFNULL(j.error_code, '') AS error_code,
       LEFT(IFNULL(j.error_message, ''), 500) AS error_message,
       j.command,
       LEFT(IFNULL(j.progress_message, ''), 250) AS progress_message
  FROM JSON_TABLE('{{node:code_node_SCguard.data.jobIdsJson}}', '$[*]' COLUMNS (jid VARCHAR(20) PATH '$')) t
  JOIN gd_async_job j
    ON j.id = CAST(t.jid AS UNSIGNED)
   AND j.tenant_id = '{{system:tenantId}}'
   AND j.command IN ('CREATE_GD_FROM_FORM', 'CANCEL_GD')
   AND j.is_deleted = 0
 LIMIT 200"""

RESULT = r"""// GD_SO_CONVERT_CHECK - Result: the busy sales orders (busy_json: [{so_id, job_id, job_status}]) and the asked jobs (jobs_json)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const asList = (rows) => (Array.isArray(rows) ? rows : rows ? [rows] : []);
const seen = {};
const busy = [];
for (const r of asList([{{node:sql_node_SCbusy.data}}][0]).filter((r) => r && s(r.so_id))) {
  if (seen[s(r.so_id)]) continue;
  seen[s(r.so_id)] = true;
  busy.push({ so_id: s(r.so_id), job_id: s(r.job_id), job_status: s(r.job_status) });
}
const jobs = asList([{{node:sql_node_SCjobs.data}}][0])
  .filter((r) => r && s(r.job_id))
  .map((r) => ({ job_id: s(r.job_id), job_status: s(r.job_status), gd_no: s(r.gd_no), error_code: s(r.error_code), error_message: s(r.error_message), command: s(r.command),
    progress_message: s(r.progress_message) }));
return { code: "200", message: busy.length ? busy.length + " sales order(s) still have a delivery saving in the background" : "", busy_json: JSON.stringify(busy), busy_count: String(busy.length),
  jobs_json: JSON.stringify(jobs), jobs_count: String(jobs.length) };"""

FIELDS = ["code", "message", "busy_json", "busy_count", "jobs_json", "jobs_count"]
ids = K.Ids(1798400000000)
doc = K.workflow(
    [("so_ids", "any", "the sales order ids to convert (a list of digits, or comma-separated)"),
     ("job_ids", "any", "GD Created V2 (CREATE_GD_FROM_FORM) or GD Cancel V2 (CANCEL_GD) jobs to report on (a list of digits, or comma-separated)")],
    FIELDS,
    [K.code("code_node_SCguard", "Guard: the sales order ids (at most 500) and job ids (at most 200), digits only", GUARD,
            ["route", "soIdsJson", "jobIdsJson", "count", "code", "message"]),
     K.if_(ids, "if_SCreject", "IF the input is invalid: answer, read nothing", "'{{node:code_node_SCguard.data.route}}' == 'REJECT'",
           [K.ret("return_node_SCreject", "Return (rejected input)", [("code", "{{node:code_node_SCguard.data.code}}"), ("message", "{{node:code_node_SCguard.data.message}}"),
                                                                       ("busy_json", "[]"), ("busy_count", "0"), ("jobs_json", "[]"), ("jobs_count", "0")])]),
     K.parallel("condition_all_SCreads", "Reads in parallel: busy sales orders, asked jobs", [
         ("cai_SCbusy", "Busy sales orders", [K.sql("sql_node_SCbusy", "Unfinished background saves (CREATE_GD_FROM_FORM) delivering one of the sales orders", SQL,
                                                    ["so_id", "job_id", "job_status"])]),
         ("cai_SCjobs", "Asked jobs", [K.sql("sql_node_SCjobs", "The asked GD Created V2 / GD Cancel V2 jobs (tenant-scoped): status, delivery number, error, progress", SQL_JOBS,
                                             ["job_id", "job_status", "gd_no", "error_code", "error_message", "command", "progress_message"])])]),
     K.code("code_node_SCresult", "Result: the busy sales orders and the asked jobs", RESULT, FIELDS),
     K.ret("return_node_SCdone", "Return", [(f, "{{node:code_node_SCresult.data.%s}}" % f) for f in FIELDS])])
# a literal answer value on the reject return (not a field reference)
for item in doc["nodes"][2]["blocks"][0]["blocks"][0]["data"]["response_value"]["list"]:
    if item["prop"] in ("busy_json", "busy_count", "jobs_json", "jobs_count"):
        item["valueType"] = "value"

compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
out = subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout
print("GD_SO_CONVERT_CHECK: %d chars" % len(out))
if "--write" in sys.argv:
    open(OUT, "w", encoding="utf-8").write(out)
    print("wrote", OUT)
