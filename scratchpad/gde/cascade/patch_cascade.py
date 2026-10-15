"""patch_cascade.py [--write]: GD Edit V2 batch 5 - SO_CASCADE (Sales Order/SOcascadeDownstreamWorkflow.json, dev v24 base)
saves each Goods Delivery through the background save when it takes it:
- new param cascade_ref (one Sales Order save); new response heldJobs (the jobs SO_SAVE releases after the SO write);
- code_cd_plan / code_cd_payloads lose their 500-line GD caps (GD_EDIT_SUBMIT refuses a delivery it does not take above 500);
  the classic route keeps it (d3's review: a caller without cascade_ref would re-save a big GD classically) - each payload
  carries its lineCount;
- loop_cd_gd: GD_EDIT_SUBMIT (CASCADE, the payload) -> QUEUED: GD_EDIT_WORKER prepares it now (HELD = saved for the release)
  / NOT_ELIGIBLE or no cascade_ref: GOODS_DELIVERY as before / any other answer is the delivery's result;
- pass A ending non-200: every job it held is cancelled (CANCEL_HELD + the worker's EXPIRE path, synchronously);
- code_cd_summary hands out heldJobs (+ cancelJobs).
Prints every changed path; writes only with --write. The file round-trips json.dumps(indent=2)."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PATH = R + "Sales Order/SOcascadeDownstreamWorkflow.json"
SUBMIT = ("GD_EDIT_SUBMIT", "2110618741159940097")
WORKER = ("GD_EDIT_WORKER", "2110618789356687361")


def find(lst, nid):
    for n in lst or []:
        if n.get("id") == nid:
            return n
        r = find(n.get("blocks"), nid)
        if r:
            return r
    return None


def clone(o):
    return json.loads(json.dumps(o))


def once(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def field(key, name, bson="any"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def bp(prop, value, kind="field"):
    return {"prop": prop, "propLabel": prop, "operator": "", "operatorLabel": "", "valueType": kind, "valueTypeLabel": "", "value": value, "valueLabel": ""}


def patch(doc):
    nodes = doc["nodes"]
    wf_tpl = clone(find(nodes, "wf_cd_gd"))
    code_tpl = clone(find(nodes, "code_cd_collect_gd"))
    if_tpl = clone(find(nodes, "if_cd_alloc_failed"))

    def code_node(nid, title, code, resp):
        n = clone(code_tpl)
        n.update({"id": nid, "blocks": []})
        n["data"].update({"title": title, "nodeName": title, "name": title, "response_json": resp})
        n["data"]["script"] = {"type": "javascript", "code": code}
        return n

    def wf_node(nid, title, wf, params):
        n = clone(wf_tpl)
        n.update({"id": nid, "blocks": []})
        n["data"].update({"title": title, "nodeName": title, "name": title})
        n["data"]["workflow"] = {"source": "%s:Workflow:%s" % wf, "rules": {"collectionId": wf[1], "list": [dict(wf_tpl["data"]["workflow"]["rules"]["list"][0])]}}
        n["data"]["body_params"] = {"list": params}
        return n

    def if_node(nid, title, prop, value, true_nodes, leaf_id):
        n = clone(if_tpl)
        n["id"] = nid
        n["data"].update({"title": title, "nodeName": title, "name": title})
        n["data"]["filter"] = {"list": [dict(if_tpl["data"]["filter"]["list"][0], id=leaf_id, parentId=leaf_id + 1, prop=prop, operator="equal", value=value,
                                             propLabel=prop.split(".")[-1], operatorLabel="Equal")]}
        n["blocks"] = [dict(if_tpl["blocks"][0], id=nid + "_t", blocks=true_nodes), dict(if_tpl["blocks"][1], id=nid + "_f", blocks=[])]
        return n

    # ---- params
    so_id = [p for p in doc["request_json"] if p["name"] == "so_id"][0]
    doc["request_json"].append(dict(clone(so_id), key="socd_req_cref", name="cascade_ref", title="cascade_ref",
                                    description="The Sales Order save (SO_SAVE) this pass belongs to: it releases / cancels the GD edits the cascade holds.",
                                    value="workflowparams.cascade_ref", label="cascade_ref"))
    doc["response_json"].append(field("socd_res_held", "heldJobs"))

    # ---- the 500-line caps go: GD_EDIT_SUBMIT refuses a delivery it does not take above 500 lines itself
    plan = find(nodes, "code_cd_plan")
    plan["data"]["script"]["code"] = once(plan["data"]["script"]["code"], """// The cascade re-saves the whole delivery the classic way: refused past 500 lines, as PICKING and GD completion do.
