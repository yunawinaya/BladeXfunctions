"""Build SO Save V2 (SUBMIT / WORKER / PREPARE / COMMIT / RUN) and CREDIT_LIMIT_CHECK from their live JSON in base/.

Since 2026-10-27 these workflows are built here, not by the original scripts/build-so-save-v2.mjs. Change base/ and this
file, never a trimmed code node in the designer: it holds only the shared helpers it used when built, and a call to any
other one fails on that path alone. The build refuses a trim that drops a used helper (test/check_free.mjs).

  SO_SAVE_SUBMIT         code_node_SSentry: a SUBMIT of <= SOV2_SMALL_LINES lines answers NOT_ELIGIBLE (SOV2_SMALL) after
                         the BUSY checks, so the form runs classic SO_SAVE (prod 10-27: classic 1.7 s, V2 6.4 s).
  WORKER/PREPARE/COMMIT  the empty default branches the platform's publish refuses, reshaped (SUBMIT's too).
  PREPARE/COMMIT         soCanonText compares a datetime by value: unchanged lines were rewritten for a ".000".
  COMMIT                 sql_node_SCfind / SCfind2: the OR that scanned sales_order, as two indexed UNION branches.
  all five               each code node trimmed to the helpers it uses (shake.mjs); the untrimmed build is in out/preshake/.
  CREDIT_LIMIT_CHECK v15 get_node_GerIauhj (whole customer record, ~480 ms on prod) -> code_node_CLguard + sql_node_CLcust
                         (the 5 columns the check reads, by primary key, the session's tenant) + code_node_CLrow (the
                         get-node's {count, data}); a text total may carry thousands separators.

usage: python3 scratchpad/sosave_perf/build.py      -> scratchpad/sosave_perf/out/*.json
"""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SMALL_LINES = 100


def load(name):
    return json.load(open(os.path.join(HERE, "base", name)))


def save(name, doc):
    with open(os.path.join(HERE, "out", name), "w") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))


def must_replace(text, old, new):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"anchor found {n} times, expected 1:\n{old[:200]}")
    return text.replace(old, new)


def find(nodes, node_id):
    for n in nodes:
        if n["id"] == node_id:
            return n
        hit = find(n.get("blocks") or [], node_id)
        if hit:
            return hit
    return None


