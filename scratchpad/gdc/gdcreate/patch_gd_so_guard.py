"""patch_gd_so_guard.py [--write]: GOODS_DELIVERY (the classic save, repo Goods Delivery/GDheadWorkflow.json) refuses a NEW
delivery for a sales order while a GD Created V2 save of the same sales order is unfinished.

"New delivery" = saveAs Created / Completed and the GD is new (Add / Clone) or stored as Draft (an Edit of a stored
Created GD - Picking / Packing completion, SO cascade - is never refused). Unfinished = a CREATE_GD_FROM_FORM job in
QUEUED / VALIDATING / CALCULATING / READY_TO_COMMIT / COMMITTING_GD / RECONCILING_GD / REQUIRES_REVIEW, the statuses
GD_ASYNC_SUBMIT's own same-SO guard refuses on: until its last commit step the job's quantities are not on the sales
order, so this save's own quantity check cannot see them. Covers the desktop saves V2 does not take, mobile and
SO_AUTO_GD (it calls GOODS_DELIVERY and reports a non-200 per sales order as not converted).

A new block right after the Processing guard (if_GdProcGuard), before any read or write of the save: code -> IF YES ->
sql (stored status + first unfinished job) -> code -> IF busy -> return 400 + message. The block is generated from the
Processing guard's own node layout. Text-level insert (the file does not round-trip json.dumps). Dry run unless --write."""
import copy
import json
import re
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDheadWorkflow.json"
raw = open(P, encoding="utf-8").read()
W = json.loads(raw)

GUARD = r"""// A new delivery (an Add, or a stored Draft saved as Created / Completed) waits while a GD Created V2 save of one of its sales orders is unfinished
const saveAs = String([{{workflowparams:saveAs}}][0] || "");
const allData = [{{workflowparams:allData}}][0] || {};
const idOf = (v) => { const s = String(v == null ? "" : v).trim(); return /^[0-9]{1,20}$/.test(s) ? s : ""; };
const soIds = [];
const addSo = (v) => (Array.isArray(v) ? v : String(v == null ? "" : v).split(",")).forEach((x) => { const id = idOf(x); if (id && soIds.indexOf(id) < 0) soIds.push(id); });
addSo(allData.so_id);
for (const row of Array.isArray(allData.table_gd) ? allData.table_gd : []) {
  if (!row) continue;
  addSo(row.line_so_id);
  for (const child of Array.isArray(row.children) ? row.children : []) if (child) addSo(child.line_so_id);
}
const org = idOf(allData.organization_id);
return {
  check: (saveAs === "Created" || saveAs === "Completed") && soIds.length > 0 ? "YES" : "NO",
  gdId: idOf(allData.id) || "0",
  scopeSql: org ? "j.organization_id = '" + org + "'" : "1 = 1",
  soLikeSql: soIds.length ? "(" + soIds.slice(0, 500).map((id) => "j.source_so_ids LIKE '%\"" + id + "\"%'").join(" OR ") + ")" : "1 = 0",
};"""

SQL = """SELECT (SELECT g.gd_status
          FROM goods_delivery g
         WHERE g.id = {{node:code_node_GdSoGuard.data.gdId}}
           AND g.is_deleted = 0) AS stored_status,
       (SELECT CONCAT(j.job_status, '|', CAST(j.id AS CHAR), '|', COALESCE(j.source_so_no, ''))
          FROM gd_async_job j
         WHERE {{node:code_node_GdSoGuard.data.scopeSql}}
           AND j.command = 'CREATE_GD_FROM_FORM'
           AND j.is_deleted = 0
           AND j.job_status IN ('QUEUED', 'VALIDATING', 'CALCULATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'RECONCILING_GD', 'REQUIRES_REVIEW')
           AND {{node:code_node_GdSoGuard.data.soLikeSql}}
         ORDER BY j.id
         LIMIT 1) AS busy_job"""

BUSY = r"""// refused: a stored Created GD is never a new delivery; REQUIRES_REVIEW never ends by itself: say so
const row = (([{{node:sql_node_GdSoGuard.data}}][0]) || [])[0] || {};
const job = String(row.busy_job || "").split("|");
const status = job[0] || "";
const stored = String(row.stored_status == null ? "" : row.stored_status);
const fresh = String([{{workflowparams:pageStatus}}][0] || "") !== "Edit" || stored === "" || stored === "Draft";
const so = job.slice(2).join("|") || "this sales order";
const message = status === "REQUIRES_REVIEW"
  ? "A background save of a delivery for " + so + " stopped half-way and is under review (job " + job[1] + "): please contact support before delivering it again."
  : "A delivery for " + so + " is still being saved in the background (job " + job[1] + ", " + status + "). Wait for it to finish - it then appears in the Goods Delivery list - before saving another delivery for it.";
return { busy: status !== "" && fresh ? "YES" : "NO", message: message };"""


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def span(text, nid):
    """[start, end) of the object whose "id" is nid, in the file's text (string-aware brace match)"""
    i = text.index('"id": "%s"' % nid)
    start = text.rfind("{", 0, i)
    depth, j, in_str = 0, start, False
    while True:
        c = text[j]
        if in_str:
            if c == "\\":
                j += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return start, j + 1
        j += 1


