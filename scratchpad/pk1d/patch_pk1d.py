"""patch_pk1d.py [--write] [--rebase] [SUBMIT ...]: Picking V2 stage 1d (Force Complete) into Picking/AsyncV2's JSONs.
Each file must still be the deployed dev version snapshotted in scratchpad/pk1d/base/ (the fetch-deployed rule: a stale base
deletes features); new bodies come from scratchpad/pk1d/code/. The files round-trip Prettier (compact JSON in, --parser json),
asserted before anything changes. Prints what changes; writes only with --write.
"""
import json
import re
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PRETTIER = "/Users/yunawinaya/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs"


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


def parent_of(lst, nid):
    for i, n in enumerate(lst or []):
        if n.get("id") == nid:
            return lst, i
        r = parent_of(n.get("blocks"), nid)
        if r:
            return r
    return None


def code(name):
    with open(os.path.join(HERE, "code", name), encoding="utf-8") as f:
        return f.read()


def field(key, name, title, bson="string"):
    if bson == "array":
        return {"key": key, "name": name, "title": title, "description": "", "bsonType": "array", "isExpand": True,
                "children": [{"key": key[2:] + "it", "name": "items", "title": "", "description": "", "bsonType": "any", "isExpand": False, "isArrayItem": True, "children": []}]}
    return {"key": key, "name": name, "title": title, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def ret_entry(prop, value):
    return {"prop": prop, "propLabel": prop, "operator": "", "operatorLabel": "", "valueType": "field", "valueTypeLabel": "", "value": value, "valueLabel": ""}


def swap(nodes, nid, new_body):
    n = find(nodes, nid)
    assert n, nid
    n["data"]["script"]["code"] = new_body
    return n


SQL_FRESH = iter(range(1796400000001, 1796400000999))


def sql_like(template, nid, title, text, names):
    # the template's own rule ids are renumbered: a copy must not repeat them
    nums = {}
    n = json.loads(re.sub(r'("(?:id|parentId)": )(\d{10,})', lambda m: m.group(1) + str(nums.setdefault(m.group(2), next(SQL_FRESH))), json.dumps(template)))
    n["id"] = nid
    n["blocks"] = []
    n["data"].update({"title": title, "nodeName": title, "name": title})
    n["data"]["script"] = {"type": "sql", "code": text}
    n["data"]["response_json"] = [field(k, nm, nm) for k, nm in names]
    return n


def if_like(template, nid, title, expression, rule_ids, true_nodes, tag):
    n = json.loads(json.dumps(template))
    n["id"] = nid
    n["data"].update({"title": title, "nodeName": title, "name": title})
    n["data"]["expression"] = {"type": "javascript", "code": expression}
    n["data"]["filter"] = {"list": [{"id": rule_ids[0], "parentId": rule_ids[1], "isTop": True, "prop": "", "operator": "", "valueType": "", "value": "", "type": "leaf", "level": 1}]}
    t, f = n["blocks"]
    t.update({"id": "ifBlock_T" + tag, "blocks": true_nodes})
    f.update({"id": "ifBlock_F" + tag, "blocks": []})
    return n


# ------------------------------------------------------------------------------------------------- SUBMIT
FC_FIELDS = [("psfc0kd1", "kind"), ("psfc0gd2", "gd_id"), ("psfc0dn3", "delivery_no"), ("psfc0gs4", "gd_status"), ("psfc0lc5", "line_count"),
             ("psfc0si6", "serial_items"), ("psfc0sp7", "select_picking"), ("psfc0lk8", "linked"), ("psfc0oj9", "other_job"), ("psfc0rca", "rec_count")]


def patch_submit(doc):
    nodes = doc["nodes"]
    swap(nodes, "code_node_PSguard", code("submit_guard.js"))
    dc = swap(nodes, "code_node_PSdecide", code("submit_decide.js"))
    assert "classic_ok" not in [r["name"] for r in dc["data"]["response_json"]]
    dc["data"]["response_json"].append(field("psfccok1", "classic_ok", "classic_ok"))
    # the force complete's facts, read only for FORCE_COMPLETE, right before the decision
    assert not find(nodes, "if_PSfc")
    sqlfc = sql_like(find(nodes, "sql_node_PSfacts"), "sql_node_PSfc",
                     "1d force complete: each delivery on the Picking (lines, serial / select picking / internal trading, other Pickings' jobs) + its records",
                     code("submit_fc.sql").rstrip("\n"), FC_FIELDS)
    iff = if_like(find(nodes, "if_PSstatus"), "if_PSfc", "IF FORCE_COMPLETE: read its deliveries and records",
                  "'{{node:code_node_PSguard.data.operation}}' == 'FORCE_COMPLETE'", [1796100000101, 1796100000102], [sqlfc], "PSfc")
    lst, i = parent_of(nodes, "code_node_PSdecide")
    lst.insert(i, iff)
    # STATUS: the operation, its progress and the delivery edits the screen must run
    st = swap(nodes, "sql_node_PSstatus", code("submit_status.sql").rstrip("\n"))
    st["data"]["response_json"] += [field("psfcst01", "progress_percent", "progress_percent"), field("psfcst02", "operation", "operation"), field("psfcst03", "kick", "kick")]
    sr = swap(nodes, "code_node_PSstatusRes", code("submit_status_res.js"))
    sr["data"]["response_json"] += [field("psfcsr01", "operation", "operation"), field("psfcsr02", "progress_percent", "progress_percent", "any"),
                                    field("psfcsr03", "kick", "kick", "array")]
    find(nodes, "return_node_PSstop")["data"]["response_value"]["list"].append(ret_entry("classic_ok", "{{node:code_node_PSdecide.data.classic_ok}}"))
    rs = find(nodes, "return_node_PSstatus")["data"]["response_value"]["list"]
    rs += [ret_entry(k, "{{node:code_node_PSstatusRes.data.%s}}" % k) for k in ("operation", "progress_percent", "kick")]
    # the workflow declares every key its return nodes answer (as every other V2 workflow does)
    top = doc["response_json"]
    assert not [r for r in top if r["name"] in ("classic_ok", "operation", "progress_percent", "kick")]
    top += [{"key": "psfctop%d" % i, "name": k, "title": k, "description": "", "bsonType": "string", "isExpand": False}
            for i, k in enumerate(("classic_ok", "operation", "progress_percent", "kick"), 1)]
    return ["workflow response_json (+ classic_ok, operation, progress_percent, kick)", "code_node_PSguard", "code_node_PSdecide (+ classic_ok)", "if_PSfc + sql_node_PSfc (new)", "sql_node_PSstatus (+ operation, progress_percent, kick)",
            "code_node_PSstatusRes (+ operation, progress_percent, kick)", "return_node_PSstop (+ classic_ok)", "return_node_PSstatus (+ operation, progress_percent, kick)"]


# ------------------------------------------------------------------------------------------------- PREPARE
FC_GD_F = ["id", "goods_delivery_id", "delivery_no", "gd_status", "material_id", "material_name", "gd_qty", "base_qty", "gd_order_quantity", "gd_initial_delivered_qty",
           "gd_order_uom_id", "temp_qty_data", "temp_hu_data", "view_stock", "plan_qty", "plan_temp_qty_data", "plan_view_stock", "picking_status", "item_bundle_id",
           "parent_id", "so_line_item_id"]
FC_REC_F = ["id", "transfer_order_id", "to_status", "gd_line_id", "job_line_key", "source_bin", "target_location", "batch_no", "target_batch", "handling_unit_id",
            "store_out_qty", "item_code", "source_bin_name", "target_location_name", "batch_name", "target_batch_name", "hu_name"]
FC_OTHER_F = ["transfer_order_id", "to_id", "gd_line_id"]
FC_OUT = ["route", "nonce", "partRows", "needParts", "readyRows", "needReady", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message",
          "job_status", "gdCount", "partCount"]
FC_ARRAYS = ("partRows", "readyRows", "jobRows", "unlockRows")


def fc_code():
    """code_node_PPfc: the pure modules inlined (the code-node runtime has no require), then the glue and its node tail"""
    out = []
    for f in ("view_stock.js", "fc_fp.js", "fc_plan.js", "prepare_fc.js"):
        t = re.sub(r'^const \{[^}]*\} = require\([^)]*\);\s*$', "", code(f), flags=re.M)
        t = re.sub(r'^(if \(typeof module !== "undefined"\) )?module\.exports = .*$', "", t, flags=re.M)
        out.append(t.strip("\n"))
    text = "\n".join(out) + "\n"
    assert "require(" not in text and "module.exports" not in text
    return text


def clone_rename(node, pairs, fresh):
    """a deep copy with its node ids / references renamed and every numeric rule id replaced by a fresh one"""
    s = json.dumps(node)
    for a, b in pairs:
        assert a in s, a
        s = s.replace(a, b)
    nums = {}
    s = re.sub(r'("(?:id|parentId)": )(\d{10,})', lambda m: m.group(1) + str(nums.setdefault(m.group(2), next(fresh))), s)
    return json.loads(s)


def retitle(node, title):
    node["data"].update({"title": title, "nodeName": title, "name": title})


def patch_prepare(doc):
    nodes = doc["nodes"]
    swap(nodes, "code_node_PPplan", code("prepare_plan.js"))
    assert not find(nodes, "if_PPfc")
    fresh = iter(range(1796200000001, 1796200000999))
    hdr = find(nodes, "sql_node_PPhdr")
    reads = [("cai_PPfcGd", "Delivery lines", sql_like(hdr, "sql_node_PPfcGd", "1d force complete: every line of every delivery on the Picking (full columns)",
                                                       code("prepare_fc_gd.sql").rstrip("\n"), [("pkfg%04d" % i, n) for i, n in enumerate(FC_GD_F)])),
             ("cai_PPfcRecs", "Records", sql_like(hdr, "sql_node_PPfcRecs", "1d force complete: every record of those deliveries on any Picking naming them (+ its status, the bin / batch / HU names)",
                                                  code("prepare_fc_recs.sql").rstrip("\n"), [("pkfr%04d" % i, n) for i, n in enumerate(FC_REC_F)])),
             ("cai_PPfcOther", "Other open Pickings", sql_like(hdr, "sql_node_PPfcOther", "1d force complete: rows of other open Pickings that name those deliveries' lines",
                                                              code("prepare_fc_other.sql").rstrip("\n"), [("pkfo%04d" % i, n) for i, n in enumerate(FC_OTHER_F)]))]
    ca = find(nodes, "condition_all_PPread")
    par = json.loads(json.dumps(ca))
    par["id"] = "condition_all_PPfcRead"
    par["data"]["title"] = "1d force complete reads in parallel: the deliveries' lines, their records, other open Pickings"
    par["blocks"] = []
    for nid, title, child in reads:
        it = json.loads(json.dumps(ca["blocks"][0]))
        it["id"] = nid
        retitle(it, title)
        it["blocks"] = [child]
        par["blocks"].append(it)
    fcn = json.loads(json.dumps(find(nodes, "code_node_PPplan")))
    fcn["id"] = "code_node_PPfc"
    retitle(fcn, "1d force complete: fcPlan on the reads -> the FCD parts + READY_TO_COMMIT (CONFIRM's payload shape), or FAILED + the Picking unlocked")
    fcn["data"]["script"]["code"] = fc_code()
    fcn["data"]["response_json"] = [field("pkfc%04d" % i, n, n, "array" if n in FC_ARRAYS else "string") for i, n in enumerate(FC_OUT)]
    parts = clone_rename(find(nodes, "cor_PPalc"), [("code_node_PPmove", "code_node_PPfc"), ("needAlc", "needParts"), ("alcRows", "partRows"), ("PPalc", "PPfcParts")], fresh)
    retitle(parts, "Force complete parts to write?")
    parts["data"]["title"] = "Force complete parts to write?"
    retitle(find([parts], "add_node_PPfcParts"), "1d parts: gd_publish_step FCD|<nonce>|<gi>|<nnn> (each delivery's planned edit; GD_EDIT_SUBMIT reads them by fcd_ref)")
    writers = [clone_rename(find(nodes, "cor_PPmv" + w), [("code_node_PPfinal", "code_node_PPfc"), ("PPmv" + w, "PPfc" + w), ("(1c move)", "(1d force complete)")], fresh)
               for w in ("Ready", "Fail", "Unlock")]
    iff = if_like(find(nodes, "if_PPmove"), "if_PPfc", "IF a force complete (1d): plan its deliveries from the database, write the parts and READY, or FAILED",
                  "'{{node:code_node_PPplan.data.route}}' == 'FC'", [next(fresh), next(fresh)], [par, fcn, parts] + writers, "PPfc")
    lst, i = parent_of(nodes, "if_PPmove")
    lst.insert(i + 1, iff)
    return ["code_node_PPplan (route FC)", "if_PPfc (new): condition_all_PPfcRead (sql_node_PPfcGd / PPfcRecs / PPfcOther), code_node_PPfc, "
            "cor_PPfcParts (add_node_PPfcParts), cor_PPfcReady / cor_PPfcFail / cor_PPfcUnlock (clones of the 1c move writers)"]


# ------------------------------------------------------------------------------------------------- WORKER
IDS = json.load(open(os.path.join(HERE, "ids.json")))
HARD_OLD = ('  hard: ["PK_INVALID_REQUEST", "PK_INVALID_DATA", "PK_NOT_FOUND", "PK_STATUS", "PK_NOT_SUPPORTED", "PK_LINE_NOT_FOUND", "PK_GD_CLOSED", '
            '"PK_NOTHING_PICKED", "PK_NOTHING_LEFT", "PK_BUNDLE_SHORT", "PK_STALE", "JOB_ILLEGAL_TRANSITION"],\n')
PKC_COPIES = ["code_node_PWpick", "code_node_PWclaim", "code_node_PWafterPrep", "code_node_PWpubAfter", "code_node_PWpub2After"]
MID_COLS_OLD = "       DATE_FORMAT(j.finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at\n  FROM (SELECT NOW(3) AS t) n"
MID_COLS_NEW = ("       DATE_FORMAT(j.finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at,\n"
                "       IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.operation')), NULL) AS operation,\n"
                "       (SELECT COUNT(*) FROM gd_publish_step s\n"
                "         WHERE s.tenant_id = '{{node:code_node_PWguard.data.tenantId}}' AND s.job_id = '{{node:code_node_PWpick.data.jobId}}'\n"
                "           AND s.step_name = 'FC_GDS' AND s.is_deleted = 0) AS fc_gds\n"
                "  FROM (SELECT NOW(3) AS t) n")
MID_CODE = [
    ('  if (own.route === "RESUME") return status === "COMMITTING_PICKING" && String(job.lease_live) !== "1" ? Object.assign(base, { route: "PUBLISH", result_message: "resume PICKING_BULK_COMMIT" }) :',
     '  // a force complete (Picking 1d): PICKING_FC_DRIVE updates its deliveries first (FC_GDS), then it publishes as a confirm does\n'
     '  const drive = s(job.operation) === "FORCE_COMPLETE" && !(Number(job.fc_gds) > 0);\n'
     '  const to = (route, why) => Object.assign(base, drive ? { route: "DRIVE", result_message: "drive the force complete\'s deliveries" } : { route: route, result_message: why });\n'
     '  if (own.route === "RESUME") return status === "COMMITTING_PICKING" && String(job.lease_live) !== "1" ? to("PUBLISH", "resume PICKING_BULK_COMMIT") :'),
    ('  if (status === "READY_TO_COMMIT" && s(job.lease_owner) === guard.leaseOwner) return Object.assign(base, { route: "PUBLISH", result_message: "publish" });',
     '  if (status === "READY_TO_COMMIT" && s(job.lease_owner) === guard.leaseOwner) return to("PUBLISH", "publish");'),
]
RESULT_CODE = [
    ("  const first = jobs[0] || null;",
     "  // the force completes' edit jobs the screen must run GD_EDIT_WORKER on (Picking 1d)\n"
     "  const kick = [];\n"
     "  for (const r of list) for (const k of s(r.kick).split(\",\")) if (k && kick.indexOf(k) < 0) kick.push(k);\n"
     "  const first = jobs[0] || null;"),
    ('evidence: JSON.stringify({ v: 1, workflow: "PICKING_ASYNC_WORKER", path: "DONE" }) };',
     'evidence: JSON.stringify({ v: 1, workflow: "PICKING_ASYNC_WORKER", path: "DONE" }), kick: kick };'),
]
DRIVE_RESP = ["called", "route", "kick", "actions", "job_id", "job_status", "result_code", "result_message"]
AFTER_DRIVE = ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "driveRoute", "kick", "result_code", "result_message", "job_status"]
GO_FIELDS = ["route", "dbNow", "jobId", "jobStatus", "result_message"]


