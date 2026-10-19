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
const raw = [{{workflowparams:so_ids}}][0];
const ids = Array.from(new Set((Array.isArray(raw) ? raw : s(raw).split(",")).map(s).filter((x) => x)));
const bad = ids.filter((x) => !/^[0-9]{1,20}$/.test(x));
const why = !ids.length ? "no sales order ids" : bad.length ? "sales order ids must be digits" : ids.length > 500 ? "at most 500 sales orders per check" : "";
return { route: why ? "REJECT" : "GO", soIdsJson: JSON.stringify(why ? [] : ids), count: String(ids.length), code: why ? "400" : "200", message: why };"""

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

RESULT = r"""// GD_SO_CONVERT_CHECK - Result: the busy sales orders as a JSON text (busy_json: [{so_id, job_id, job_status}])
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const rows = [{{node:sql_node_SCbusy.data}}][0];
const seen = {};
const busy = [];
for (const r of (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.so_id))) {
  if (seen[s(r.so_id)]) continue;
  seen[s(r.so_id)] = true;
  busy.push({ so_id: s(r.so_id), job_id: s(r.job_id), job_status: s(r.job_status) });
}
return { code: "200", message: busy.length ? busy.length + " sales order(s) still have a delivery saving in the background" : "", busy_json: JSON.stringify(busy), busy_count: String(busy.length) };"""

FIELDS = ["code", "message", "busy_json", "busy_count"]
ids = K.Ids(1798400000000)
doc = K.workflow(
    [("so_ids", "any", "the sales order ids to convert (a list of digits, or comma-separated)")],
    FIELDS,
    [K.code("code_node_SCguard", "Guard: the sales order ids (digits only, at most 500)", GUARD, ["route", "soIdsJson", "count", "code", "message"]),
     K.if_(ids, "if_SCreject", "IF the input is invalid: answer, read nothing", "'{{node:code_node_SCguard.data.route}}' == 'REJECT'",
           [K.ret("return_node_SCreject", "Return (rejected input)", [("code", "{{node:code_node_SCguard.data.code}}"), ("message", "{{node:code_node_SCguard.data.message}}"),
                                                                       ("busy_json", "[]"), ("busy_count", "0")])]),
     K.sql("sql_node_SCbusy", "Unfinished background saves (CREATE_GD_FROM_FORM) delivering one of the sales orders", SQL, ["so_id", "job_id", "job_status"]),
     K.code("code_node_SCresult", "Result: the busy sales orders", RESULT, FIELDS),
     K.ret("return_node_SCdone", "Return", [(f, "{{node:code_node_SCresult.data.%s}}" % f) for f in FIELDS])])
# a literal answer value on the reject return (not a field reference)
for item in doc["nodes"][2]["blocks"][0]["blocks"][0]["data"]["response_value"]["list"]:
    if item["prop"] in ("busy_json", "busy_count"):
        item["valueType"] = "value"

compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
out = subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout
print("GD_SO_CONVERT_CHECK: %d chars" % len(out))
if "--write" in sys.argv:
    open(OUT, "w", encoding="utf-8").write(out)
    print("wrote", OUT)