def dump(o, indent):
    text = json.dumps(o, indent=2, ensure_ascii=False)
    text = re.sub(r'\{\n\s*"title": "(true|false)"\n\s*\}', r'{ "title": "\1" }', text)
    return text.replace("\n", "\n" + " " * indent)


# the file's style for a top-level node = json.dumps(indent=2) at a 4-space offset (checked on the blocks cloned)
for nid in ("code_node_GdProcGuard", "if_GdProcGuard"):
    a, b = span(raw, nid)
    assert raw[a:b] == dump(find(W, nid), 4), nid + ": the file's layout is not json.dumps(indent=2)"
assert "GdSoGuard" not in raw, "already patched"

keys = set(re.findall(r'"key": "([A-Za-z0-9]{8})"', raw))
fresh_keys = (k for k in ("gdso%04d" % n for n in range(10000)) if k not in keys)
nums = set(int(x) for x in re.findall(r'"(?:id|parentId)": (\d{9,})', raw))
fresh_nums = (n for n in range(2111300000001, 2111300009999) if n not in nums)


def outputs(node, names, types=None):
    tpl = node["data"]["response_json"][0]
    node["data"]["response_json"] = [dict(copy.deepcopy(tpl), key=next(fresh_keys), name=n, title=n, bsonType=(types or {}).get(n, "string")) for n in names]


def titled(node, title):
    for k in ("title", "nodeName", "name"):
        node["data"][k] = title


def renumber(node):
    for leaf in node["data"]["filter"]["list"]:
        leaf["id"], leaf["parentId"] = next(fresh_nums), next(fresh_nums)


code_guard = copy.deepcopy(find(W, "code_node_GdProcGuard"))
code_guard["id"] = "code_node_GdSoGuard"
titled(code_guard, "SO Guard: a new delivery for a sales order?")
code_guard["data"]["script"]["code"] = GUARD
outputs(code_guard, ["check", "gdId", "scopeSql", "soLikeSql"])

if_guard = copy.deepcopy(find(W, "if_GdProcGuard"))
if_guard["id"] = "if_GdSoGuard"
titled(if_guard, "IF a new delivery (Created / Completed)")
if_guard["data"]["expression"]["code"] = "'{{node:code_node_GdSoGuard.data.check}}' == 'YES'"
renumber(if_guard)
t_block, f_block = if_guard["blocks"]
assert [b["id"] for b in t_block["blocks"]] == ["sql_node_GdProcGuard", "code_node_GdProcBusy", "if_GdProcBusy"] and f_block["blocks"] == []
t_block["id"], f_block["id"] = "ifBlock_TGdSoGuard", "ifBlock_FGdSoGuard"
sql, busy, if_busy = t_block["blocks"]
sql["id"] = "sql_node_GdSoGuard"
titled(sql, "SO Guard: unfinished background save of these sales orders")
sql["data"]["script"]["code"] = SQL
outputs(sql, ["stored_status", "busy_job"])
busy["id"] = "code_node_GdSoBusy"
titled(busy, "SO Guard: refuse?")
busy["data"]["script"]["code"] = BUSY
outputs(busy, ["busy", "message"])
if_busy["id"] = "if_GdSoBusy"
titled(if_busy, "IF a background save holds the sales order")
if_busy["data"]["expression"]["code"] = "'{{node:code_node_GdSoBusy.data.busy}}' == 'YES'"
renumber(if_busy)
bt, bf = if_busy["blocks"]
assert [b["id"] for b in bt["blocks"]] == ["return_node_GdProcBusy"] and bf["blocks"] == []
bt["id"], bf["id"] = "ifBlock_TGdSoBusy", "ifBlock_FGdSoBusy"
ret = bt["blocks"][0]
ret["id"] = "return_node_GdSoBusy"
titled(ret, "Return SO Busy")
msg = [x for x in ret["data"]["response_value"]["list"] if x["prop"] == "message"]
code = [x for x in ret["data"]["response_value"]["list"] if x["prop"] == "code"]
assert len(msg) == 1 and len(code) == 1 and code[0]["value"] == "400"
msg[0]["value"] = "{{node:code_node_GdSoBusy.data.message}}"

block = ",\n    " + dump(code_guard, 4) + ",\n    " + dump(if_guard, 4)
_, end = span(raw, "if_GdProcGuard")
raw = raw[:end] + block + raw[end:]

W2 = json.loads(raw)
order = [n["id"] for n in W2["nodes"]]
assert order[:6] == ["start", "code_node_GdProcGuard", "if_GdProcGuard", "code_node_GdSoGuard", "if_GdSoGuard", "if_gr_gate_completed"], order[:6]
ids = re.findall(r'"id": "([A-Za-z0-9_\-]+)"', raw)
assert len(ids) == len(set(ids)), "duplicate node ids"
new_keys = re.findall(r'"key": "(gdso\d{4})"', block)
assert len(new_keys) == 8 and not set(new_keys) & keys, new_keys
print("ok: block inserted after if_GdProcGuard; %d nodes in the file, ids unique; top-level order %s" % (len(ids), order[:6]))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(raw)
    print("written", P)
else:
    print("dry run: pass --write")