def replace_once(text, old, new, where):
    assert text.count(old) == 1, "%s: %d copies of %r" % (where, text.count(old), old[:70])
    return text.replace(old, new)


def patch_worker(doc):
    nodes = doc["nodes"]
    drive_id = IDS.get("PICKING_FC_DRIVE") or "0"
    if drive_id == "0":
        print("   NOTE: ids.json PICKING_FC_DRIVE is empty: the drive call points at workflow 0 until the dev shell exists (Task 18 re-patches)")
    hard_new = re.search(r"^  hard: \[.*?\],\n", code("worker_after_drive.js"), flags=re.M | re.S).group(0)
    for nid in PKC_COPIES:
        n = find(nodes, nid)
        n["data"]["script"]["code"] = replace_once(n["data"]["script"]["code"], HARD_OLD, hard_new, nid)
    # the job before the decision: + operation, FC_GDS written
    mid_sql = find(nodes, "sql_node_PWmid")
    mid_sql["data"]["script"]["code"] = replace_once(mid_sql["data"]["script"]["code"], MID_COLS_OLD, MID_COLS_NEW, "sql_node_PWmid")
    mid_sql["data"]["response_json"] += [field("pwfm0001", "operation", "operation"), field("pwfm0002", "fc_gds", "fc_gds")]
    mid = find(nodes, "code_node_PWmid")
    for old, new in MID_CODE:
        mid["data"]["script"]["code"] = replace_once(mid["data"]["script"]["code"], old, new, "code_node_PWmid")
    # if_PWdrive: if_PWpub's call / response / read-back / after / writers, cloned
    fresh = iter(range(1796300000001, 1796300000999))
    pub = find(nodes, "if_PWpub")
    drv = clone_rename(pub, [("PWpub", "PWdrive")], fresh)
    rekey = iter(range(1, 999))
    for n in [drv] + [x for b in drv["blocks"] for x in b["blocks"]]:
        for r in (n.get("data") or {}).get("response_json") or []:
            r["key"] = "pwfk%04d" % next(rekey)
            for c in r.get("children") or []:
                c["key"] = r["key"][2:] + "it"
    drv["data"]["expression"]["code"] = "'{{node:code_node_PWmid.data.route}}' == 'DRIVE'"
    retitle(drv, "IF a force complete's deliveries are to be updated (Picking 1d): the ONE PICKING_FC_DRIVE call (it never runs a delivery's PREPARE / COMMIT: the screen kicks them)")
    wf = find([drv], "workflow_node_PWdrive")
    retitle(wf, "PICKING_FC_DRIVE (holds, then commits each delivery's edit through GD_EDIT_SUBMIT; stamps the job itself)")
    wf["data"]["workflow"]["source"] = "PICKING_FC_DRIVE:Workflow:" + drive_id
    wf["data"]["workflow"]["rules"]["collectionId"] = drive_id
    params = wf["data"]["body_params"]["list"]
    assert [b["prop"] for b in params] == ["job_id"]
    lease = json.loads(json.dumps(params[0]))
    lease.update({"prop": "lease_owner", "propLabel": "lease_owner", "value": "{{node:code_node_PWguard.data.leaseOwner}}"})
    params.append(lease)
    resp = find([drv], "code_node_PWdriveResp")
    retitle(resp, "The drive response, normalized (evidence; the job row decides)")
    rc = resp["data"]["script"]["code"]
    rc = replace_once(rc, '["job_id", "job_status", "result_code", "result_message", "publish_route"]', '["route", "kick", "actions", "job_id", "job_status", "result_code", "result_message"]', "PWdriveResp")
    rc = replace_once(rc, "The publish response", "The drive response", "PWdriveResp")
    resp["data"]["script"]["code"] = rc.replace('"publish response"', '"drive response"')
    resp["data"]["response_json"] = [field("pwfr%04d" % i, n, n) for i, n in enumerate(DRIVE_RESP)]
    back = find([drv], "sql_node_PWdriveBack")
    retitle(back, "Read-back: the job after the drive (the truth)")
    back["data"]["script"]["code"] = mid_sql["data"]["script"]["code"]
    back["data"]["response_json"] = [field("pwfb%04d" % i, r["name"], r["name"]) for i, r in enumerate(mid_sql["data"]["response_json"])]
    after = find([drv], "code_node_PWdriveAfter")
    retitle(after, "After the drive: every delivery updated -> publish in this tick; the worker writes only when nothing was saved")
    after["data"]["script"]["code"] = code("worker_after_drive.js")
    after["data"]["response_json"] = [field("pwfa%04d" % i, n, n, "array" if n in ("jobRows", "unlockRows") else "string") for i, n in enumerate(AFTER_DRIVE)]
    retitle(find([drv], "cor_PWdriveJob"), "Job row to write after the drive?")
    retitle(find([drv], "update_node_PWdriveJob"), "Job: FAILED (a hard code) / retry with backoff (lease released)")
    retitle(find([drv], "cor_PWdriveUnlock"), "Picking lock to release after the drive?")
    retitle(find([drv], "update_node_PWdriveUnlock"), "Picking is_processing = 0 (nothing was saved)")
    # the publish gate: PWmid's PUBLISH, or the drive ended with every delivery updated
    go = json.loads(json.dumps(mid))
    go["id"] = "code_node_PWgo"
    retitle(go, "Publish gate: PWmid's PUBLISH, or a force complete whose drive in this iteration updated every delivery")
    go["data"]["script"]["code"] = code("worker_go.js")
    go["data"]["response_json"] = [field("pwfg%04d" % i, n, n) for i, n in enumerate(GO_FIELDS)]
    lst, i = parent_of(nodes, "if_PWpub")
    lst[i:i] = [drv, go]
    pub["data"]["expression"]["code"] = replace_once(pub["data"]["expression"]["code"], "code_node_PWmid.data.route", "code_node_PWgo.data.route", "if_PWpub")
    sp = find(nodes, "code_node_PWsplit")
    sp["data"]["script"]["code"] = replace_once(sp["data"]["script"]["code"], "const mid = [{{node:code_node_PWmid.data}}][0];", "const mid = [{{node:code_node_PWgo.data}}][0];",
                                                "code_node_PWsplit")
    # the tick's answer: + the edit jobs to kick
    fin = swap(nodes, "sql_node_PWfinal", code("worker_final.sql").rstrip("\n"))
    fin["data"]["response_json"].append(field("pwfn0001", "kick", "kick"))
    res = find(nodes, "code_node_PWresult")
    for old, new in RESULT_CODE:
        res["data"]["script"]["code"] = replace_once(res["data"]["script"]["code"], old, new, "code_node_PWresult")
    res["data"]["response_json"].append(field("pwfn0002", "kick", "kick", "array"))
    find(nodes, "return_node_PWdone")["data"]["response_value"]["list"].append(ret_entry("kick", "{{node:code_node_PWresult.data.kick}}"))
    doc["response_json"].append({"key": "pwfn0003", "name": "kick", "title": "kick", "description": "", "bsonType": "string", "isExpand": False})
    return ["PKC.hard + the force-complete codes (5 copies)", "sql_node_PWmid (+ operation, fc_gds)", "code_node_PWmid (route DRIVE)",
            "if_PWdrive (new, cloned from if_PWpub): workflow_node_PWdrive -> PICKING_FC_DRIVE:" + drive_id + ", PWdriveResp, PWdriveBack, PWdriveAfter, writers",
            "code_node_PWgo (new publish gate)", "if_PWpub -> PWgo", "code_node_PWsplit -> PWgo", "sql_node_PWfinal / code_node_PWresult / return (+ kick)"]