const MAX_GD_LINES = 500;
const big = gdDrafts.filter((g) => flat(g.allData.table_gd).length > MAX_GD_LINES);
if (big.length) {
  return block("Delivery " + big.map((g) => g.gd_no + " has " + flat(g.allData.table_gd).length + " lines").join(", ") +
    ": a Sales Order change can update a delivery of up to " + MAX_GD_LINES + " lines. Complete or cancel that delivery before changing these lines.");
}
""", "", "plan cap")
    pay = find(nodes, "code_cd_payloads")
    pay["data"]["script"]["code"] = once(pay["data"]["script"]["code"], """  // Same 500-line cap as code_cd_plan: the new line stays outstanding on the Sales Order instead.
  const have = flat(gds[0].table_gd).length;
  if (have + added.length > 500) {
    return {
      gdPayloads: [], ppPayloads: [], allocFailed: 1, allocBlockKind: "block",
      allocMessage: "The sales order was saved, but delivery " + sid(gds[0].delivery_no) + " already has " + have +
        " lines, more than a Sales Order change can update (500), so the new line was not added to it. Deliver it on a new Goods Delivery."
    };
  }
""", "", "payloads cap")
    c = pay["data"]["script"]["code"]
    c = once(c, """  gdPayloads.push({ gd_id: d.gd_id, gd_no: d.gd_no, allData: allData });""",
             """  gdPayloads.push({ gd_id: d.gd_id, gd_no: d.gd_no, allData: allData, lineCount: flat(allData.table_gd).length });""", "payload lineCount A")
    c = once(c, """    gdPayloads: [{ gd_id: sid(gd.id), gd_no: sid(gd.delivery_no), allData: gd }],""",
             """    gdPayloads: [{ gd_id: sid(gd.id), gd_no: sid(gd.delivery_no), allData: gd, lineCount: flat(gd.table_gd).length }],""", "payload lineCount B")
    pay["data"]["script"]["code"] = c

    # ---- the background save's arguments, once (literals reach the workflow nodes as fields: MVEL evaluates literal strings)
    args = code_node("code_cd_gde_args", "GD Edit V2: arguments of the background save", """// GD Edit V2: each delivery goes to the background save (GD_EDIT_SUBMIT) when it takes it, held until SO_SAVE releases it.
const ref = String({{workflowparams:cascade_ref}} || "").trim();
return {
  operation: "SUBMIT", source: "CASCADE", cancelOp: "CANCEL_HELD", cascadeRef: ref,
  answers: { needCL: "auto", continueZero: "Yes", confirmPickReversal: String({{workflowparams:confirmPickReversal}} || "") }
};
""", [field("socd_gde_args_op", "operation", "string"), field("socd_gde_args_src", "source", "string"), field("socd_gde_args_cop", "cancelOp", "string"),
      field("socd_gde_args_ref", "cascadeRef", "string"), field("socd_gde_args_ans", "answers")])
    i = [n["id"] for n in nodes].index("loop_cd_gd")
    nodes.insert(i, args)

    # ---- loop_cd_gd: submit, route, the worker or the classic save, collect
    loop = find(nodes, "loop_cd_gd")
    body = {b["id"]: b for b in loop["blocks"]}
    assert list(body) == ["get_cd_res_gd", "wf_cd_gd", "code_cd_collect_gd", "set_cd_res_gd"], list(body)
    submit = wf_node("wf_cd_gde_submit", "GD Edit V2: background save of this delivery (GD_EDIT_SUBMIT, its payload)", SUBMIT, [
        bp("operation", "{{node:code_cd_gde_args.data.operation}}"), bp("gd_id", "{{node:loop_cd_gd.gd_id}}"), bp("source", "{{node:code_cd_gde_args.data.source}}"),
        bp("form", "{{node:loop_cd_gd.allData}}"), bp("cascade_ref", "{{node:code_cd_gde_args.data.cascadeRef}}"), bp("answers", "{{node:code_cd_gde_args.data.answers}}")])
    route = code_node("code_cd_gde_route", "GD Edit V2: which save takes this delivery", """// GD Edit V2: QUEUED -> the worker prepares it now (held for SO_SAVE's RELEASE); NOT_ELIGIBLE, or no cascade_ref (a caller