def field(key, name, bson="any"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def code_node(node_id, title, code, outputs):
    return {"id": node_id, "type": "code-node", "blocks": [], "data": {
        "language": "javascript", "code": "", "timeout": 30000, "title": title, "isValidator": True, "nodeName": title, "name": title,
        "script": {"type": "javascript", "code": code}, "response_json": outputs}}


# ---- SO_SAVE_SUBMIT: the small-save route in code_node_SSentry's own tail (the shared library copies stay identical)
sub = load("SO_SAVE_SUBMIT.v6.json")
entry = find(sub["nodes"], "code_node_SSentry")
entry["data"]["script"]["code"] = must_replace(
    entry["data"]["script"]["code"],
    """// ---- this node
const res = soSubmitEntry([{{node:code_node_SSguard.data}}][0], [{{node:sql_node_SSfacts.data}}][0]);
""",
    """// ---- this node
const guardIn = [{{node:code_node_SSguard.data}}][0];
const res = soSubmitEntry(guardIn, [{{node:sql_node_SSfacts.data}}][0]);
// A small save goes the classic way: on prod classic SO_SAVE took 1.7 s where V2 took 6.4 s (10-27). Decided here, after
// the BUSY checks, because classic SO_SAVE does not read is_processing.
const SOV2_SMALL_LINES = %d;
if (guardIn.operation === "SUBMIT" && res.route === "GO" && num(guardIn.lineCount) <= SOV2_SMALL_LINES) {
  Object.assign(res, answer("NOT_ELIGIBLE", "300", "SOV2_SMALL", { reason: num(guardIn.lineCount) + " lines: the classic save" }));
}
""" % SMALL_LINES)


# The platform's publish (and doTest) refuses the SO Save V2 workflows as built: "NO: 请配置条件节点条件!". Their empty
# default branches carry condition_type / isValidator / name, which ask the validator for a condition. Give them the shape the
# 80 workflows published through the platform since 10-20 use (GD_EDIT_SUBMIT v14: title, filter, expression,
# displayContent, isDefault). They hold no nodes, so nothing runs differently.
DEFAULT_KEYS = ("title", "filter", "expression", "displayContent", "isDefault")


def reshape_defaults(doc, name, expected):
    found = []
    def walk(nodes):
        for n in nodes:
            d = n.get("data") or {}
            if (n["type"] == "condition-or-node-item" and d.get("isDefault") and not (d.get("filter") or {}).get("list")
                    and not n.get("blocks") and any(k in d for k in ("condition_type", "isValidator", "name", "nodeName"))):
                found.append(n)
            walk(n.get("blocks") or [])
    walk(doc["nodes"])
    if len(found) != expected:
        raise SystemExit(f"expected {expected} refused default branches in {name}, found {len(found)}")
    for n in found:
        n["data"] = {k: n["data"][k] for k in DEFAULT_KEYS if k in n["data"]}


reshape_defaults(sub, "SO_SAVE_SUBMIT", 7)

# ---- SO_SAVE_WORKER / PREPARE / COMMIT: the same reshape, so they can be published
worker = load("SO_SAVE_WORKER.v10.json")
prepare = load("SO_SAVE_PREPARE.v9.json")
commit = load("SO_SAVE_COMMIT.v10.json")
reshape_defaults(worker, "SO_SAVE_WORKER", 6)
reshape_defaults(prepare, "SO_SAVE_PREPARE", 9)
reshape_defaults(commit, "SO_SAVE_COMMIT", 43)

# Change detection: PREPARE compared a stored "2026-10-20 00:00:00" with the computed "2026-10-20 00:00:00.000" as text, so
# nearly every line of an edit was rewritten (204 of 254 prod edit jobs rewrote every line, 10-24..10-27). One copy of the
# rules block per code node; every copy is patched the same way.
CANON_OLD = """  if (typeof v === "object") return "J" + soCanonJsonText(v);
  const t = String(v).trim();
"""
CANON_NEW = """  if (typeof v === "object") return "J" + soCanonJsonText(v);
  const t = String(v).trim();
  // a datetime is one value with or without ".000" or a midnight time ("2026-10-20" = "2026-10-20 00:00:00.000")
  const dt = t.match(/^(\\d{4}-\\d{2}-\\d{2})(?:[ T](\\d{2}:\\d{2}:\\d{2})(?:\\.0+)?)?$/);
  if (dt) return dt[1] + " " + (dt[2] || "00:00:00");
"""


def code_nodes(doc):
    out = []
    def walk(nodes):
        for n in nodes:
            if n["type"] == "code-node":
                out.append(n)
            walk(n.get("blocks") or [])
    walk(doc["nodes"])
    return out


def patch_canon(doc, name, expected):
    hit = 0
    for n in code_nodes(doc):
        code = n["data"]["script"]["code"]
        if "const soCanonText" in code:
            n["data"]["script"]["code"] = must_replace(code, CANON_OLD, CANON_NEW)
            hit += 1
    if hit != expected:
        raise SystemExit(f"{name}: patched soCanonText in {hit} code nodes, expected {expected}")


patch_canon(prepare, "SO_SAVE_PREPARE", 16)
patch_canon(commit, "SO_SAVE_COMMIT", 12)

# COMMIT phase A's lookups of a new SO this job inserted: "so_no = temp OR (a Draft since ...)" read sales_order through
# is_deleted alone (~23.6k rows on prod, ~180 ms, on every run, edits too). Now: nothing for an edit (its temporary number
# names no SO, its draftSince is the sentinel), the unique key for the temporary number, and for the Draft branch an id
# floor 2 days before draftSince (ids are time-ordered snowflakes; draftSince is NOW(3)'s text, read back in the same zone).
LOCK_REF = """(SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '{{node:code_node_SCguard.data.tenantId}}' AND p.is_deleted = 0 AND p.step_name LIKE 'LOCK|%'
           AND p.job_id = (CONCAT('SOS|', CAST(s.id AS CHAR)) COLLATE utf8mb4_general_ci) ORDER BY p.id DESC LIMIT 1) AS lock_ref"""
FIND_SQL = """SELECT CAST(s.id AS CHAR) AS id,
       s.so_no,
       CASE WHEN s.so_no = '{{node:code_node_SCgate.data.tempNo}}' THEN 'TEMP' ELSE 'DRAFT' END AS kind,
       %(lock)s
  FROM sales_order s
 WHERE '{{node:code_node_SCgate.data.isEdit}}' = 'NO'
   AND s.so_no = '{{node:code_node_SCgate.data.tempNo}}'
   AND s.organization_id = '{{node:code_node_SCgate.data.organizationId}}'
   AND s.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND s.is_deleted = 0
UNION
SELECT CAST(s.id AS CHAR) AS id,
       s.so_no,
       CASE WHEN s.so_no = '{{node:code_node_SCgate.data.tempNo}}' THEN 'TEMP' ELSE 'DRAFT' END AS kind,
       %(lock)s
  FROM sales_order s
 WHERE '{{node:code_node_SCgate.data.isEdit}}' = 'NO'
   AND '%(since)s' < '9999'
   AND s.id >= GREATEST(0, UNIX_TIMESTAMP('%(since)s') * 1000 - 1288834974657 - 172800000) * 4194304
   AND s.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND s.is_deleted = 0
   AND s.organization_id = '{{node:code_node_SCgate.data.organizationId}}'
   AND s.so_status = 'Draft'
   AND COALESCE(s.is_processing, 0) = 1
   AND s.create_user = (SELECT j.create_user FROM gd_async_job j WHERE j.tenant_id = '{{node:code_node_SCguard.data.tenantId}}' AND j.id = {{node:code_node_SCgate.data.jobId}})
   AND s.create_time >= '%(since)s'"""
# the live text the rewrite replaces, whole: any other change to it would be lost under the rewrite
OLD_FIND_SQL = """SELECT CAST(s.id AS CHAR) AS id,
       s.so_no,
       CASE WHEN s.so_no = '{{node:code_node_SCgate.data.tempNo}}' THEN 'TEMP' ELSE 'DRAFT' END AS kind,
       %(lock)s
  FROM sales_order s
 WHERE s.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND s.is_deleted = 0
   AND s.organization_id = '{{node:code_node_SCgate.data.organizationId}}'
   AND (s.so_no = '{{node:code_node_SCgate.data.tempNo}}'
        OR (s.so_status = 'Draft'
            AND COALESCE(s.is_processing, 0) = 1
            AND s.create_user = (SELECT j.create_user FROM gd_async_job j WHERE j.tenant_id = '{{node:code_node_SCguard.data.tenantId}}' AND j.id = {{node:code_node_SCgate.data.jobId}})
            AND s.create_time >= '%(since)s'))"""


def set_find_sql(doc, node_id, since):
    n = find(doc["nodes"], node_id)
    if n["data"]["script"]["code"] != OLD_FIND_SQL % {"lock": LOCK_REF, "since": since}:
        raise SystemExit(f"{node_id}: the live SQL is not the text this rewrite replaces: rebuild the rewrite on it")
    n["data"]["script"]["code"] = FIND_SQL % {"lock": LOCK_REF, "since": since}


set_find_sql(commit, "sql_node_SCfind", "{{node:code_node_SCgate.data.draftSince}}")
set_find_sql(commit, "sql_node_SCfind2", "{{node:code_node_SCa.data.draftSince}}")

# ---- Trim: each code node keeps only the shared-library helpers it reaches (shake.mjs). ~99% of the V2 workflows' code
# was copies of the library; the platform loads and stores the whole script on every run. The untrimmed build stays in
# out/preshake/ for the patch-level tests (node_diff, test_canon) and the replay.
V2 = {"SO_SAVE_SUBMIT": sub, "SO_SAVE_WORKER": worker, "SO_SAVE_PREPARE": prepare, "SO_SAVE_COMMIT": commit,
      "SO_SAVE_RUN": load("SO_SAVE_RUN.v4.json")}
os.makedirs(os.path.join(HERE, "out", "preshake"), exist_ok=True)
for name, doc in V2.items():
    pre = os.path.join(HERE, "out", "preshake", name + ".json")
    with open(pre, "w") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    r = subprocess.run(["node", os.path.join(HERE, "shake.mjs"), pre, os.path.join(HERE, "out", name + ".json")], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"shake failed for {name}: {r.stderr[-800:]}")
    print(r.stdout.strip())

# A trimmed node keeps the library's first line, which says every helper is there: say what is
HEADER_OLD = "// SO Save V2 - shared helpers (included at the top of every code node by scripts/build-so-save-v2.mjs)"
HEADER_NEW = ("// SO Save V2 - shared helpers: only the ones this node uses (trimmed by BladeXfunctions"
              " scratchpad/sosave_perf/build.py; the full set is in its out/preshake/)")
for name, expected in (("SO_SAVE_SUBMIT", 11), ("SO_SAVE_WORKER", 14), ("SO_SAVE_PREPARE", 16), ("SO_SAVE_COMMIT", 23), ("SO_SAVE_RUN", 9)):
    untrimmed = {n["id"]: n["data"]["script"]["code"] for n in code_nodes(V2[name])}
    doc = json.load(open(os.path.join(HERE, "out", name + ".json")))
    hit = 0
    for n in code_nodes(doc):
        code = n["data"]["script"]["code"]
        if code != untrimmed[n["id"]] and HEADER_OLD in code:
            n["data"]["script"]["code"] = must_replace(code, HEADER_OLD, HEADER_NEW)
            hit += 1
    if hit != expected:
        raise SystemExit(f"{name}: rewrote the library header in {hit} trimmed code nodes, expected {expected}")
    save(name + ".json", doc)
r = subprocess.run(["node", os.path.join(HERE, "test", "check_free.mjs"), os.path.join(HERE, "out")], capture_output=True, text=True)
if r.returncode:
    raise SystemExit("the trim broke a code node, out/ must not be published:\n" + r.stdout[-1500:] + r.stderr[-500:])
print(r.stdout.strip().splitlines()[-1])

# ---- CREDIT_LIMIT_CHECK: one primary-key read of the columns code_node_F3445jkq uses
cl = load("CREDIT_LIMIT_CHECK.v15.json")
top = cl["nodes"]
ids = [n["id"] for n in top]
if ids != ["start", "get_node_GerIauhj", "if_hL2EnU0g", "return_node_k6IsNbCp", "end"]:
    raise SystemExit(f"unexpected CREDIT_LIMIT_CHECK layout: {ids}")

guard = code_node("code_node_CLguard", "Customer id + tenant for the SQL", """// sql_node_CLcust pastes these in as text: digits only
const rawId = [{{workflowparams:customer_id}}][0];
const rawTenant = [{{system:tenantId}}][0];
const cid = rawId === undefined || rawId === null ? "" : String(rawId).trim();
const tenant = rawTenant === undefined || rawTenant === null ? "" : String(rawTenant).trim();
return {
  customerIdSql: /^[0-9]{1,20}$/.test(cid) ? cid : "0",
  tenantIdSql: /^[0-9]{1,20}$/.test(tenant) ? tenant : "0",
};""", [field("k7cq2mzd", "customerIdSql", "string"), field("t4wn8rbe", "tenantIdSql", "string")])

# the session's tenant only: v15's get-node read a customer of any tenant (a cross-tenant read of credit figures);
# prod had 0 cross-tenant checks in 12,593 (10-13..10-27), so no caller needs it
cust_sql = """SELECT CAST(c.id AS CHAR) AS id,
       c.control_type_list,
       c.outstanding_balance,
       c.overdue_inv_total_amount,
       c.overdue_limit,
       c.customer_credit_limit
  FROM customer c
 WHERE c.id = {{node:code_node_CLguard.data.customerIdSql}}
   AND c.tenant_id = '{{node:code_node_CLguard.data.tenantIdSql}}'
   AND c.is_deleted = 0"""
cust = {"id": "sql_node_CLcust", "type": "sql-node", "blocks": [], "data": {
    "database_id": "", "sql": "", "params": {}, "title": "Get Customer Data", "isValidator": True, "nodeName": "Get Customer Data",
    "name": "Get Customer Data", "script": {"type": "sql", "code": cust_sql},
    "response_json": [field("p2xk9vqa", "id", "string"), field("h6ms3ydu", "control_type_list"), field("b8fj4tlo", "outstanding_balance"),
                      field("w3ne7qkc", "overdue_inv_total_amount"), field("r5gz1xhp", "overdue_limit"), field("m9va6cwe", "customer_credit_limit")]}}

row = code_node("code_node_CLrow", "Customer Data (get-node shape)", """// sql_node_CLcust's row as the get-node returned it: {count, data}, control_type_list parsed (a JSON column may arrive as text)
const rows = [{{node:sql_node_CLcust.data}}][0];
const found = Array.isArray(rows) ? rows : rows ? [rows] : [];
const record = Object.assign({}, found[0] || {});
if (typeof record.control_type_list === "string") {
  try {
    record.control_type_list = JSON.parse(record.control_type_list);
  } catch (e) {
    record.control_type_list = null;
  }
}
return { count: found.length, data: record };""", [field("c1dq5uje", "count"), field("d8lr2wsn", "data")])

cond = top[2]
cond["data"]["expression"]["code"] = must_replace(cond["data"]["expression"]["code"],
                                                  "{{node:get_node_GerIauhj.data.count}}", "{{node:code_node_CLrow.data.count}}")
check = find(top, "code_node_F3445jkq")
check["data"]["script"]["code"] = must_replace(check["data"]["script"]["code"],
                                               "const customerData = {{node:get_node_GerIauhj.data.data}};",
                                               "const customerData = {{node:code_node_CLrow.data.data}};")
# a total sent as text with thousands separators read as its first group ("1,234.50" -> 1) and let the order through
check["data"]["script"]["code"] = must_replace(check["data"]["script"]["code"],
                                               "const sqtTotal = parseFloat({{workflowparams:total}} || 0) || 0;",
                                               'const sqtTotal = parseFloat(String({{workflowparams:total}} || 0).replace(/,/g, "")) || 0;')
cl["nodes"] = [top[0], guard, cust, row, cond, top[3], top[4]]
# `total` stays declared int: the platform passes a fraction through an int param (dev A/B 10-27; 93 prod checks with a
# fractional total kept it, none truncated)
if "get_node_GerIauhj" in json.dumps(cl):
    raise SystemExit("get_node_GerIauhj is still referenced")
save("CREDIT_LIMIT_CHECK.json", cl)
print("built out/: SO_SAVE_SUBMIT, SO_SAVE_WORKER, SO_SAVE_PREPARE, SO_SAVE_COMMIT, SO_SAVE_RUN (trimmed; untrimmed in out/preshake/), CREDIT_LIMIT_CHECK")
