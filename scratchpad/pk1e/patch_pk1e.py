"""patch_pk1e.py <in_dir> <out_dir>: Picking V2 stage 1e - Auto Complete GD on the desktop. Patches PICKING_ASYNC_SUBMIT,
PICKING_BULK_PREPARE and PICKING_BULK_COMMIT as stored in <in_dir> (= dev = prod on 2026-10-27, with the 10-26 header re-check,
Packing un-hide and text-quantity patches) into <out_dir>. Raw-text edits: changed nodes are re-serialized, new ones inserted;
every other byte is kept. Every anchor is asserted.

- SUBMIT code_node_PSdecide: STAGE.AUTO_COMPLETE_GD on; a phone confirm (PKC: / PKF: keys) stays classic until the app update.
- SUBMIT STATUS: sql_node_PSstatus / code_node_PSstatusRes / return_node_PSstatus answer gd_complete (the job's P7|<gd> steps).
- PREPARE code_node_PPplan: no PK_NOT_SUPPORTED for Auto Complete GD (the bay + auto refusal stays).
- COMMIT: P7 after P6's job write (the job COMPLETED and the Picking unlocked earlier in this run): each delivery left fully picked
  and Created goes to GD_COMPLETE_SUBMIT (source PICKING, needCL auto), the calls in one try-catch, every answer a P7|<gd> step."""
import copy
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
IN, OUT = sys.argv[1:3]
GD_COMPLETE_SUBMIT = ("GD_COMPLETE_SUBMIT", "2110182609618337794")


def read(p):
    return open(p, encoding="utf-8").read()


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


def obj_end(t, start):
    """the index after the JSON object starting at t[start] == '{' (strings and escapes respected)"""
    depth, i, in_str = 0, start, False
    while i < len(t):
        c = t[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced object at %d" % start)


def span(t, nid):
    anchor = '"id": "%s"' % nid
    assert t.count(anchor) == 1, "%s appears %d times" % (nid, t.count(anchor))
    at = t.index(anchor)
    start = t.rfind("{", 0, at)
    assert t[start + 1:at].strip() == "", nid + ": the id is not the object's first key"
    return start, obj_end(t, start)


def indent(t, start):
    ls = t.rfind("\n", 0, start) + 1
    assert t[ls:start].strip() == ""
    return t[ls:start]


def dump(o, ind):
    return json.dumps(o, ensure_ascii=False, indent=2).replace("\n", "\n" + ind)


def replace_node(t, nid, obj):
    s, e = span(t, nid)
    return t[:s] + dump(obj, indent(t, s)) + t[e:]


def insert_before(t, nid, objs):
    s, _ = span(t, nid)
    ind = indent(t, s)
    return t[:s] + "".join(dump(o, ind) + ",\n" + ind for o in objs) + t[s:]


class Ids:
    """fresh 8-char response keys and 13-digit filter / rule ids, unique in the file"""

    def __init__(self, t, seed):
        self.keys = set(re.findall(r'"key": "([a-z0-9]{8})"', t))
        self.nums = set(int(x) for x in re.findall(r'"(?:id|parentId)": (\d{13})', t))
        self.rng = random.Random(seed)
        self.next = 1796500000001

    def key(self):
        while True:
            k = "".join(self.rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))
            if k not in self.keys:
                self.keys.add(k)
                return k

    def num(self):
        while self.next in self.nums:
            self.next += 1
        self.nums.add(self.next)
        return self.next

    def fresh(self, o):
        """renumber every 13-digit id / parentId in a cloned subtree, consistently"""
        seen = {}

        def walk(x):
            if isinstance(x, dict):
                for k in ("id", "parentId"):
                    v = x.get(k)
                    if isinstance(v, int) and len(str(v)) == 13:
                        x[k] = seen.setdefault(v, self.num())
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(o)
        return o

    def field(self, name, bson="string", items=False):
        f = {"key": self.key(), "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": items, "children": []}
        if items:
            f["children"] = [{"key": self.key(), "name": "items", "title": "", "description": "", "bsonType": "any", "isExpand": False,
                              "isArrayItem": True, "children": []}]
        return f


def titled(node, nid, title):
    node["id"] = nid
    for k in ("title", "nodeName", "name"):
        if k in node["data"]:
            node["data"][k] = title
    return node


