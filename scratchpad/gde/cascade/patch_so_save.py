"""patch_so_save.py [--write]: GD Edit V2 batch 5 - SO_SAVE (Sales Order/SOsaveWorkflow.json, dev v166 base) carries one
cascade_ref per save into both SO_CASCADE passes and releases the GD edits they hold once the sales order is written:
- code_node_CascadeRef after start: the reference (+ the RELEASE literal as a field: MVEL evaluates literal strings);
- workflow_node_CascadeA / CascadeB: + cascade_ref;
- inside if_CascadeB_t, before pass B: pass A's held edits are released and committed (GD_EDIT_WORKER) - pass B appends to
  those deliveries, which the holds keep locked;
- after if_CascadeB: every held edit of both passes is released (one already committed answers NONE);
- code_node_xtWJshxF: data.gdEditJobs (the form starts the worker with them).
Prints every changed path; writes only with --write. The file round-trips json.dumps(indent=2)."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PATH = R + "Sales Order/SOsaveWorkflow.json"
CASCADE = R + "Sales Order/SOcascadeDownstreamWorkflow.json"
SUBMIT = ("GD_EDIT_SUBMIT", "2110618741159940097")
WORKER = ("GD_EDIT_WORKER", "2110618789356687361")


def find(lst, nid, parent=None):
    for n in lst or []:
        if n.get("id") == nid:
            return n
        r = find(n.get("blocks"), nid)
        if r:
            return r
    return None


def holder(lst, nid):
    """the list that holds node nid"""
    for n in lst or []:
        if n.get("id") == nid:
            return lst
        r = holder(n.get("blocks"), nid)
        if r is not None:
            return r
    return None


def clone(o):
    return json.loads(json.dumps(o))


def once(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def field(key, name, bson="any"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def bp(prop, value):
    return {"prop": prop, "propLabel": prop, "operator": "", "operatorLabel": "", "valueType": "field", "valueTypeLabel": "", "value": value, "valueLabel": ""}


def patch(doc):
    nodes = doc["nodes"]
    casc = json.load(open(CASCADE))
    loop_tpl = clone(find(casc["nodes"], "loop_cd_gd"))
    wf_tpl = clone(find(nodes, "workflow_node_CascadeA"))
    code_tpl = clone(find(nodes, "code_node_CascadeGate"))
    if_tpl = clone(find(nodes, "if_CascadeB"))

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

    def loop_node(nid, title, src, blocks):
        n = clone(loop_tpl)
        n.update({"id": nid, "blocks": blocks})
        n["data"].update({"title": title, "nodeName": title, "name": title, "loopSeletVar": {"type": "markdown", "code": src}})
        return n

    # ---- the reference of this save
    ref = code_node("code_node_CascadeRef", "GD Edit V2: this save's reference (its cascade's held GD edits)", """// GD Edit V2: one reference per Sales Order save - the cascade's held GD edits are released (or cancelled) by it.