# ------------------------------------------------------------------------------------------------- COMMIT
COMMIT_EDITS = {
    "code_node_PCentry": [
        ('needP0: "NO", needP1: "NO",', 'fc: "NO", needP0: "NO", needP1: "NO",'),
        ('  const rowIds = Object.keys(p.row_patch).filter(digits);',
         '  // a force complete (Picking 1d) is written only once PICKING_FC_DRIVE has updated every delivery (FC_GDS)\n'
         '  const fc = s(p.operation) === "FORCE_COMPLETE";\n'
         '  if (fc && !done.FC_GDS) return answer("", "force complete: its deliveries are not all updated yet (FC_GDS)");\n'
         '  const rowIds = Object.keys(p.row_patch).filter(digits);'),
        ('progress_message: phase === "A" ? "Saving " + p.records.length + " picked line(s)" : "Updating the Packing"',
         'progress_message: phase === "A" ? (fc ? "Closing the force-completed Picking" : "Saving " + p.records.length + " picked line(s)") : "Updating the Packing"'),
        ('    route: "GO", phase: phase, organizationId: org,', '    route: "GO", phase: phase, fc: fc ? "YES" : "NO", organizationId: org,'),
    ],
    "code_node_PCp0": [
        ('  const p = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));',
         '  const p = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));\n'
         '  // a force complete (Picking 1d): its deliveries were shrunk to these records - any change since PREPARE is for review\n'
         '  const fc = s(p.operation) === "FORCE_COMPLETE";'),
        ('    else if (st === "Cancelled" || st === "Completed") changed.push("Goods Delivery " + g + " is " + st);',
         '    else if (fc ? st !== s(snap.gds[g]) : st === "Cancelled" || st === "Completed") changed.push("Goods Delivery " + g + " is " + st + (fc ? " (was " + s(snap.gds[g]) + ")" : ""));\n'
         '  }\n'
         '  const rec = list(facts).filter((f) => f.kind === "REC")[0] || {};\n'
         '  const fp = (p.fc && p.fc.fp) || {};\n'
         '  if (fc && (Number(rec.id) !== Number(fp.recCount) || Math.abs((Number(rec.v1) || 0) - (Number(fp.recSum) || 0)) > 1e-6 || s(rec.v2) !== s(fp.recMaxId))) {\n'
         '    changed.push("its picked records changed (" + fp.recCount + " -> " + rec.id + " record(s))");'),
        ('  const why = "the Picking changed after it was queued: "',
         '  if (fc) {\n'
         '    const whyFc = "the Picking changed after its deliveries were force completed: " + changed.slice(0, 5).join("; ") + (changed.length > 5 ? "; and " + (changed.length - 5) + " more" : "") + ". The deliveries stay updated; the Picking stays locked for review";\n'
         '    return Object.assign(base, { route: "FAIL", jobRows: [{ id: entry.jobId, job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the Picking changed after its deliveries were updated", attempt_count: entry.attempts, next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: "PK_FC_STALE", error_message: whyFc, error_details: JSON.stringify({ step: "P0_REVALIDATE", changed: changed.slice(0, 50) }), finished_at: endNow(entry) }], needJobUpd: "YES", result_code: "PK_FC_STALE", result_message: whyFc });\n'
         '  }\n'
         '  const why = "the Picking changed after it was queued: "'),
    ],
    "code_node_PCp1merge": [
        ('  const toStatus = completed === nonCancelled.length && nonCancelled.length > 0 ? "Completed" : completed > 0 || inProgress > 0 ? "In Progress" : "Open";',
         '  const fc = s(p.operation) === "FORCE_COMPLETE";\n'
         '  const toStatus = completed === nonCancelled.length && (nonCancelled.length > 0 || fc) ? "Completed" : completed > 0 || inProgress > 0 ? "In Progress" : "Open";\n'
         '  // a force complete closes the Picking (Picking 1d): a line it did not plan, still open, stops it for review before any write\n'
         '  if (fc && toStatus !== "Completed") {\n'
         '    const open = nonCancelled.filter((i) => i.line_status !== "Completed").map((i) => s(i.id));\n'
         '    return Object.assign(base, { route: "REVIEW", toStatus: toStatus, result_message: open.length + " line(s) still open after the force complete (" + open.slice(0, 5).join(", ") + "): the Picking would be " + toStatus });\n'
         '  }'),
    ],
    "code_node_PCp1check": [
        ('the Picking could not be read", false));', 'the Picking could not be read", s(merge.route) === "REVIEW"));'),
        ('  if (have !== want) return Object.assign(base, stepEnd(entry, "P1_PICKING", have + " of " + want + " record(s) found after the write", false));',
         '  if (have !== want) return Object.assign(base, stepEnd(entry, "P1_PICKING", have + " of " + want + " record(s) found after the write", false));\n'
         '  if (s(entry.fc) === "YES" && s(r.to_status) !== "Completed") return Object.assign(base, stepEnd(entry, "P1_PICKING", "the force-completed Picking reads " + (s(r.to_status) || "no status") + " after the write", false));'),
    ],
    "code_node_PCp4plan": [
        ("code_node_GdRoute writes); a cancelled GD is skipped", "code_node_GdRoute writes); a cancelled or completed GD is skipped"),
        ('    if (s(h.gd_status) === "Cancelled") {', '    if (s(h.gd_status) === "Cancelled" || s(h.gd_status) === "Completed") {'),
    ],
    "code_node_PCp5build": [
        ('    if (!gd) continue;', '    // a delivery already completed or cancelled (a force complete skips them) keeps its Packing as it is\n'
                                 '    if (!gd || s(gd.gd_status) === "Completed" || s(gd.gd_status) === "Cancelled") continue;'),
    ],
}
P0_REC = ("\nUNION ALL\n"
          "SELECT CAST('REC' AS CHAR), CAST(COUNT(*) AS CHAR), CAST(SUM(r.store_out_qty) AS CHAR), CAST(MAX(r.id) AS CHAR)\n"
          "  FROM transfer_order_vrqs3cmr_sub r\n"
          " WHERE r.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'\n"
          "   AND r.transfer_order_id = {{node:code_node_PCentry.data.pickingId}}\n"
          "   AND r.is_deleted = 0")


