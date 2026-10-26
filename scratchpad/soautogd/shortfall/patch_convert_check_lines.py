"""patch_convert_check_lines.py: GD_SO_CONVERT_CHECK - the refused lines of a FAILED GD Created V2 job, for the SO list's
Convert to GD (user 2026-10-26: with auto-create on, LSH sees only "SO/... - auto allocation: Insufficient stock for item X.
Available: A, Requested: R", the first line, in the base unit; show it like the GD form's Insufficient Inventory Alert).

New optional input job_lines ("1", sent by the SO list's follow with job_ids): a fourth parallel read joins each asked FAILED
CREATE_GD_FROM_FORM job's first 10 line errors (error_details, PREPARE's order) to its request_payload line by
stable_line_key, with the item's code and name and the line's unit name; a "unit <id>" in a message is named. job_lines_json
answers [{job_id, line_no, code, message, item_code, item_name, uom, order_qty, undelivered_qty, delivery_qty, base_qty}],
all text, in the line's unit (delivery_qty = gd_qty, the remaining demand; base_qty = the same in the base unit). Without
job_lines the read is an Impossible WHERE (no table touched): the GD form's verdict-wait and the GD list's cancel / revert
follows send job_ids alone and get exactly today's answer plus job_lines_json "[]". Patched in place (keys kept).
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_convert_check_lines.py [--write] [--out FILE]
"""
import copy
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "gdc", "pkv2tools"))
import wfkit as K  # noqa: E402

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")


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


LINE_COLUMNS = ["job_id", "line_no", "code", "message", "item_code", "item_name", "uom", "order_qty", "undelivered_qty",
                "delivery_qty", "base_qty"]

SQL_LINES = """SELECT CAST(j.id AS CHAR) AS job_id,
       IFNULL(e.line_no, '') AS line_no,
       IFNULL(e.code, '') AS code,
       LEFT(IF(u2.id IS NULL, IFNULL(e.message, ''), REPLACE(e.message, CONCAT('unit ', u2.id), CONCAT('unit ', u2.uom_name))), 500) AS message,
       LEFT(IFNULL(i.material_code, IFNULL(p.material_name, '')), 255) AS item_code,
       LEFT(IFNULL(i.material_name, ''), 255) AS item_name,
       IFNULL(u.uom_name, '') AS uom,
       IFNULL(p.order_qty, '') AS order_qty,
       IFNULL(p.undelivered_qty, '') AS undelivered_qty,
       IFNULL(p.delivery_qty, '') AS delivery_qty,
       IFNULL(p.base_qty, '') AS base_qty
  FROM JSON_TABLE('{{node:code_node_SCguard.data.jobIdsJson}}', '$[*]' COLUMNS (jid VARCHAR(20) PATH '$')) t
  JOIN gd_async_job j
    ON j.id = CAST(t.jid AS UNSIGNED)
   AND j.tenant_id = '{{system:tenantId}}'
   AND j.command = 'CREATE_GD_FROM_FORM'
   AND j.job_status = 'FAILED'
   AND j.is_deleted = 0
  JOIN JSON_TABLE(IF(JSON_VALID(j.error_details), j.error_details, '{}'), '$.line_errors[*]' COLUMNS (
         ord FOR ORDINALITY,
         line_no VARCHAR(20) PATH '$.line_no',
         line_key VARCHAR(64) PATH '$.stable_line_key',
         code VARCHAR(64) PATH '$.code',
         message VARCHAR(5000) PATH '$.message')) e
  LEFT JOIN JSON_TABLE(IF(JSON_VALID(j.request_payload), j.request_payload, '{}'), '$.lines[*]' COLUMNS (
         line_key VARCHAR(64) PATH '$.stable_line_key',
         material_id VARCHAR(20) PATH '$.material_id',
         material_name VARCHAR(1000) PATH '$.material_name',
         uom_id VARCHAR(20) PATH '$.good_delivery_uom_id',
         order_qty VARCHAR(40) PATH '$.gd_order_quantity',
         undelivered_qty VARCHAR(40) PATH '$.gd_undelivered_qty',
         delivery_qty VARCHAR(40) PATH '$.gd_qty',
         base_qty VARCHAR(40) PATH '$.base_qty')) p
    ON p.line_key = e.line_key
   AND e.line_key <> ''
  LEFT JOIN item i
    ON i.id = CAST(NULLIF(p.material_id, '') AS UNSIGNED)
  LEFT JOIN unit_of_measurement u
    ON u.id = CAST(NULLIF(p.uom_id, '') AS UNSIGNED)
  LEFT JOIN unit_of_measurement u2
    ON u2.id = CAST(SUBSTRING(REGEXP_SUBSTR(e.message, 'unit [0-9]{6,20}'), 6) AS UNSIGNED)
 WHERE '{{node:code_node_SCguard.data.wantLines}}' = '1'
   AND e.ord <= 10
 ORDER BY j.id, e.ord
 LIMIT 2000"""

