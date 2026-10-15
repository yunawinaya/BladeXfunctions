"""patch_picking_guards.py [--write]: GD Edit V2 batch 2 - the Picking side refuses while a Goods Delivery it names is being
saved in the background (gd_status Processing, or an open EDIT_GD / COMPLETE_GD job: the job row exists a moment before the
Processing flip; or an open COMPLETE_PACKING job: Packing V2 writes the GD in the background and never sets Processing). Three workflows, each based on the DEPLOYED dev version (the repo files were IDENTICAL on 2026-10-15):
- PICKING_ASYNC_SUBMIT: the facts read gd_busy from the stored Picking; decide REJECTs (before the Draft / stage routes).
- PICKING_LOOP: before the loop, every Picking of the call is checked at once (mobile confirms several Pickings in one call:
  a refusal inside the loop would leave the earlier ones completed); IF busy answers code 400 + the message.
- PICKING: the size guard's line count also reads each GD's busy number; the size guard answers 400 first (no new nodes).
Prints every changed path; writes only with --write. PICKING does not round-trip any printer: its edits are exact
replacements of JSON-encoded strings."""
import json
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PRETTIER = "/Users/yunawinaya/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs"
MESSAGE_TAIL = " is being saved in the background. Wait a moment, then try again."
BUSY = """(g.gd_status = 'Processing'
                OR EXISTS (SELECT 1
                             FROM gd_async_job j
                            WHERE j.tenant_id = g.tenant_id
                              AND j.is_deleted = 0
                              AND j.command IN ('EDIT_GD', 'COMPLETE_GD', 'COMPLETE_PACKING')
                              AND j.correlation_id = CONCAT('GD|', g.id) COLLATE utf8mb4_general_ci
                              AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')))"""


def fmt(doc):
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                          capture_output=True, text=True, check=True).stdout


def find(lst, nid):
    for n in lst or []:
        if n.get("id") == nid:
            return n
        r = find(n.get("blocks"), nid)
        if r:
            return r
    return None