def patch_commit(doc):
    nodes = doc["nodes"]
    for nid, edits in COMMIT_EDITS.items():
        n = find(nodes, nid)
        for old, new in edits:
            n["data"]["script"]["code"] = replace_once(n["data"]["script"]["code"], old, new, nid)
    ent = find(nodes, "code_node_PCentry")
    assert "fc" not in [r["name"] for r in ent["data"]["response_json"]]
    ent["data"]["response_json"].append(field("pcfc0001", "fc", "fc"))
    p0 = find(nodes, "sql_node_PCp0facts")
    assert "'REC'" not in p0["data"]["script"]["code"]
    p0["data"]["script"]["code"] = p0["data"]["script"]["code"].rstrip("\n") + P0_REC
    return ["code_node_PCentry (FC without FC_GDS -> NO_WRITE; fc flag; claim wording)", "sql_node_PCp0facts (+ REC: the records' count / sum / max id)",
            "code_node_PCp0 (FC: delivery status vs the snapshot, the records fingerprint; a change -> REQUIRES_REVIEW, no unlock)",
            "code_node_PCp1merge (FC: Completed when every line is closed, else REVIEW before any write)", "code_node_PCp1check (REVIEW at once; FC read-back must be Completed)",
            "code_node_PCp4plan / code_node_PCp5build (a completed delivery skipped like a cancelled one)"]


