"""patch_gd_guard_jobs.py: GOODS_DELIVERY's Processing guard also refuses an Edit save while the Goods Delivery has an open
V2 job (EDIT_GD / COMPLETE_GD / COMPLETE_PACKING on correlation 'GD|<id>', REQUIRES_REVIEW included). Mobile stays on the
classic save after the 2026-10-19 cut; COMPLETE_PACKING never sets gd_status Processing (agreed with 5a + GD Edit & Picking V2).
Text-level edit of the repo file in place (GDheadWorkflow.json does not round-trip json.dumps).

usage: python3 patch_gd_guard_jobs.py [--write]
"""
import json
import re
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDheadWorkflow.json"
raw = open(P, encoding="utf-8").read()


def nodes(o, out):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str) and isinstance(o.get("data"), dict) and "type" in o:
            out[o["id"]] = o
        for v in o.values():
            nodes(v, out)
    elif isinstance(o, list):
        for v in o:
            nodes(v, out)
    return out


N = nodes(json.loads(raw), {})
enc = lambda s: json.dumps(s, ensure_ascii=False)[1:-1]


def swap_code(nid, new):
    global raw
    old = N[nid]["data"]["script"]["code"]
    assert raw.count(enc(old)) == 1, (nid, raw.count(enc(old)))
    raw = raw.replace(enc(old), enc(new))


def add_output(nid, after, name):
    """a response_json entry `name` right after `after`, in this node's own block of the file"""
    global raw
    at = raw.index('"id": "%s"' % nid)
    i = raw.index('"name": "%s"' % after, at)
    assert not re.search(r'"id": "(code|sql|if|return|loop|condition|workflow|add|update|get|search)_', raw[at + 10:i]), nid + ": not its own entry"
    j = raw.rfind("{", 0, i)
    k = raw.index("}", i) + 1
    item = raw[j:k]
    keys = set(re.findall(r'"key": "([a-z0-9]{8})"', raw))
    key = next(c for c in ("gdpj%04d" % n for n in range(10000)) if c not in keys)
    new_item = re.sub(r'"key": "[a-z0-9]{8}"', '"key": "%s"' % key, item).replace('"%s"' % after, '"%s"' % name)
    new_item = re.sub(r'"title": "[^"]*"', '"title": "%s"' % name, new_item)
    indent = raw[raw.rfind("\n", 0, j) + 1:j]
    raw = raw[:k] + ",\n" + indent + new_item + raw[k:]


SQL = """SELECT g.gd_status,
       (SELECT CONCAT(j.job_status, '|', j.command, ' job ', CAST(j.id AS CHAR))
          FROM gd_async_job j
         WHERE j.tenant_id = g.tenant_id
           AND j.organization_id = g.organization_id
           AND j.correlation_id = CONCAT('GD|', g.id)
           AND j.command IN ('EDIT_GD', 'COMPLETE_GD', 'COMPLETE_PACKING')
           AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND j.is_deleted = 0
         ORDER BY j.id DESC
         LIMIT 1) AS open_job
  FROM goods_delivery g
 WHERE g.tenant_id = '{{system:tenantId}}'
   AND g.id = {{node:code_node_GdProcGuard.data.gdId}}
   AND g.is_deleted = 0"""
BUSY = """// held by a V2 job: stored gd_status Processing, or an open EDIT_GD / COMPLETE_GD / COMPLETE_PACKING job on this delivery
// (COMPLETE_PACKING never sets Processing; REQUIRES_REVIEW counts as open but never ends by itself: say so)
const row = (([{{node:sql_node_GdProcGuard.data}}][0]) || [])[0] || {};
const open = String(row.open_job || "").trim();
const cut = open.indexOf("|");
const status = cut > 0 ? open.slice(0, cut) : "";
const job = cut > 0 ? open.slice(cut + 1) : open;
const busy = String(row.gd_status || "") === "Processing" || open !== "";
const message = !open ? "This Goods Delivery is being processed in the background - please wait for it to finish."
  : status === "REQUIRES_REVIEW" ? "This Goods Delivery's background save stopped half-way and is under review (" + job + "): please contact support."
  : "This Goods Delivery is being saved in the background (" + job + "). Wait a moment, then try again.";
return { busy: busy ? "YES" : "NO", message: message };"""

guard_old = N["code_node_GdProcGuard"]["data"]["script"]["code"]
guard_new = guard_old.replace(
    "// A Goods Delivery an async job holds is Processing (GD V2 Created, GD Completion V2): refuse any save until it finishes",
    "// A Goods Delivery a V2 job holds (Processing, or an open edit / completion / packing job): refuse any Edit save until it finishes")
assert guard_new != guard_old
swap_code("code_node_GdProcGuard", guard_new)
swap_code("sql_node_GdProcGuard", SQL)
swap_code("code_node_GdProcBusy", BUSY)
add_output("sql_node_GdProcGuard", "gd_status", "open_job")
add_output("code_node_GdProcBusy", "busy", "message")

# the return node answers the code node's message (it was a fixed text)
at = raw.index('"id": "return_node_GdProcBusy"')
old_msg = '"value": "This Goods Delivery is being processed in the background - please wait for it to finish."'
i = raw.index(old_msg, at)
seg_start = raw.rfind("{", 0, i)
seg_end = raw.index("}", i) + 1
seg = raw[seg_start:seg_end]
assert '"prop": "message"' in seg and '"valueType": "value"' in seg, seg
new_seg = seg.replace('"valueType": "value"', '"valueType": "field"').replace(old_msg, '"value": "{{node:code_node_GdProcBusy.data.message}}"')
raw = raw[:seg_start] + new_seg + raw[seg_end:]

json.loads(raw)
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(raw)
    print("patched", P)
else:
    print("ok (dry): pass --write")
