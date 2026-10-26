"""patch_commit_hdr.py <base.json> <out.json>: PICKING_BULK_COMMIT, phase B re-checks the Picking header before P5 (raw-text
insertion, the file's own formatting kept; every step asserted).
Why: two confirms of one Picking that commit within milliseconds each roll the header up in P1 from their own view (the
other's rows still open), so both can write In Progress over rows that are all Completed. LSH PI-2610-3697, 10-26 10:02:
jobs 2114538217914109954 (2 rows) and 2114538217968635905 (3 rows), both "Picking In Progress". The header then stays In
Progress for good (a new confirm is refused: nothing left to pick), and the P5 gate fills the Packing only for a Completed
Picking.
What: a new block before if_PCp5, run in phase B only (a separate run, after phase A committed): sql_node_PCbhdr reads the
stored header and rows, code_node_PCbhdr applies P1's rule (every non-cancelled row Completed) and only ever promotes,
update_node_PCbhdr writes to_status Completed. The last job to reach phase B sees every earlier phase A."""
import copy
import json
import random
import re
import sys

base, out = sys.argv[1:3]
t = open(base, encoding="utf-8").read()
w = json.loads(t)


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


assert "PCbhdr" not in t, "already patched"
taken = set(re.findall(r'"key": "([a-z0-9]{8})"', t))
rng = random.Random("lsh-picking-header-20261026")


def key():
    while True:
        k = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))
        if k not in taken:
            taken.add(k)
            return k


def field(name, bson="string", items=False):
    f = {"key": key(), "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": items, "children": []}
    if items:
        f["children"] = [{"key": key(), "name": "items", "title": "", "description": "", "bsonType": "any", "isExpand": False,
                          "isArrayItem": True, "children": []}]
    return f


def titled(node, nid, title):
    node["id"] = nid
    for k in ("title", "nodeName", "name"):
        if k in node["data"]:
            node["data"][k] = title
    return node


used_ids = set(int(x) for x in re.findall(r'"(?:id|parentId)": (\d{13})', t))
next_id = [1796400000901]


def num_id():
    while next_id[0] in used_ids:
        next_id[0] += 1
    used_ids.add(next_id[0])
    return next_id[0]


def if_node(nid, title, expression, true_blocks, tid, fid):
    n = titled(copy.deepcopy(find(w, "if_PCp6")), nid, title)
    leaf = n["data"]["filter"]["list"][0]
    leaf["id"], leaf["parentId"] = num_id(), num_id()
    n["data"]["expression"]["code"] = expression
    tb, fb = copy.deepcopy(n["blocks"][0]), copy.deepcopy(n["blocks"][1])
    assert tb["data"]["title"] == "true" and fb["data"]["title"] == "false"
    tb["id"], tb["blocks"] = tid, true_blocks
    fb["id"], fb["blocks"] = fid, []
    n["blocks"] = [tb, fb]
    return n


SQL = """SELECT t.to_status AS to_status,
       CAST(SUM(r.id IS NOT NULL AND IFNULL(r.line_status, '') <> 'Cancelled') AS CHAR) AS live_rows,
       CAST(SUM(r.id IS NOT NULL AND IFNULL(r.line_status, '') = 'Completed') AS CHAR) AS completed_rows
  FROM transfer_order t
  LEFT JOIN transfer_order_jz8m9w3h_sub r
    ON r.transfer_order_id = t.id
   AND r.is_deleted = 0
 WHERE t.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND t.id = {{node:code_node_PCentry.data.pickingId}}
   AND t.is_deleted = 0
 GROUP BY t.id, t.to_status"""
sql = titled(copy.deepcopy(find(w, "sql_node_PCp5hdr")), "sql_node_PCbhdr", "Header re-check: the stored Picking status and its rows (live, Completed)")
sql["data"]["script"]["code"] = SQL
sql["data"]["response_json"] = [field("to_status"), field("live_rows"), field("completed_rows")]