# ------------------------------------------------------------------------------------------------- PICKING_LOOP (text patch)
# PickingLoopWorkflow.json is not Prettier-formatted: it is patched as text (its two node scripts swapped in place, one response
# field inserted) from base/PickingLoopWorkflow.v88.repo.json (the repo's file, = deployed v88), so its diff is the change only
LOOP_DECIDE = ('  } else if (Number(row.is_processing) === 1) {',
               '  } else if (row.open_job) {\n'
               '    // a background confirm / force complete (Picking V2) holds it until its job ends, however long that takes\n'
               '    lockState = 1;\n'
               '  } else if (Number(row.is_processing) === 1) {')
LOOP_FIELD = {"key": "lg4opj01", "name": "open_job", "title": "Open Job", "description": "", "bsonType": "string", "isExpand": False, "children": []}


def enc(x):
    return json.dumps(x, ensure_ascii=False)[1:-1]


def patch_loop_text(text):
    doc = json.loads(text)
    gate, decide = find(doc["nodes"], "sql_node_LockGate"), find(doc["nodes"], "code_node_LockDecide")
    old_sql, old_code = gate["data"]["script"]["code"], decide["data"]["script"]["code"]
    new_sql = code("loop_openjob.sql").rstrip("\n")
    new_code = replace_once(old_code, LOOP_DECIDE[0], LOOP_DECIDE[1], "code_node_LockDecide")
    out = replace_once(text, enc(old_sql), enc(new_sql), "sql_node_LockGate (encoded)")
    out = replace_once(out, enc(old_code), enc(new_code), "code_node_LockDecide (encoded)")
    # the new field right after lock_age_sec's entry, in the file's own indentation
    last = gate["data"]["response_json"][-1]
    assert last["name"] == "lock_age_sec" and '"key": "%s"' % LOOP_FIELD["key"] not in out
    at = out.index('"key": "%s"' % last["key"])
    start = out.rindex("{", 0, at)
    depth, i = 0, start
    while True:
        c = out[i]
        if c == '"':
            i = out.index('"', i + 1)
            while out[i - 1] == "\\":
                i = out.index('"', i + 1)
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    indent = out[out.rindex("\n", 0, start) + 1:start]
    inner = out[out.index("\n", start) + 1:]
    inner_indent = inner[:len(inner) - len(inner.lstrip(" "))]
    body = (",\n" + indent + "{\n" + ",\n".join(inner_indent + json.dumps(k) + ": " + json.dumps(v) for k, v in LOOP_FIELD.items()) + "\n" + indent + "}")
    out = out[:i + 1] + body + out[i + 1:]
    # the semantic change is exactly the two scripts and the field
    want = json.loads(text)
    find(want["nodes"], "sql_node_LockGate")["data"]["script"]["code"] = new_sql
    find(want["nodes"], "code_node_LockDecide")["data"]["script"]["code"] = new_code
    find(want["nodes"], "sql_node_LockGate")["data"]["response_json"].append(LOOP_FIELD)
    assert json.loads(out) == want, "the text patch changed more than the lock gate"
    return out, ["sql_node_LockGate (+ open_job: this Picking's open CONFIRM_PICKING job)", "code_node_LockDecide (an open job holds the Picking)",
                 "sql_node_LockGate response_json (+ open_job)"]