// that cannot release) -> the classic save as before; any other answer is this delivery's result
const a = [{{node:wf_cd_gde_submit.data}}][0] || {};
const ref = [{{node:code_cd_gde_args.data.cascadeRef}}][0];
const s = (v) => (v === undefined || v === null ? "" : String(v));
let route = "DONE";
if (!ref || s(a.route) === "NOT_ELIGIBLE") route = "CLASSIC";
else if (s(a.route) === "QUEUED" && /^[0-9]+$/.test(s(a.job_id))) route = "V2";
// the classic save re-saves the whole delivery: refused past 500 lines, as before
const lines = Number({{node:loop_cd_gd.lineCount}}) || 0;
if (route === "CLASSIC" && lines > 500) {
  const append = Number({{workflowparams:passNo}}) === 2;
  return { route: "DONE", jobId: "0", code: "400", note: "", clNote: "", message: append
    ? "it already has " + lines + " lines, more than a Sales Order change can update (500). Deliver the new line on a new Goods Delivery."
    : "Delivery " + s({{node:loop_cd_gd.gd_no}}) + " has " + lines + " lines: a Sales Order change can update a delivery of up to 500 lines. Complete or cancel that delivery before changing these lines." };
}
return { route: route, jobId: s(a.job_id) || "0", code: s(a.code), message: s(a.message), note: s(a.picking_reversal_note), clNote: s(a.credit_limit_note) };
""", [field("socd_gde_rt_route", "route", "string"), field("socd_gde_rt_job", "jobId", "string"), field("socd_gde_rt_code", "code", "string"),
      field("socd_gde_rt_msg", "message", "string"), field("socd_gde_rt_note", "note", "string"), field("socd_gde_rt_cl", "clNote", "string")])
    worker = wf_node("wf_cd_gde_worker", "GD Edit V2: prepare it now (GD_EDIT_WORKER on the job: held for the release)", WORKER,
                     [bp("job_id", "{{node:code_cd_gde_route.data.jobId}}")])
    if_v2 = if_node("if_cd_gde_v2", "IF the background save took it", "node.code_cd_gde_route.data.route", "V2", [worker], 192000000010)
    if_classic = if_node("if_cd_gde_classic", "IF the classic save takes it (not taken by the background save)", "node.code_cd_gde_route.data.route", "CLASSIC",
                         [body["wf_cd_gd"]], 192000000020)
    collect = body["code_cd_collect_gd"]
    collect["data"]["script"]["code"] = once(collect["data"]["script"]["code"], """if (!Array.isArray(results)) results = [];
""", """if (!Array.isArray(results)) results = [];

// GD Edit V2: the route this delivery took says whose answer to read (an untaken branch's node may hold an earlier pass of the loop)
const rt = [{{node:code_cd_gde_route.data}}][0] || {};
if (rt.route === "V2") {
  const w = [{{node:wf_cd_gde_worker.data}}][0] || {};
  const held = String(w.job_status || "") === "HELD";
  results.push({
    doc: "GD", doc_no: {{node:loop_cd_gd.gd_no}} || "", gd_id: String({{node:loop_cd_gd.gd_id}} || ""), code: held ? "200" : "400", ok: held ? 1 : 0, confirm: 0,
    message: held ? "" : String(w.result_message || "it could not be checked in the background (" + String(w.job_status || "no answer") + "). Save the Sales Order again."),
    note: rt.note || "", clNote: rt.clNote || "", held: held ? 1 : 0, job_id: held ? String(rt.jobId) : ""
  });
  return { results: results };
}
if (rt.route !== "CLASSIC") {
  results.push({ doc: "GD", doc_no: {{node:loop_cd_gd.gd_no}} || "", gd_id: String({{node:loop_cd_gd.gd_id}} || ""), code: String(rt.code || ""), ok: 0,
    confirm: String(rt.code) === "413" ? 1 : 0, message: rt.message || "", note: "", clNote: "", held: 0, job_id: "" });
  return { results: results };
}
""", "collect")
    loop["blocks"] = [body["get_cd_res_gd"], submit, route, if_v2, if_classic, collect, body["set_cd_res_gd"]]

    # ---- the summary hands out the held jobs: released by SO_SAVE, or (pass A not saved) cancelled below
    summ = find(nodes, "code_cd_summary")
    c = summ["data"]["script"]["code"]
    c = once(c, """const ok = results.filter((r) => r.ok === 1);""", """const ok = results.filter((r) => r.ok === 1);