CODE = """// PICKING_BULK_COMMIT - header re-check (phase B, before P5). Two confirms of one Picking that commit within milliseconds
// each roll the header up in P1 from their own view, the other's rows still open, so both can write In Progress over rows that
// are all Completed (LSH PI-2610-3697, 10-26). Phase B runs after phase A committed: roll the header up again from the stored
// rows with P1's rule (every non-cancelled row Completed) and only ever promote. P5 then sees the Picking Completed.
const first = (v) => (Array.isArray(v) ? v[0] : v) || {};
const r = first([{{node:sql_node_PCbhdr.data}}][0]);
const live = Number(r.live_rows) || 0;
const done = Number(r.completed_rows) || 0;
const was = String(r.to_status || "");
const promote = live > 0 && done === live && was !== "Completed" && was !== "Cancelled";
if (promote) console.log("header re-check: " + was + " -> Completed (" + done + "/" + live + " rows Completed)");
return {
  needHdr: promote ? "YES" : "NO",
  hdrRows: promote ? [{ id: String([{{node:code_node_PCentry.data.pickingId}}][0]), to_status: "Completed" }] : [],
  was: was,
};"""
code = titled(copy.deepcopy(find(w, "code_node_PCp6")), "code_node_PCbhdr", "Header re-check: every live row Completed -> the Picking Completed (only ever promotes)")
code["data"]["script"]["code"] = CODE
code["data"]["response_json"] = [field("needHdr"), field("hdrRows", "array", True), field("was")]

upd = titled(copy.deepcopy(find(w, "update_node_PCp6unlock")), "update_node_PCbhdr", "Header re-check WRITE: Picking to_status Completed")
rule = upd["data"]["table_id"]["rules"]["list"][0]
rule["id"], rule["parentId"] = num_id(), num_id()
rule["value"] = "{{node:code_node_PCbhdr.data.hdrRows.id}}"
label = [p for p in find(w, "update_node_PCp1write")["data"]["props"]["list"] if p.get("prop") == "to_status"][0].get("propLabel", "to_status")
upd["data"]["props"]["list"] = [
    {"prop": "id", "operator": "", "valueType": "field", "value": "{{node:code_node_PCbhdr.data.hdrRows.id}}", "valueLabel": "", "propLabel": "主键ID"},
    {"prop": "to_status", "operator": "", "valueType": "field", "value": "{{node:code_node_PCbhdr.data.hdrRows.to_status}}", "valueLabel": "",
     "propLabel": label},
]

go = if_node("if_PCbhdrgo", "IF the header re-check promotes the Picking", "'{{node:code_node_PCbhdr.data.needHdr}}' == 'YES'",
             [upd], "ifBlock_TPCbhdrgo", "ifBlock_FPCbhdrgo")
block = if_node("if_PCbhdr", "IF phase B: re-check the Picking header (two confirms committed at once)",
                "'{{node:code_node_PCentry.data.phase}}' == 'B'", [sql, code, go], "ifBlock_TPCbhdr", "ifBlock_FPCbhdr")

anchor = '"id": "if_PCp5"'
assert t.count(anchor) == 1
start = t.rfind("{", 0, t.index(anchor))
line_start = t.rfind("\n", 0, start) + 1
indent = t[line_start:start]
assert indent.strip() == ""
dumped = json.dumps(block, ensure_ascii=False, indent=2).replace("\n", "\n" + indent)
t = t[:start] + dumped + ",\n" + indent + t[start:]

w2 = json.loads(t)
top = [b.get("id") for b in w2["nodes"]]
i = top.index("if_PCbhdr")
assert top[i + 1] == "if_PCp5" and top.index("if_PCp6") > i, top[i - 1:i + 3]
open(out, "w", encoding="utf-8").write(t)
print("patched ->", out, "| top level:", top[i - 1:i + 3])
