"""patch_commit.py <base.json> <out.json>: PICKING_BULK_COMMIT, two fixes as exact raw-text replacements (the file's own
formatting kept; every replacement counted).
1. P4 sibling write (10-25 PI-2610-3490): sql_node_PCp4back reads the facts again (the same rows as sql_node_PCp4facts), and
   code_node_PCp4check accepts a header that holds the fresh roll-up (another Picking's job wrote it from newer facts).
   A header at neither our value nor the fresh roll-up still retries.
2. Numbers in retry rows: PCentry declares attempts / rowVersion as strings, so `n + 1` and `entry.rowVersion + 2` were
   string concatenations ("0" -> "01", "2" -> "22"); both are read as numbers now."""
import json
import random
import re
import sys

base, out = sys.argv[1:3]
t = open(base, encoding="utf-8").read()
w = json.loads(t)


def node(nid):
    def find(o):
        if isinstance(o, dict):
            if o.get("id") == nid:
                return o
            for v in o.values():
                r = find(v)
                if r:
                    return r
        elif isinstance(o, list):
            for v in o:
                r = find(v)
                if r:
                    return r
    return find(w)


def esc(s):
    return json.dumps(s, ensure_ascii=False)[1:-1]


def rep(old, new, count):
    global t
    n = t.count(old)
    assert n == count, (n, count, old[:80])
    t = t.replace(old, new)


facts_sql = node("sql_node_PCp4facts")["data"]["script"]["code"]
back_sql = node("sql_node_PCp4back")["data"]["script"]["code"]
plan_code = node("code_node_PCp4plan")["data"]["script"]["code"]
check_code = node("code_node_PCp4check")["data"]["script"]["code"]

# 1a. the read-back = the facts again
rep(esc(back_sql), esc(facts_sql), 1)
rep("P4 read-back: the headers' picking_status", "P4 read-back: the facts again (a header another job wrote from newer facts is right)", 3)
taken = set(re.findall(r'"key": "([a-z0-9]{8})"', t))
rng = random.Random("pk-p4-sibling-20261026")


def key():
    while True:
        k = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))
        if k not in taken:
            taken.add(k)
            return k


ind = " " * 18
entry = ('{\n' + ind + '  "key": "%s",\n' + ind + '  "name": "%s",\n' + ind + '  "title": "%s",\n' + ind + '  "description": "",\n'
         + ind + '  "bsonType": "string",\n' + ind + '  "isExpand": false,\n' + ind + '  "children": []\n' + ind + '}')
old_tail = ('"key": "d5ryqcv3",\n' + ind + '  "name": "picking_status",\n' + ind + '  "title": "picking_status",\n' + ind
            + '  "description": "",\n' + ind + '  "bsonType": "string",\n' + ind + '  "isExpand": false,\n' + ind + '  "children": []\n'
            + ind + '}')
added = "".join(",\n" + ind + entry % (key(), c, c) for c in ("kind", "gd_id", "material_id", "item_bundle_id", "gd_qty", "gd_status"))
rep(old_tail, old_tail + added, 1)

# 1b. the check: the plan's roll-up recomputed from the read-back
plan_fn = plan_code[:plan_code.index("const res = commitP4Plan(")]
old_got = """  const got = {};
  for (const r of (Array.isArray(back) ? back : back ? [back] : []).filter((x) => x && s(x.id))) got[s(r.id)] = s(r.picking_status);
  const rows = Array.isArray(plan.rows) ? plan.rows : [];
  const off = rows.filter((r) => got[s(r.id)] !== s(r.picking_status));"""
new_got = """  // the read-back is the facts again: H rows are the headers as stored now, and all rows give the roll-up as of now. A header
  // another Picking's job wrote after ours from newer facts holds that roll-up and is right (10-25 PI-2610-3490: we planned
  // In Progress, a sibling wrote Completed); only a header at neither value is a mismatch
  const backRows = (Array.isArray(back) ? back : back ? [back] : []).filter((x) => x && s(x.id));
  const got = {};
  for (const r of backRows) if (s(r.kind) === "H") got[s(r.id)] = s(r.picking_status);
  const fresh = {};
  for (const r of commitP4Plan(backRows).rows) fresh[s(r.id)] = s(r.picking_status);
  const rows = Array.isArray(plan.rows) ? plan.rows : [];
  const off = rows.filter((r) => got[s(r.id)] !== s(r.picking_status) && got[s(r.id)] !== fresh[s(r.id)]);
  const bySibling = rows.filter((r) => got[s(r.id)] !== s(r.picking_status) && got[s(r.id)] === fresh[s(r.id)]).length;
  const note = bySibling ? "; " + bySibling + " already at the fresh roll-up (written by another job)" : "";"""
assert check_code.count(old_got) == 1
old_ok = 'result_ref: s(plan.result_message).slice(0, 500), error_code: null, error_message: null }], needStep: "YES", jobRows: [split], needJobUpd: "YES", result_message: "GD headers: " + s(plan.result_message) });'
new_ok = 'result_ref: (s(plan.result_message) + note).slice(0, 500), error_code: null, error_message: null }], needStep: "YES", jobRows: [split], needJobUpd: "YES", result_message: "GD headers: " + s(plan.result_message) + note });'
assert check_code.count(old_ok) == 1
fn_at = check_code.index("const commitP4Check = function")
new_check = check_code[:fn_at] + plan_fn + check_code[fn_at:].replace(old_got, new_got).replace(old_ok, new_ok)
rep(esc(check_code), esc(new_check), 1)

# 2. numbers in retry rows (every node carrying the helpers)
rep("const n = entry.attempts;", "const n = Number(entry.attempts) || 0;", 12)
rep("row_version: entry.rowVersion + 2", "row_version: (Number(entry.rowVersion) || 0) + 2", 16)

json.loads(t)
open(out, "w", encoding="utf-8").write(t)
print("patched ->", out)