GUARD_WANT = (
    "// the SO list's follow also asks for a FAILED job's refused lines (job_lines \"1\"): the read runs only then\n"
    "const wantLines = s([{{workflowparams:job_lines}}][0]) === \"1\" && jobIds.length ? \"1\" : \"0\";\n"
)

RESULT_LINES = r"""// the refused lines of the asked FAILED jobs (job_lines "1"): the first 10 per job, with item, unit and quantities, as text
const jobLines = asList([{{node:sql_node_SClines.data}}][0])
  .filter((r) => r && s(r.job_id))
  .map((r) => ({ job_id: s(r.job_id), line_no: s(r.line_no), code: s(r.code), message: s(r.message), item_code: s(r.item_code), item_name: s(r.item_name),
    uom: s(r.uom), order_qty: s(r.order_qty), undelivered_qty: s(r.undelivered_qty), delivery_qty: s(r.delivery_qty), base_qty: s(r.base_qty) }));
"""

args = sys.argv[1:]
out_path = args[args.index("--out") + 1] if "--out" in args else None
raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
assert "job_lines" not in raw, "already patched"
K._taken |= set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
K._rng.seed(202610261)

# 1. the input and the answer field
req = doc["request_json"]
assert [f["name"] for f in req] == ["so_ids", "job_ids", "run_so_ids", "run_since_s"], [f["name"] for f in req]
f = field_like(req[1], "job_lines")
f["description"] = "\"1\" with job_ids: also answer the refused lines of the FAILED ones (job_lines_json) - the SO list's Convert to GD"
req.append(f)
doc["response_json"].append(field_like(doc["response_json"][-1], "job_lines_json"))

# 2. the guard
guard = find(doc, "code_node_SCguard")["data"]
code = guard["script"]["code"]
code = sub(code, "const jobIds = list([{{workflowparams:job_ids}}][0]);\n",
           "const jobIds = list([{{workflowparams:job_ids}}][0]);\n" + GUARD_WANT, "guard want")
code = sub(code, "runSinceS: String(Math.round(since)), ", "runSinceS: String(Math.round(since)), wantLines: why ? \"0\" : wantLines, ", "guard return")
guard["script"]["code"] = code
names = [r["name"] for r in guard["response_json"]]
at = names.index("runSinceS") + 1
guard["response_json"][at:at] = [field_like(guard["response_json"][names.index("runSinceS")], "wantLines")]

# 3. the read: a fourth parallel branch
par = find(doc, "condition_all_SCreads")
assert [b["id"] for b in par["blocks"]] == ["cai_SCbusy", "cai_SCjobs", "cai_SCrun"], [b["id"] for b in par["blocks"]]
par["data"]["title"] = "Reads in parallel: busy sales orders, asked jobs, the lost convert run, the refused lines of failed jobs"
item = copy.deepcopy(par["blocks"][2])
item["id"] = "cai_SClines"
for k in ("title", "nodeName", "name"):
    item["data"][k] = "Refused lines"
item["blocks"] = [K.sql("sql_node_SClines", "The first 10 refused lines of each asked FAILED GD Created V2 job, with item, unit and quantities (job_lines 1 only)",
                        SQL_LINES, LINE_COLUMNS)]
par["blocks"].append(item)

# 4. the result and both answers
res = find(doc, "code_node_SCresult")["data"]
code = res["script"]["code"]
code = sub(code, "return { code: \"200\", ", RESULT_LINES + "return { code: \"200\", ", "result lines")
code = sub(code, "run_json: JSON.stringify(run) };", "run_json: JSON.stringify(run), job_lines_json: JSON.stringify(jobLines) };", "result return")
code = sub(code, "and the lost convert run (run_json)", "the lost convert run (run_json) and the refused lines (job_lines_json)", "result title")
res["script"]["code"] = code
res["response_json"].append(field_like(res["response_json"][-1], "job_lines_json"))

done = find(doc, "return_node_SCdone")["data"]["response_value"]["list"]
proto = copy.deepcopy(done[-1])
proto.update({"prop": "job_lines_json", "propLabel": "job_lines_json", "value": "{{node:code_node_SCresult.data.job_lines_json}}"})
done.append(proto)
rej = find(doc, "return_node_SCreject")["data"]["response_value"]["list"]
proto = copy.deepcopy(rej[-1])
assert proto["valueType"] == "value"
proto.update({"prop": "job_lines_json", "propLabel": "job_lines_json", "value": "[]"})
rej.append(proto)

out = render(doc)
json.loads(out)
ids = re.findall(r'"id": "([A-Za-z0-9_\-]+)"', out)
assert len(ids) == len(set(ids)), "duplicate node ids"
keys = re.findall(r'"key": "([a-z0-9]{8})"', out)
assert len(keys) == len(set(keys)), "duplicate field keys"
print("GD_SO_CONVERT_CHECK + refused lines: %d chars (was %d)" % (len(out), len(raw)))
if out_path:
    open(out_path, "w", encoding="utf-8").write(out)
    print("wrote", out_path)
if "--write" in args:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
elif not out_path:
    print("ok (dry): pass --write or --out FILE")