def code_text(node):
    return node["data"]["script"]["code"]


def sub_once(text, old, new, what):
    assert text.count(old) == 1, "%s: found %d times" % (what, text.count(old))
    return text.replace(old, new)


# ---------------------------------------------------------------- SUBMIT
def patch_submit(t):
    w = json.loads(t)
    ids = Ids(t, "pk1e-submit-20261027")
    decide = find(w, "code_node_PSdecide")
    c = code_text(decide)
    c = sub_once(c, "AUTO_COMPLETE_GD: false, PICKING_PLAN: false, FORCE_COMPLETE: true", "AUTO_COMPLETE_GD: true, PICKING_PLAN: false, FORCE_COMPLETE: true",
                 "decide STAGE")
    c = sub_once(c, '  if (n(f.auto_completed_gd) === 1 && !STAGE.AUTO_COMPLETE_GD) return old("Auto Complete GD uses the classic save");\n',
                 "  // Auto Complete GD (stage 1e): COMMIT P7 hands each fully picked delivery to GD Complete V2 and the screen starts it. A phone\n"
                 "  // confirm (PKC: / PKF: keys) stays classic unless its app starts the completions itself (caps gd_complete, the OTA)\n"
                 "  const phone = /^PK[CF]:/.test(s(guard.idempotencyKey)) && s(guard.caps).split(\",\").indexOf(\"gd_complete\") < 0;\n"
                 "  if (n(f.auto_completed_gd) === 1 && (!STAGE.AUTO_COMPLETE_GD || phone))\n"
                 '    return old(STAGE.AUTO_COMPLETE_GD ? "Auto Complete GD on the phone uses the classic save until the app update" : "Auto Complete GD uses the classic save");\n',
                 "decide rule")
    decide["data"]["script"]["code"] = c
    # the deployed node must be the pk1d source plus its tail: the edited source must be in the edited node too
    src = read(os.path.join(REPO, "scratchpad/pk1d/code/submit_decide.js")).strip()
    assert src in c, "code_node_PSdecide is not pk1d/code/submit_decide.js + its tail"
    t = replace_node(t, "code_node_PSdecide", decide)

    st = find(w, "sql_node_PSstatus")
    sql = code_text(st)
    sql = sub_once(sql, "       END AS kick\n  FROM gd_async_job j",
                   "       END AS kick,\n"
                   "       -- stage 1e: the deliveries this confirm handed to GD Complete V2 (its P7|<gd> steps); the screen starts each QUEUED job\n"
                   "       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('gd_id', SUBSTRING(p.step_name, 4), 'gd_no', IFNULL(g.delivery_no, ''), 'status', p.step_status,\n"
                   "                                             'job_id', IFNULL(p.result_ref, ''), 'code', IFNULL(p.error_code, ''), 'message', IFNULL(p.error_message, ''))) AS CHAR)\n"
                   "          FROM gd_publish_step p\n"
                   "          LEFT JOIN goods_delivery g ON g.id = CAST(SUBSTRING(p.step_name, 4) AS UNSIGNED) AND g.tenant_id = p.tenant_id AND g.is_deleted = 0\n"
                   "         WHERE p.tenant_id = j.tenant_id AND p.job_id = CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci\n"
                   "           AND p.step_name LIKE 'P7|%' AND p.is_deleted = 0) AS gd_complete\n"
                   "  FROM gd_async_job j", "status SQL")
    st["data"]["script"]["code"] = sql
    assert sql.strip() == read(os.path.join(REPO, "scratchpad/pk1d/code/submit_status.sql")).strip(), "sql_node_PSstatus is not pk1d/code/submit_status.sql"
    assert [f["name"] for f in st["data"]["response_json"]][-1] == "kick"
    st["data"]["response_json"].append(ids.field("gd_complete"))
    t = replace_node(t, "sql_node_PSstatus", st)

    res = find(w, "code_node_PSstatusRes")
    c = code_text(res)
    c = sub_once(c, "// progress and the delivery edits the screen must run (kick: GD_EDIT_WORKER, one call per id)\n",
                 "// progress and the delivery edits the screen must run (kick: GD_EDIT_WORKER, one call per id). gd_complete (stage 1e): the deliveries\n"
                 "// handed to GD Complete V2 - the screen starts GD_COMPLETE_WORKER for each QUEUED one\n", "status comment")
    c = sub_once(c, "const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;\n",
                 "const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;\n"
                 "const gdComplete = (() => {\n"
                 "  try {\n"
                 "    const x = JSON.parse(s(job && job.gd_complete) || \"[]\");\n"
                 "    return Array.isArray(x) ? x : [];\n"
                 "  } catch (e) {\n"
                 "    return [];\n"
                 "  }\n"
                 "})();\n", "status parse")
    c = sub_once(c, 'kick: s(job.kick) ? s(job.kick).split(",") : [] }', 'kick: s(job.kick) ? s(job.kick).split(",") : [], gd_complete: gdComplete }', "status job answer")
    c = sub_once(c, 'operation: "", progress_percent: 0, kick: [] };', 'operation: "", progress_percent: 0, kick: [], gd_complete: [] };', "status empty answer")
    res["data"]["script"]["code"] = c
    assert [f["name"] for f in res["data"]["response_json"]][-1] == "kick"
    res["data"]["response_json"].append(ids.field("gd_complete", "array", True))
    t = replace_node(t, "code_node_PSstatusRes", res)

    ret = find(w, "return_node_PSstatus")
    lst = ret["data"]["response_value"]["list"]
    assert lst[-1]["prop"] == "kick", [p["prop"] for p in lst]
    p = copy.deepcopy(lst[-1])
    p.update(prop="gd_complete", propLabel="gd_complete", value="{{node:code_node_PSstatusRes.data.gd_complete}}")
    lst.append(p)
    t = replace_node(t, "return_node_PSstatus", ret)
    # the workflow answers only the keys it declares: gd_complete is declared as kick is (an array passes through, live since 1d)
    top = w["response_json"]
    assert top[-1]["name"] == "kick" and top[-1]["bsonType"] == "string", top[-1]
    anchor = '\n  "response_json": ['
    assert t.count(anchor) == 1
    end = t.index("\n  ]", t.index(anchor))
    field = {"key": ids.key(), "name": "gd_complete", "title": "gd_complete", "description": "", "bsonType": "string", "isExpand": False}
    t = t[:end] + ",\n    " + dump(field, "    ") + t[end:]
    assert [r["name"] for r in json.loads(t)["response_json"]][-1] == "gd_complete"

    # the guard passes the client's caps (an app that starts GD Complete V2 itself sends "gd_complete")
    guard = find(w, "code_node_PSguard")
    g = code_text(guard)
    g = sub_once(g, 'moveRowsJson: "[]", result_code: "400", result_message: why });', 'moveRowsJson: "[]", caps: "", result_code: "400", result_message: why });', "guard bad")
    g = sub_once(g, 'moveRowsJson: "[]", result_code: "", result_message: "" };', 'moveRowsJson: "[]", caps: "", result_code: "", result_message: "" };', "guard status")
    g = sub_once(g, "  return { route: \"CONTINUE\",",
                 "  // stage 1e: what the client does itself - an app that starts GD Complete V2's worker sends \"gd_complete\"; known tokens only\n"
                 "  const caps = (Array.isArray(payload.caps) ? payload.caps : []).map(s).filter((c, i, a) => [\"gd_complete\"].indexOf(c) >= 0 && a.indexOf(c) === i);\n"
                 "  return { route: \"CONTINUE\",", "guard caps")
    g = sub_once(g, 'moveRowsJson: JSON.stringify(moveRows), result_code: "", result_message: "" };', 'moveRowsJson: JSON.stringify(moveRows), caps: caps.join(","), result_code: "", result_message: "" };',
                 "guard continue")
    assert g.strip() == read(os.path.join(REPO, "scratchpad/pk1d/code/submit_guard.js")).strip(), "code_node_PSguard is not pk1d/code/submit_guard.js"
    guard["data"]["script"]["code"] = g
    assert "caps" not in [f["name"] for f in guard["data"]["response_json"]]
    guard["data"]["response_json"].append(ids.field("caps"))
    t = replace_node(t, "code_node_PSguard", guard)

    return t