const u = String([{{system:uuid}}][0] || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
const so = String([{{workflowparams:allData.id}}][0] || "").replace(/[^0-9]/g, "");
return { cascadeRef: "SO|" + so + "|" + u, releaseOp: "RELEASE" };
""", [field("sogde_ref", "cascadeRef", "string"), field("sogde_relop", "releaseOp", "string")])
    assert nodes[0]["id"] == "start"
    nodes.insert(1, ref)
    for nid in ("workflow_node_CascadeA", "workflow_node_CascadeB"):
        find(nodes, nid)["data"]["body_params"]["list"].append(bp("cascade_ref", "{{node:code_node_CascadeRef.data.cascadeRef}}"))

    # ---- pass B appends: pass A's holds are released and committed first
    held_a = code_node("code_node_GdeHeldA", "GD Edit V2: pass A's held GD edits (released and committed before pass B)", """// GD Edit V2: pass B appends to deliveries pass A's held edits keep locked: those are released and committed first.
const ok = String([{{node:workflow_node_CascadeA.data.code}}][0] || "") === "200";
const held = ok ? [{{node:workflow_node_CascadeA.data.heldJobs}}][0] : [];
const jobs = (Array.isArray(held) ? held : []).filter((j) => j && /^[0-9]+$/.test(String(j.job_id)) && /^[0-9]+$/.test(String(j.gd_id)));
return { jobs: jobs };
""", [field("sogde_helda", "jobs")])
    rel_a = wf_node("wf_GdeReleaseA", "GD Edit V2: release this held edit (GD_EDIT_SUBMIT RELEASE)", SUBMIT, [
        bp("operation", "{{node:code_node_CascadeRef.data.releaseOp}}"), bp("gd_id", "{{node:loop_node_GdeCommitA.gd_id}}"), bp("cascade_ref", "{{node:code_node_CascadeRef.data.cascadeRef}}")])
    commit_a = wf_node("wf_GdeCommitA", "GD Edit V2: commit it now (GD_EDIT_WORKER on the job)", WORKER, [bp("job_id", "{{node:wf_GdeReleaseA.data.job_id}}")])
    loop_a = loop_node("loop_node_GdeCommitA", "GD Edit V2: Loop Pass A Held Edits (release + commit)", "{{node:code_node_GdeHeldA.data.jobs}}",
                       [rel_a, if_node("if_GdeReleasedA", "IF released", "node.wf_GdeReleaseA.data.route", "RELEASED", [commit_a], 194000000010)])
    tb = find(nodes, "if_CascadeB")["blocks"][0]
    assert tb["id"] == "if_CascadeB_t" and tb["blocks"][0]["id"] == "workflow_node_CascadeB", [x["id"] for x in tb["blocks"]]
    tb["blocks"] = [held_a, loop_a] + tb["blocks"]

    # ---- the sales order is saved: release every held edit of both passes
    rel = code_node("code_node_GdeRelease", "GD Edit V2: the held GD edits of both passes, released now", """// GD Edit V2: the sales order is saved, so the GD edits both passes hold are released (one pass B already committed answers
// "nothing held"); the form starts the worker with these jobs.
const okA = String([{{node:workflow_node_CascadeA.data.code}}][0] || "") === "200";
const heldA = okA ? [{{node:workflow_node_CascadeA.data.heldJobs}}][0] : [];
const heldB = [{{node:workflow_node_CascadeB.data.heldJobs}}][0];
const jobs = [].concat(Array.isArray(heldA) ? heldA : [], Array.isArray(heldB) ? heldB : [])
  .filter((j) => j && /^[0-9]+$/.test(String(j.job_id)) && /^[0-9]+$/.test(String(j.gd_id)));
return { jobs: jobs, jobIds: jobs.map((j) => String(j.job_id)) };
""", [field("sogde_reljobs", "jobs"), field("sogde_relids", "jobIds")])
    rel_one = wf_node("wf_GdeRelease", "GD Edit V2: release this held edit (GD_EDIT_SUBMIT RELEASE)", SUBMIT, [
        bp("operation", "{{node:code_node_CascadeRef.data.releaseOp}}"), bp("gd_id", "{{node:loop_node_GdeRelease.gd_id}}"), bp("cascade_ref", "{{node:code_node_CascadeRef.data.cascadeRef}}")])
    loop_r = loop_node("loop_node_GdeRelease", "GD Edit V2: Loop Held Edits To Release", "{{node:code_node_GdeRelease.data.jobs}}", [rel_one])
    top = holder(nodes, "if_CascadeB")
    assert top is nodes, "if_CascadeB is a top-level node"
    i = [n["id"] for n in nodes].index("if_CascadeB")
    nodes[i + 1:i + 1] = [rel, loop_r]

    # ---- the response: the jobs the form starts the worker with
    m = find(nodes, "code_node_xtWJshxF")
    m["data"]["script"]["code"] = once(m["data"]["script"]["code"], """    pickingReversalNote: pickingReversalNote || null
  }""", """    pickingReversalNote: pickingReversalNote || null,
    // GD Edit V2: the deliveries this save changed, saved in the background
    gdEditJobs: [{{node:code_node_GdeRelease.data.jobIds}}][0] || []
  }""", "response")


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
print("SO_SAVE changes:")
walk_diff(old, new)
if "--write" in sys.argv:
    open(PATH, "w", encoding="utf-8").write(json.dumps(new, ensure_ascii=False, indent=2) + "\n")
    print("written")