TEXT_PATCHES = {"LOOP": ("Picking/PickingLoopWorkflow.json", "PickingLoopWorkflow.v88.json", "PickingLoopWorkflow.v88.repo.json", patch_loop_text)}


PATCHES = {"SUBMIT": ("Picking/AsyncV2/PICKING_ASYNC_SUBMIT.json", "PICKING_ASYNC_SUBMIT.v9.json", patch_submit),
           "PREPARE": ("Picking/AsyncV2/PICKING_BULK_PREPARE.json", "PICKING_BULK_PREPARE.v10.json", patch_prepare),
           "WORKER": ("Picking/AsyncV2/PICKING_ASYNC_WORKER.json", "PICKING_ASYNC_WORKER.v3.json", patch_worker),
           "COMMIT": ("Picking/AsyncV2/PICKING_BULK_COMMIT.json", "PICKING_BULK_COMMIT.v10.json", patch_commit)}


def main():
    write = "--write" in sys.argv
    names = [a for a in sys.argv[1:] if not a.startswith("--")] or list(PATCHES) + list(TEXT_PATCHES)
    for name in [x for x in names if x in TEXT_PATCHES]:
        path, base, repo_base, fn = TEXT_PATCHES[name]
        with open(os.path.join(HERE, "base", repo_base), encoding="utf-8") as f:
            text = f.read()
        with open(os.path.join(HERE, "base", base), encoding="utf-8") as f:
            assert json.loads(f.read()) == json.loads(text), repo_base + " is not the deployed " + base
        out, changed = fn(text)
        print("%s: %s" % (name, "; ".join(changed)))
        print("   %d -> %d chars" % (len(text), len(out)))
        if write:
            with open(R + path, "w", encoding="utf-8") as f:
                f.write(out)
            print("   written")
    for name in [x for x in names if x not in TEXT_PATCHES]:
        path, base, fn = PATCHES[name]
        with open(os.path.join(HERE, "base", base), encoding="utf-8") as f:
            base_doc = json.loads(f.read())
        # --rebase: patch again from the snapshot (the repo file already carries an earlier patch)
        if "--rebase" in sys.argv:
            text = fmt(base_doc)
        else:
            with open(R + path, encoding="utf-8") as f:
                text = f.read()
        assert base_doc == json.loads(text), path + " is not the deployed version snapshotted in base/" + base + " (pull it first, or --rebase)"
        assert fmt(json.loads(text)) == text, path + " does not round-trip Prettier"
        doc = json.loads(text)
        changed = fn(doc)
        out = fmt(doc)
        keys = re.findall(r'"key": "([0-9a-z]{8})"', out)
        assert len(keys) == len(set(keys)), name + ": response keys repeat: " + ", ".join(sorted({k for k in keys if keys.count(k) > 1}))
        print("%s: %s" % (name, "; ".join(changed)))
        print("   %d -> %d chars" % (len(text), len(out)))
        if write:
            with open(R + path, "w", encoding="utf-8") as f:
                f.write(out)
            print("   written")


if __name__ == "__main__":
    main()