# ---------------------------------------------------------------- PREPARE
def patch_prepare(t):
    w = json.loads(t)
    plan = find(w, "code_node_PPplan")
    c = sub_once(code_text(plan), '  if (num(hdr.auto_completed_gd) === 1) return fail("PK_NOT_SUPPORTED", "Auto Complete GD is on: not handled by the background save yet");\n',
                 "  // Auto Complete GD (stage 1e): planned like any confirm; COMMIT P7 hands the deliveries it leaves fully picked to GD Complete V2\n",
                 "PREPARE refusal")
    plan["data"]["script"]["code"] = c
    src = read(os.path.join(REPO, "scratchpad/pk1d/code/prepare_plan.js")).strip()
    assert src in c, "code_node_PPplan is not pk1d/code/prepare_plan.js + its tail"
    return replace_node(t, "code_node_PPplan", plan)


# ---------------------------------------------------------------- COMMIT
T = "{{node:code_node_PCguard.data.tenantId}}"
ENTRY = ("{ jobId: [{{node:code_node_PCentry.data.jobId}}][0], organizationId: [{{node:code_node_PCentry.data.organizationId}}][0], "
         "dbNow: [{{node:code_node_PCentry.data.dbNow}}][0] }")
OPEN = "('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'REQUIRES_REVIEW')"
FACTS = """(SELECT CAST(o.id AS CHAR) FROM gd_async_job o
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0 AND o.command = 'COMPLETE_GD'
           AND o.correlation_id = CONCAT('GD|', g.id) COLLATE utf8mb4_general_ci AND o.job_status IN @OPEN
         ORDER BY o.id DESC LIMIT 1) AS open_job,
       (SELECT s.step_status FROM gd_publish_step s
         WHERE s.tenant_id = '@T' AND s.job_id = '{{node:code_node_PCentry.data.jobId}}'
           AND s.step_name = CONCAT('P7|', g.id) COLLATE utf8mb4_general_ci AND s.is_deleted = 0 LIMIT 1) AS p7"""