def field(key, name, title, bson="string"):
    return {"key": key, "name": name, "title": title, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def replace_once(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def walk_diff(a, b, p=""):
    if type(a) != type(b):
        print("   CHANGED", p)
    elif isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                print("   ADDED", p + "/" + k)
            elif k not in b:
                print("   REMOVED", p + "/" + k)
            else:
                walk_diff(a[k], b[k], p + "/" + k)
    elif isinstance(a, list):
        ida = [x.get("id") if isinstance(x, dict) else None for x in a]
        idb = [x.get("id") if isinstance(x, dict) else None for x in b]
        if len(a) != len(b) and all(ida) and all(idb):
            print("   LIST", p, "+", [i for i in idb if i not in ida], "-", [i for i in ida if i not in idb])
            for x in a:
                y = [z for z in b if z.get("id") == x.get("id")]
                if y:
                    walk_diff(x, y[0], p + "[" + x["id"] + "]")
        elif len(a) != len(b):
            print("   LIST", p, len(a), "->", len(b))
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                walk_diff(x, y, p + "[%s]" % (x.get("id") if isinstance(x, dict) and x.get("id") else i))
    elif a != b:
        print("   CHANGED", p)


def submit(doc):
    facts = find(doc["nodes"], "sql_node_PSfacts")
    facts["data"]["script"]["code"] = replace_once(facts["data"]["script"]["code"], """) AS moved_rows
  FROM (SELECT 1 AS one) o""", """) AS moved_rows,
       (SELECT COALESCE(NULLIF(g.delivery_no, ''), CAST(g.id AS CHAR))
          FROM JSON_TABLE(IF(JSON_VALID(t.gd_no), t.gd_no, '[]'), '$[*]' COLUMNS (gid VARCHAR(32) PATH '$')) jt
          JOIN goods_delivery g
            ON g.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
           AND g.id = CAST(jt.gid AS UNSIGNED)
         WHERE g.is_deleted = 0
           AND """ + BUSY + """
         LIMIT 1) AS gd_busy
  FROM (SELECT 1 AS one) o""", "PSfacts")
    facts["data"]["response_json"].append(field("psgdbusy", "gd_busy", "A Goods Delivery of this Picking being saved in the background"))
    decide = find(doc["nodes"], "code_node_PSdecide")
    decide["data"]["script"]["code"] = replace_once(decide["data"]["script"]["code"], """  if (status === "Draft") return old(""", """  // a Goods Delivery this Picking names is being saved in the background (GD Edit V2 / GD Completed V2)
  if (s(f.gd_busy)) return reject("Goods Delivery " + s(f.gd_busy) + \"""" + MESSAGE_TAIL + """\");
  if (status === "Draft") return old(""", "PSdecide")


def loop(doc):
    nodes = doc["nodes"]
    assert [n["id"] for n in nodes][:2] == ["start", "code_node_uPSc7Syb"], [n["id"] for n in nodes][:3]
    code_tpl, sql_tpl = find(nodes, "code_node_uPSc7Syb"), find(nodes, "sql_node_LockGate")
    if_tpl, ret_tpl = find(nodes, "if_tNNSBWyU"), find(nodes, "return_node_RAigIr20")

    def code_node(nid, title, code, resp):
        n = json.loads(json.dumps(code_tpl))
        n.update({"id": nid, "blocks": []})
        n["data"].update({"title": title, "nodeName": title, "name": title, "response_json": resp})
        n["data"]["script"] = {"type": "javascript", "code": code}
        return n

    ids = code_node("code_node_GdBusyIds", "GD Busy: the GDs of every Picking in this call", """// The GDs of every Picking in this call (digits only: interpolated into sql_node_GdBusy).
const items = {{workflowparams:arrayData}};
const ids = new Set();
for (const item of Array.isArray(items) ? items : []) {
  for (const id of Array.isArray(item && item.gd_no) ? item.gd_no : []) {
    if (/^[0-9]{1,20}$/.test(String(id))) ids.add(String(id));
  }
}
return { gdIdSql: ids.size > 0 ? [...ids].join(",") : "0" };
""", [field("gbids001", "gdIdSql", "GD ids (digits, comma-separated)")])
    sql = json.loads(json.dumps(sql_tpl))
    sql.update({"id": "sql_node_GdBusy", "blocks": []})
    sql_title = "GD Busy: a GD being saved in the background (Processing, or an open edit / completion job)"
    sql["data"].update({"title": sql_title, "nodeName": sql_title, "name": sql_title, "response_json": [field("gbsql001", "gd_no", "GD No")]})
    sql["data"]["script"] = dict(sql_tpl["data"]["script"], code="""SELECT COALESCE(NULLIF(g.delivery_no, ''), CAST(g.id AS CHAR)) AS gd_no
  FROM goods_delivery g
 WHERE g.tenant_id = '{{system:tenantId}}'
   AND g.id IN ({{node:code_node_GdBusyIds.data.gdIdSql}})
   AND g.is_deleted = 0
   AND """ + BUSY + """
 LIMIT 1""")
    verdict = code_node("code_node_GdBusy", "GD Busy: verdict", """// A Goods Delivery these Pickings name is being saved in the background (GD Edit V2 / GD Completed V2): refuse them all.
const raw = {{node:sql_node_GdBusy.data}};
const row = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((r) => r && r.gd_no)[0];
return row
  ? { busy: 1, message: "Goods Delivery " + row.gd_no + \"""" + MESSAGE_TAIL + """\" }
  : { busy: 0, message: "" };
""", [field("gbbusy01", "busy", "Busy", "int"), field("gbmsg001", "message", "Message")])
    ret = json.loads(json.dumps(ret_tpl))
    ret.update({"id": "return_node_GdBusy", "blocks": []})
    ret["data"]["response_value"]["list"] = [dict(ret_tpl["data"]["response_value"]["list"][0]),
                                             dict(ret_tpl["data"]["response_value"]["list"][1], value="{{node:code_node_GdBusy.data.message}}")]
    iff = json.loads(json.dumps(if_tpl))
    if_title = "IF a GD is being saved in the background: answer 400, nothing written"
    iff.update({"id": "if_GdBusy"})
    iff["data"].update({"title": if_title, "nodeName": if_title, "name": if_title})
    leaf = dict(if_tpl["data"]["filter"]["list"][0], id=1791950000002, parentId=1791950000001, prop="node.code_node_GdBusy.data.busy", propLabel="busy")
    iff["data"]["filter"] = {"list": [leaf]}
    iff["blocks"] = [dict(if_tpl["blocks"][0], id="if_block_GdBusyT", blocks=[ret]), dict(if_tpl["blocks"][1], id="if_block_GdBusyF", blocks=[])]
    doc["nodes"] = nodes[:1] + [ids, sql, verdict, iff] + nodes[1:]


def picking(raw):
    doc = json.loads(raw)
    enc = lambda s: json.dumps(s, ensure_ascii=False)[1:-1]
    lc = find(doc["nodes"], "sql_node_GdLineCount")
    old_sql = lc["data"]["script"]["code"]
    new_sql = replace_once(old_sql, """       COUNT(*) AS line_count
FROM""", """       COUNT(*) AS line_count,
       (SELECT COALESCE(NULLIF(g.delivery_no, ''), CAST(g.id AS CHAR))
          FROM goods_delivery g
         WHERE g.tenant_id = '{{system:tenantId}}'
           AND g.id = goods_delivery_id
           AND """ + BUSY + """) AS busy_no
FROM""", "GdLineCount")
    raw = replace_once(raw, enc(old_sql), enc(new_sql), "GdLineCount in the file")
    # the response field: right after line_count's, in the file's own layout
    resp = lc["data"]["response_json"]
    last = resp[-1]
    assert last["name"] == "line_count", last
    i = raw.index('"' + last["key"] + '"', raw.index("sql_node_GdLineCount"))
    obj_start = raw.rindex("{", 0, i)
    depth, j = 0, obj_start
    while True:
        if raw[j] == "{":
            depth += 1
        elif raw[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    block = raw[obj_start:j + 1]
    assert json.loads(block) == last, "line_count field not found as one object"
    indent = raw[raw.rindex("\n", 0, obj_start) + 1:obj_start]
    added = json.dumps(field("busyno01", "busy_no", "A GD being saved in the background"), ensure_ascii=False, indent=2).replace("\n", "\n" + indent)
    raw = raw[:j + 1] + ",\n" + indent + added + raw[j + 1:]
    sg = find(doc["nodes"], "code_node_SizeGuard")
    old_code = sg["data"]["script"]["code"]
    new_code = replace_once(old_code, """const needFullSave = isForceComplete || isLoadingBay || anyTempChanged ? 1 : 0;
""", """const needFullSave = isForceComplete || isLoadingBay || anyTempChanged ? 1 : 0;

// A Goods Delivery on this Picking is being saved in the background (GD Edit V2 / GD Completed V2): nothing is written.
const busy = rows.map((r) => String(r.busy_no || "")).filter((x) => x);
if (busy.length > 0) {
  return { code: "400", message: "Goods Delivery " + busy[0] + \"""" + MESSAGE_TAIL + """\", lineCounts, needFullSave, maxLines };
}
""", "SizeGuard")
    raw = replace_once(raw, enc(old_code), enc(new_code), "SizeGuard in the file")
    return raw


write = "--write" in sys.argv
for name, path, kind in (("PICKING_ASYNC_SUBMIT", "Picking/AsyncV2/PICKING_ASYNC_SUBMIT.json", "json"), ("PICKING_LOOP", "Picking/PickingLoopWorkflow.json", "json"),
                         ("PICKING", "Picking/PickingProcessWorkflow.json", "raw")):
    raw = open(R + path, encoding="utf-8").read()
    old = json.loads(raw)
    if kind == "json":
        assert fmt(old) == raw, name + ": the printer does not round-trip the file"
        new = json.loads(raw)
        (submit if name == "PICKING_ASYNC_SUBMIT" else loop)(new)
        out = fmt(new)
    else:
        out = picking(raw)
        new = json.loads(out)
    print(name, "changes:")
    walk_diff(old, new)
    if write:
        open(R + path, "w", encoding="utf-8").write(out)
print("written" if write else "dry run (--write to save)")