// GD Edit V2: the background saves this pass holds. SO_SAVE releases them after the SO write; a pass A that does not let the
// sales order save cancels them (below this node)
const held = results.filter((r) => r.held === 1 && r.job_id).map((r) => ({ job_id: String(r.job_id), gd_id: String(r.gd_id || ""), gd_no: r.doc_no || "" }));
const out = (o) => Object.assign(o, o.code === "200" || isAppend ? { heldJobs: held, cancelJobs: [] } : { heldJobs: [], cancelJobs: held });""", "summary held")
    c = once(c, """  return {
    code: "413",""", """  return out({
    code: "413",""", "summary 413")
    c = once(c, """    soLineCounters: soLineCounters,
    appliedSummary: results
  };
}

if (!bad.length) {
  return {""", """    soLineCounters: soLineCounters,
    appliedSummary: results
  });
}

if (!bad.length) {
  return out({""", "summary 200")
    c = once(c, """    soLineCounters: soLineCounters,
    appliedSummary: results
  };
}

// Pass B runs""", """    soLineCounters: soLineCounters,
    appliedSummary: results
  });
}

// Pass B runs""", "summary 200 end")
    c = once(c, """return {
  code: "406",""", """return out({
  code: "406",""", "summary 406")
    assert c.rstrip().endswith("""  appliedSummary: results
};"""), c[-200:]
    c = c.rstrip()[:-2] + "});\n"
    summ["data"]["script"]["code"] = c
    summ["data"]["response_json"] += [field("socd_code_cd_summary_heldJobs", "heldJobs"), field("socd_code_cd_summary_cancelJobs", "cancelJobs")]

    # ---- pass A not saved: cancel what it held, synchronously (the re-run must find the deliveries unlocked)
    cancel = wf_node("wf_cd_gde_cancel", "GD Edit V2: cancel this held edit (GD_EDIT_SUBMIT CANCEL_HELD)", SUBMIT, [
        bp("operation", "{{node:code_cd_gde_args.data.cancelOp}}"), bp("gd_id", "{{node:loop_cd_gde_cancel.gd_id}}"), bp("cascade_ref", "{{node:code_cd_gde_args.data.cascadeRef}}")])
    unlock = wf_node("wf_cd_gde_unlock", "GD Edit V2: GD_EDIT_WORKER on it (its EXPIRE path: CANCELLED, the delivery unlocked)", WORKER,
                     [bp("job_id", "{{node:wf_cd_gde_cancel.data.job_id}}")])
    if_cancel = if_node("if_cd_gde_cancelling", "IF the hold ended (CANCELLING)", "node.wf_cd_gde_cancel.data.route", "CANCELLING", [unlock], 192000000030)
    cloop = clone(loop)
    cloop.update({"id": "loop_cd_gde_cancel", "blocks": [cancel, if_cancel]})
    cloop["data"].update({"title": "GD Edit V2: Loop Held Edits To Cancel", "nodeName": "GD Edit V2: Loop Held Edits To Cancel", "name": "GD Edit V2: Loop Held Edits To Cancel",
                          "loopSeletVar": {"type": "markdown", "code": "{{node:code_cd_summary.data.cancelJobs}}"}})
    i = [n["id"] for n in nodes].index("ret_cd_done")
    nodes.insert(i, cloop)
    ret = find(nodes, "ret_cd_done")
    ret["data"]["response_value"]["list"].append(bp("heldJobs", "{{node:code_cd_summary.data.heldJobs}}"))


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
        if all(ida) and all(idb) and ida != idb:
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


raw = open(PATH, encoding="utf-8").read()
old = json.loads(raw)
assert json.dumps(old, ensure_ascii=False, indent=2) + "\n" == raw, "the file does not round-trip json.dumps(indent=2)"
new = json.loads(raw)
patch(new)
print("SO_CASCADE changes:")
walk_diff(old, new)
# wf_cd_gd moved into if_cd_gde_classic: it must be the same node
assert find(new["nodes"], "wf_cd_gd") == find(old["nodes"], "wf_cd_gd")
if "--write" in sys.argv:
    open(PATH, "w", encoding="utf-8").write(json.dumps(new, ensure_ascii=False, indent=2) + "\n")
    print("written")