SQL_GDS = ("""SELECT CAST(g.id AS CHAR) AS gd_id, g.delivery_no, g.gd_status, g.picking_status,
       -- P7: the deliveries of this Picking (its live rows), read only while the organization's Auto Complete GD is on (the setup's
       -- first row, as SUBMIT and PREPARE read it): their status, an open completion, this job's P7 answer if a re-run already gave one
       @FACTS
  FROM (SELECT DISTINCT r.gd_id FROM transfer_order_jz8m9w3h_sub r
         WHERE r.tenant_id = '@T' AND r.transfer_order_id = {{node:code_node_PCentry.data.pickingId}}
           AND r.is_deleted = 0 AND IFNULL(r.line_status, '') <> 'Cancelled' AND r.gd_id IS NOT NULL) d
  JOIN goods_delivery g ON g.id = d.gd_id AND g.tenant_id = '@T' AND g.is_deleted = 0
 WHERE (SELECT ps.auto_completed_gd FROM picking_setup ps
         WHERE ps.tenant_id = '@T' AND ps.organization_id = '{{node:code_node_PCentry.data.organizationId}}' AND ps.is_deleted = 0
         ORDER BY ps.id LIMIT 1) = 1
 ORDER BY g.id""").replace("@FACTS", FACTS).replace("@OPEN", OPEN).replace("@T", T)
SQL_BACK = ("""SELECT CAST(g.id AS CHAR) AS gd_id,
       -- P7 read-back: the planned deliveries after the calls (or a caught failure): an open completion, this job's P7 answer
       @FACTS
  FROM goods_delivery g
 WHERE g.tenant_id = '@T' AND g.id IN ({{node:code_node_PCp7plan.data.plannedSql}}) AND g.is_deleted = 0""").replace("@FACTS", FACTS).replace("@OPEN", OPEN).replace("@T", T)
CRASH_JS = """// P7 - a GD_COMPLETE_SUBMIT call failed (caught; e.g. two Pickings of one delivery finishing together, the second's lock insert
// fails): the loop ends here, and the fill after it records every planned delivery still without an answer
console.log("P7: a GD_COMPLETE_SUBMIT call failed (caught) - the fill records the rest");
return { crashed: "YES" };"""


def patch_commit(t):
    w = json.loads(t)
    assert "PCp7" not in t, "already patched"
    ids = Ids(t, "pk1e-commit-20261027")
    p7 = read(os.path.join(HERE, "code", "p7.js")).rstrip() + "\n"

    def sql_node(nid, title, code, fields):
        n = ids.fresh(titled(copy.deepcopy(find(w, "sql_node_PCbhdr")), nid, title))
        n["data"]["script"]["code"] = code
        n["data"]["response_json"] = [ids.field(f) for f in fields]
        return n

    def code_node(nid, title, code, fields):
        n = ids.fresh(titled(copy.deepcopy(find(w, "code_node_PCp6")), nid, title))
        n["data"]["script"]["code"] = code
        n["data"]["response_json"] = [ids.field(*f) if isinstance(f, tuple) else ids.field(f) for f in fields]
        return n

    def add_step(nid, title, src):
        n = ids.fresh(titled(copy.deepcopy(find(w, "add_node_PCp5step")), nid, title))
        for p in n["data"]["props"]["list"]:
            assert "code_node_PCp5check.data.stepRows." in p["value"], p
            p["value"] = p["value"].replace("code_node_PCp5check.data.stepRows", src)
        return n

    def cor(nid, title, src, flag, yes):
        n = ids.fresh(copy.deepcopy(find(w, "cor_PCp5step")))
        n["id"], n["data"]["title"] = nid, title
        y, no = n["blocks"]
        y["id"], no["id"] = "cori_Y" + nid[4:], "cori_N" + nid[4:]
        leaf = y["data"]["filter"]["list"][0]
        leaf["prop"], leaf["propLabel"] = "node.%s.data.%s" % (src, flag), flag
        y["blocks"], no["blocks"] = yes, []
        return n

    def if_node(nid, title, expression, true_blocks):
        n = ids.fresh(titled(copy.deepcopy(find(w, "if_PCbhdrgo")), nid, title))
        n["data"]["expression"]["code"] = expression
        tb, fb = n["blocks"]
        assert tb["data"]["title"] == "true" and fb["data"]["title"] == "false"
        tb["id"], tb["blocks"] = "ifBlock_T" + nid[3:], true_blocks
        fb["id"], fb["blocks"] = "ifBlock_F" + nid[3:], []
        return n

    def wf_call(nid, title, wf, params):
        n = ids.fresh(titled(copy.deepcopy(find(w, "workflow_node_PCpm1")), nid, title))
        d = n["data"]
        d["workflow"]["source"] = "%s:Workflow:%s" % wf
        d["workflow"]["rules"]["collectionId"] = wf[1]
        proto = d["body_params"]["list"][0]
        d["body_params"]["list"] = [dict(copy.deepcopy(proto), prop=p, propLabel=p, value=v) for p, v in params]
        return n

    def loop(nid, title, var, blocks):
        n = ids.fresh(titled(copy.deepcopy(find(w, "loop_PCp5upd")), nid, title))
        n["data"]["loopSeletVar"]["code"] = var
        n["blocks"] = blocks
        return n

    def try_catch(nid, title, try_nodes, catch_title, catch_nodes):
        # GD_BULK_COMMIT's try_catch_P3invCal shape, live since 10-23 (catch-all: Filter, empty list)
        return {"id": nid, "type": "tryCatch", "data": {"title": title},
                "blocks": [{"type": "tryBlock", "id": nid + "_tryBlock_0", "blocks": try_nodes},
                           {"type": "catchBlock", "data": {"title": catch_title, "trycatch_type": "Filter", "filter": {"list": []},
                                                           "expression": {"type": "javascript", "code": ""}, "displayContent": "sdk.form.setCondition"},
                            "id": nid + "_catchBlock_1", "blocks": catch_nodes}]}

    ROW_FIELDS = [("rows", "array", True)]
    gds = sql_node("sql_node_PCp7gds", "P7: the Picking's deliveries while Auto Complete GD is on (status, open completion, this job's answer)", SQL_GDS,
                   ["gd_id", "delivery_no", "gd_status", "picking_status", "open_job", "p7"])
    plan = code_node("code_node_PCp7plan", "P7 plan: the deliveries left fully picked and Created -> GD_COMPLETE_SUBMIT requests (<= 25)",
                     p7 + "const res = p7Plan(" + ENTRY + ", [{{node:sql_node_PCp7gds.data}}][0]);\n"
                     "console.log(\"P7 plan\", JSON.stringify({ requests: res.items.length, direct: res.directRows.length, gds: res.plannedSql }));\nreturn res;",
                     [("items", "array", True), "needLoop", ("directRows", "array", True), "needDirect", "plannedSql"])
    direct = cor("cor_PCp7direct", "P7 answers known without a call (an open completion, over 25)?", "code_node_PCp7plan", "needDirect",
                 [add_step("add_node_PCp7direct", "P7 WRITE: the answers known without a call", "code_node_PCp7plan.data.directRows")])
    call = wf_call("workflow_node_PCp7submit", "GD_COMPLETE_SUBMIT: complete this delivery in the background (source PICKING, needCL auto)", GD_COMPLETE_SUBMIT,
                   [("operation", "{{node:loop_PCp7.operation}}"), ("gd_id", "{{node:loop_PCp7.gd_id}}"), ("source", "{{node:loop_PCp7.source}}"),
                    ("answers", "{{node:loop_PCp7.answers}}"), ("causation_id", "{{node:loop_PCp7.causation_id}}")])
    ans = code_node("code_node_PCp7ans", "P7 answer: QUEUED (or its own open completion) -> the job; else the reason, for a manual completion",
                    p7 + "const res = p7Answer(" + ENTRY + ", [{{node:loop_PCp7}}][0], { route: [{{node:workflow_node_PCp7submit.data.route}}][0], "
                    "code: [{{node:workflow_node_PCp7submit.data.code}}][0], message: [{{node:workflow_node_PCp7submit.data.message}}][0], "
                    "job_id: [{{node:workflow_node_PCp7submit.data.job_id}}][0] });\n"
                    "console.log(\"P7 answer\", JSON.stringify(res.rows[0]));\nreturn res;", ROW_FIELDS)
    each = loop("loop_PCp7", "Each delivery to complete: GD_COMPLETE_SUBMIT, its answer as a P7|<gd> step", "{{node:code_node_PCp7plan.data.items}}",
                [call, ans, add_step("add_node_PCp7step", "P7 WRITE: this delivery's answer", "code_node_PCp7ans.data.rows")])
    crash = code_node("code_node_PCp7crash", "P7: a GD_COMPLETE_SUBMIT call failed (caught) - the loop ends, the fill records the rest", CRASH_JS, ["crashed"])
    back = sql_node("sql_node_PCp7back", "P7 read-back: the planned deliveries (open completion, this job's answer)", SQL_BACK, ["gd_id", "open_job", "p7"])
    fill = code_node("code_node_PCp7fill", "P7 fill: a planned delivery without an answer -> its open completion, else NOT_QUEUED",
                     p7 + "const res = p7Fill(" + ENTRY + ", [{{node:code_node_PCp7plan.data}}][0], [{{node:sql_node_PCp7back.data}}][0], "
                     "[{{node:code_node_PCp7crash.data.crashed}}][0]);\nconsole.log(\"P7 fill\", JSON.stringify({ rows: res.fillRows.length }));\nreturn res;",
                     [("fillRows", "array", True), "needFill"])
    fill_add = cor("cor_PCp7fill", "P7 answers to fill?", "code_node_PCp7fill", "needFill",
                   [add_step("add_node_PCp7fill", "P7 WRITE: the filled answers", "code_node_PCp7fill.data.fillRows")])
    go = if_node("if_PCp7go", "IF P7 has deliveries to hand to GD Complete V2",
                 "'{{node:code_node_PCp7plan.data.needLoop}}' == 'YES'",
                 [try_catch("try_catch_PCp7", "try-catch: a failed GD_COMPLETE_SUBMIT call ends the loop, not this run (the Picking is already saved)",
                            [each], "A GD_COMPLETE_SUBMIT call failed", [crash]), back, fill, fill_add])
    # after update_node_PCp6job (the job COMPLETED) and before the read-back of the job
    blocks = find(w, "ifBlock_TPCp6")["blocks"]
    order = [b["id"] for b in blocks]
    assert order[order.index("update_node_PCp6job") + 1] == "sql_node_PCback", order
    return insert_before(t, "sql_node_PCback", [gds, plan, direct, go])


os.makedirs(OUT, exist_ok=True)
for name, fn in [("PICKING_ASYNC_SUBMIT", patch_submit), ("PICKING_BULK_PREPARE", patch_prepare), ("PICKING_BULK_COMMIT", patch_commit)]:
    src = read(os.path.join(IN, name + ".json"))
    out = fn(src)
    json.loads(out)
    open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8").write(out)
    print("%s: %d -> %d chars" % (name, len(src), len(out)))
