"""patch_pkv2.py [--write] [SUBMIT PREPARE COMMIT]: Picking V2 stage 1c into Picking/AsyncV2's JSONs (hand-edited files: the
generator in scratchpad/gdc/pkv2tools is stale and is not used). Each changed node must still be what
scratchpad/pk1c/base/ snapshotted (the deployed dev versions of 2026-10-16); its new body comes from scratchpad/pk1c/code/.
The files round-trip Prettier (compact JSON in, --parser json), asserted before anything is changed.
Prints what changes; writes only with --write.
"""
import json
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


def base(name):
    with open(os.path.join(HERE, "base", name), encoding="utf-8") as f:
        return f.read()


def field(key, name, title, bson="string"):
    return {"key": key, "name": name, "title": title, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def swap(nodes, nid, new_body):
    n = find(nodes, nid)
    ext = "sql" if n["type"] == "sql-node" else "js"
    assert n["data"]["script"]["code"] == base(nid + "." + ext), nid + " is not the snapshotted version"
    n["data"]["script"]["code"] = new_body
    return n


def sql_like(template, nid, title, text, names):
    n = json.loads(json.dumps(template))
    n["id"] = nid
    n["blocks"] = []
    n["data"].update({"title": title, "nodeName": title, "name": title})
    n["data"]["script"] = {"type": "sql", "code": text}
    n["data"]["response_json"] = [field(k, nm, nm) for k, nm in names]
    return n


# ------------------------------------------------------------------------------------------------- SUBMIT
MOVE_FIELDS = [("psmv0kd1", "kind"), ("psmv0ri2", "row_id"), ("psmv0gd3", "gd_id"), ("psmv0mv4", "moved"), ("psmv0bb5", "bay_bad"), ("psmv0hu6", "hu"),
               ("psmv0lb7", "label"), ("psmv0dn8", "delivery_no"), ("psmv0lc9", "line_count"), ("psmv0sia", "serial_items"), ("psmv0spb", "select_picking"),
               ("psmv0lkc", "linked"), ("psmv0ojd", "other_job")]


def patch_submit(doc):
    nodes = doc["nodes"]
    g = swap(nodes, "code_node_PSguard", code("submit_guard.js"))
    names = [r["name"] for r in g["data"]["response_json"]]
    assert "moveRowsJson" not in names
    at = names.index("lineCount") + 1
    g["data"]["response_json"].insert(at, field("psgmvrws", "moveRowsJson", "The picked rows' sent targets for sql_node_PSmove (digits / null)"))
    swap(nodes, "code_node_PSdecide", code("submit_decide.js"))
    rows = code("submit_move_rows.sql").strip()
    text = code("submit_move.sql").replace("@ROWS@", rows).rstrip("\n")
    assert "@" not in text.replace("utf8mb4", "")
    facts = find(nodes, "sql_node_PSfacts")
    assert facts["data"]["script"]["code"] == base("sql_node_PSfacts.sql"), "sql_node_PSfacts is not the snapshotted version"
    lst, i = parent_of(nodes, "sql_node_PSfacts")
    assert not find(nodes, "sql_node_PSmove")
    lst.insert(i + 1, sql_like(facts, "sql_node_PSmove", "1c moves: the picked rows that move or lack a bay bin, and each moved GD's facts", text, MOVE_FIELDS))
    return ["code_node_PSguard", "code_node_PSdecide", "sql_node_PSmove (new)"]


# ------------------------------------------------------------------------------------------------- PREPARE
sys.path.insert(0, R + "scratchpad/gdc/pkv2tools")
import wfkit as K  # noqa: E402

IDS = json.load(open(os.path.join(HERE, "ids.json")))
STEP = "GD Publish Step:Table:2105131615547461634"
ORG = {"organization_id": "Organization"}
PART_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]


def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def call(ids, nid, title, wf_name, wf_id, params):
    """params: (prop, reference) or (prop, literal, "value")"""
    n = K.call(ids, nid, title, wf_name, wf_id, [(p[0], p[1]) for p in params])
    for item, p in zip(n["data"]["body_params"]["list"], params):
        if len(p) > 2:
            item["valueType"] = p[2]
    return n


def reserve_keys(doc):
    def walk(x):
        if isinstance(x, dict):
            if isinstance(x.get("key"), str):
                K._taken.add(x["key"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(doc)


def clone_to(node, new_id, src_old, src_new):
    n = json.loads(json.dumps(node).replace(src_old, src_new))
    n["id"] = new_id
    return n


def patch_prepare(doc):
    nodes = doc["nodes"]
    K._rng.seed("pk1c:PREPARE")
    reserve_keys(doc)
    ids = K.Ids(1798300000000)
    plan = swap(nodes, "code_node_PPplan", code("prepare_plan.js"))
    names = [r["name"] for r in plan["data"]["response_json"]]
    adds = [("prepared", "object"), ("moveRecords", "array"), ("moveGdLineIdsSql", "s"), ("moveBinIdsSql", "s"), ("moveBatchIdsSql", "s"), ("moveHuIdsSql", "s"),
            ("isLoadingBay", "s"), ("gdLineStatus", "object"), ("plantId", "s")]
    for name, kind in adds:
        assert name not in names, name
        plan["data"]["response_json"] += K.resp([name], arrays=(name,) if kind == "array" else (), objects=(name,) if kind == "object" else ())
    swap(nodes, "code_node_PPresult", code("prepare_result.js"))

    MOVE_F = ["route", "nonce", "gdList", "gdCalls", "alcRows", "needAlc", "lineCount", "gdCount", "result_code", "result_message"]
    MP_F = ["route", "needEngine", "operationKey", "organizationId", "movements", "counts", "gdIds", "result_code", "result_message"]
    FIN_F = ["route", "jobRows", "needJobUpd", "readyRows", "needReady", "unlockRows", "needUnlock", "result_code", "result_message", "job_status", "recordCount", "touchedRows",
             "gdLineCount"]
    sql_move = K.sql("sql_node_PPmove", "1c move: the moved GD lines + the names / plant / item of every bin, batch and HU they hold or are moved to", code("prepare_move.sql").rstrip("\n"),
                     ["kind", "id", "gd_id", "material_id", "picking_status", "temp_qty_data", "view_stock", "plant_id", "name", "line_count", "linked", "other_job"])
    node_move = K.code("code_node_PPmove", "1c move: the allocation rewritten as classic PICKING does (targets checked), one GD_REPLAN call per moved GD, ALC parts",
                       code("move.js") + "\n" + code("prepare_move_tail.js"), MOVE_F, arrays=("gdList", "gdCalls", "alcRows"), objects=("lineCount", "gdCount"))
    add_alc = K.when_yes(ids, "cor_PPalc", "New allocations to keep for COMMIT?", "node.code_node_PPmove.data.needAlc", "needAlc", [
        K.add(ids, "add_node_PPalc", "1c ALC parts: gd_publish_step MV|<nonce>|ALC|000|<nnn> (the moved lines before / after)", STEP,
              [(p, N("code_node_PPmove", "data.alcRows." + p)) for p in PART_PROPS], ORG)])
    loop = K.loop(ids, "loop_PPreplan", "Loop: each moved GD re-planned (GD_REPLAN), checked, written as parts", N("code_node_PPmove", "data.gdCalls"), [
        call(ids, "workflow_node_PPreplan", "GD_REPLAN: GOODS_DELIVERY's Save as Created from PICKING for this GD (writes nothing)", "GD_REPLAN", IDS["GD_REPLAN"], [
            ("gd_id", N("loop_PPreplan", "gd_id")), ("organization_id", N("code_node_PPentry", "data.organizationId")),
            ("is_loading_bay", N("code_node_PPplan", "data.isLoadingBay")), ("lines", N("loop_PPreplan", "lines"))]),
        K.code("code_node_PPrpcheck", "1c check: the re-plan against the new allocation; keys made unique in the job; VERDICT (+ ENG, RES) part rows", code("prepare_rpcheck.js"),
               ["verdict", "partRows"], arrays=("partRows",)),
        K.add(ids, "add_node_PPparts", "1c parts: gd_publish_step MV|<nonce>|VRD / ENG / RES|<gi>|<nnn>", STEP,
              [(p, N("code_node_PPrpcheck", "data.partRows." + p)) for p in PART_PROPS], ORG)])
    sql_parts = K.sql("sql_node_PPmvparts", "1c parts read back (every moved GD's verdict, movements, reservations)", code("prepare_parts.sql").rstrip("\n"), ["step_name", "result_ref"])
    node_mp = K.code("code_node_PPmoveplan", "1c move plan: every GD OK, no reservation planned twice, the job's movements", code("prepare_moveplan.js"), MP_F,
                     arrays=("movements", "gdIds"), objects=("counts",))
    engine = K.when_yes(ids, "cor_PPengine", "Stock to move? INVENTORY_BULK_APPLY in PLAN mode (writes nothing)", "node.code_node_PPmoveplan.data.needEngine", "needEngine", [
        call(ids, "workflow_node_PPengine", "INVENTORY_BULK_APPLY PLAN: the move's stock movements checked as one operation", "INVENTORY_BULK_APPLY", IDS["INVENTORY_BULK_APPLY"], [
            ("operation_key", N("code_node_PPmoveplan", "data.operationKey")), ("mode", "PLAN", "value"), ("organization_id", N("code_node_PPmoveplan", "data.organizationId")),
            ("movements", N("code_node_PPmoveplan", "data.movements"))])])
    ok_block = K.if_(ids, "if_PPmoveOk", "IF the moved lines were rewritten: re-plan each GD, check the stock", "'%s' == 'OK'" % N("code_node_PPmove", "data.route"),
                     [add_alc, loop, sql_parts, node_mp, engine])
    node_fin = K.code("code_node_PPfinal", "1c final: READY_TO_COMMIT with the move, or FAILED + the Picking unlocked", code("prepare_final.js"), FIN_F,
                      arrays=("jobRows", "readyRows", "unlockRows"), objects=("recordCount", "touchedRows", "gdLineCount"))
    gates = []
    for flag, src, nid in (("needReady", "update_node_PPready", "update_node_PPmvReady"), ("needJobUpd", "update_node_PPfail", "update_node_PPmvFail"),
                           ("needUnlock", "update_node_PPunlock", "update_node_PPmvUnlock")):
        orig = find(nodes, src)
        n = clone_to(orig, nid, "code_node_PPplan", "code_node_PPfinal")
        gates.append(K.when_yes(ids, "cor_" + nid[len("update_node_"):], orig["data"]["title"] + " (1c move)", "node.code_node_PPfinal.data." + flag, flag, [n]))
    block = K.if_(ids, "if_PPmove", "IF the pick moves stock (1c): re-plan the moved GDs before anything is written", "'%s' == 'MOVE'" % N("code_node_PPplan", "data.route"),
                  [sql_move, node_move, ok_block, node_fin] + gates)
    lst, i = parent_of(nodes, "cor_PPunlock")
    assert lst[i + 1]["id"] == "sql_node_PPback", lst[i + 1]["id"]
    assert not find(nodes, "if_PPmove")
    lst.insert(i + 1, block)
    return ["code_node_PPplan", "code_node_PPresult", "if_PPmove (new: " + ", ".join(n["id"] for n in [sql_move, node_move, ok_block, node_fin] + gates) + ")"]


# ------------------------------------------------------------------------------------------------- COMMIT
RESV = "On Reserved Goods Delivery:Table:1935880014687440897"
GDLT = "goods_delivery_fwii8mvb_sub:Table:1939904186426433537"
PM_RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"]
PM_RES_CREATE_COLS = ["doc_type", "status", "parent_id", "parent_line_id", "parent_no", "doc_no", "doc_id", "doc_line_id", "material_id", "item_code", "item_name", "item_desc",
                      "batch_id", "bin_location", "item_uom", "reserved_qty", "delivered_qty", "open_qty", "reserved_date", "line_no", "plant_id", "organization_id", "remark",
                      "target_gd_id", "source_reserved_id", "handling_unit_id", "job_line_key"]
END_F = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "waitRows", "needWait", "result_code", "result_message", "job_status"]
END_A = ("stepRows", "jobRows", "unlockRows", "waitRows")
RES_F = ["publish_route", "job_id", "job_status", "result_code", "result_message", "evidence"]


def result_node(nid, path, src, steps):
    lines = ["// PICKING_BULK_COMMIT - Result (%s)" % path,
             'const T = (v) => String(v === undefined || v === null ? "" : v).replace(/^\\"([\\s\\S]*)\\"$/, "$1").trim();', "const steps = {};"]
    for k, n in steps:
        lines.append("steps.%s = T([{{node:%s.data.route}}][0]);" % (k, n))
    lines += ["const d0 = [{{node:%s.data}}][0];" % src, "const d = (Array.isArray(d0) ? d0[0] : d0) || {};",
              'return { publish_route: "%s", job_id: [{{node:code_node_PCguard.data.jobId}}][0], job_status: T(d.job_status), result_code: T(d.result_code) || T(d.error_code), '
              'result_message: T(d.result_message), evidence: JSON.stringify({ v: 1, workflow: "PICKING_BULK_COMMIT", path: "%s", steps: steps }) };' % (path, path)]
    return K.code(nid, "Result (%s)" % path, "\n".join(lines), RES_F)


def end_branch(ids, nodes, tag, src, path, steps, unlock=False, wait=False):
    job = clone_to(find(nodes, "update_node_PCp1job"), "update_node_PC%sjob" % tag, "code_node_PCp1check", src)
    out = [K.when_yes(ids, "cor_PC%sjob" % tag, "Job row to write?", "node.%s.data.needJobUpd" % src, "needJobUpd", [job])]
    if unlock:
        un = clone_to(find(nodes, "update_node_PCp0unlock"), "update_node_PC%sunlock" % tag, "code_node_PCp0", src)
        out.append(K.when_yes(ids, "cor_PC%sunlock" % tag, "Picking lock to release?", "node.%s.data.needUnlock" % src, "needUnlock", [un]))
    if wait:
        w = clone_to(find(nodes, "add_node_PCp1step"), "add_node_PC%swait" % tag, "code_node_PCp1check", src)
        w = json.loads(json.dumps(w).replace(src + ".data.stepRows", src + ".data.waitRows"))
        w["data"].update({"title": "PM1_WAIT|<n>: a lock wait counted", "nodeName": "PM1_WAIT|<n>: a lock wait counted", "name": "PM1_WAIT|<n>: a lock wait counted"})
        out.append(K.when_yes(ids, "cor_PC%swait" % tag, "A lock wait to count?", "node.%s.data.needWait" % src, "needWait", [w]))
    rn = "code_node_PC%sres" % tag
    out += [result_node(rn, path, src, steps), K.ret("return_node_PC%s" % tag, "Return (%s)" % path, [(f, N(rn, "data." + f)) for f in RES_F])]
    return out


def step_add(ids, nodes, tag, src, step):
    a = clone_to(find(nodes, "add_node_PCp1step"), "add_node_PC%sstep" % tag, "code_node_PCp1check", src)
    a["data"].update({"title": step + " DONE", "nodeName": step + " DONE", "name": step + " DONE"})
    return K.when_yes(ids, "cor_PC%sstep" % tag, step + " DONE to record?", "node.%s.data.needStep" % src, "needStep", [a])


def slice_loop(ids, tag, src, table, cols, title):
    loop_id, sl = "loop_PC%s" % tag, "code_node_PC%sslice" % tag
    return K.loop(ids, loop_id, title, N(src, "data.slices"), [
        K.code(sl, "This slice (the loop item: <= 250 rows)", code("commit_slice.js").replace("__LOOP__", loop_id), ["n", "rows"], arrays=("rows",), objects=("n",)),
        K.update(ids, "update_node_PC%swrite" % tag, title + " (<= 250 per call)", table, ("id", "in", N(sl, "data.rows.id")), [(c, N(sl, "data.rows." + c)) for c in ["id"] + cols])])


def patch_commit(doc):
    nodes = doc["nodes"]
    K._rng.seed("pk1c:COMMIT")
    reserve_keys(doc)
    ids = K.Ids(1798400000000)
    ent = swap(nodes, "code_node_PCentry", code("commit_entry.js"))
    names = [r["name"] for r in ent["data"]["response_json"]]
    for name in ["needMove", "needPM1", "needPM2", "needPM3", "moveNonce", "moveOpKey", "hasMovements", "pm1Waits"]:
        assert name not in names, name
        ent["data"]["response_json"] += K.resp([name], objects=("pm1Waits",) if name == "pm1Waits" else ())
    common = code("commit_pm_common.js")
    E = "code_node_PCentry"
    is_yes = lambda field: "'%s' == 'YES'" % N(E, "data." + field)
    is_end = lambda node: "'%s' == 'END'" % N(node, "data.route")
    rows_sql = lambda *parts: "\nUNION ALL\n".join(code(x).rstrip("\n") for x in parts)
    # each PM node gets only the parts it reads (never the movements, which go from the parse node to the engine call)
    mvp_of = lambda keys: "{ " + ", ".join("%s: [{{node:code_node_PCmvparse.data.%s}}][0]" % (k, k) for k in keys) + " }"
    pm2_tail = lambda fn, facts, keys: "const res = %s([{{node:code_node_PCentry.data}}][0], %s, [{{node:%s.data}}][0]);\nconsole.log(%s, JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));\nreturn res;" % (fn, mvp_of(keys), facts, json.dumps(fn))
    steps_base = [("guard", "code_node_PCguard"), ("entry", E), ("own", "code_node_PCown")]

    load = K.if_(ids, "if_PCmv", "IF a move step is due: its parts (movements, reservation writes, the lines' allocation)", is_yes("needMove"), [
        K.sql("sql_node_PCmvparts", "1c move parts (PREPARE's, by the payload's nonce)", code("commit_mvparts.sql").rstrip("\n"), ["step_name", "result_ref"]),
        K.code("code_node_PCmvparse", "1c move parts read: movements, reservation writes, allocation before / after", common + "\n" + code("commit_mvparse.js"),
               ["ok", "movements", "res", "alc", "resIdsJson", "lineIdsJson", "counts", "why"], arrays=("movements", "alc"), objects=("res", "counts"))])

    pm1_in_f = END_F + ["needCall", "operationKey", "organizationId", "intents"]
    pm1 = K.if_(ids, "if_PCpm1", "IF PM1 STOCK is due", is_yes("needPM1"), [
        K.sql("sql_node_PCpm1facts", "PM1 facts: the reservations and lines the move changes, as they are now + the operation's intent rows", rows_sql("commit_res_rows.sql", "commit_line_rows.sql", "commit_intent_rows.sql"), ["k", "j"]),
        K.code("code_node_PCpm1in", "PM1 in: still as PREPARE read them? -> the call; stale -> FAILED + unlock (no intent yet) / review", common + "\n" + code("commit_pm1in.js"), pm1_in_f,
               arrays=END_A, objects=("intents",)),
        K.if_(ids, "if_PCpm1stale", "IF the move went stale before the stock moved", is_end("code_node_PCpm1in"),
              end_branch(ids, nodes, "pm1s", "code_node_PCpm1in", "PM1_STALE", steps_base + [("pm1in", "code_node_PCpm1in")], unlock=True)),
        K.when_yes(ids, "cor_PCpm1call", "Stock to move?", "node.code_node_PCpm1in.data.needCall", "needCall", [
            call(ids, "workflow_node_PCpm1", "INVENTORY_BULK_APPLY APPLY PKM|<job>: the move's stock, all or nothing (a re-run replays it)", "INVENTORY_BULK_APPLY", IDS["INVENTORY_BULK_APPLY"], [
                ("operation_key", N("code_node_PCpm1in", "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N("code_node_PCpm1in", "data.organizationId")),
                ("movements", N("code_node_PCmvparse", "data.movements"))])]),
        K.code("code_node_PCpm1check", "PM1 STOCK: the engine's answer -> DONE / wait (PM1_WAIT) / FAILED + unlock / retry / review", common + "\n" + code("commit_pm1check.js"), END_F, arrays=END_A),
        K.if_(ids, "if_PCpm1end", "IF PM1 did not complete", is_end("code_node_PCpm1check"),
              end_branch(ids, nodes, "pm1", "code_node_PCpm1check", "PM1_END", steps_base + [("pm1in", "code_node_PCpm1in"), ("pm1", "code_node_PCpm1check")], unlock=True, wait=True)),
        step_add(ids, nodes, "pm1", "code_node_PCpm1check", "PM1_STOCK")])

    pm2_sql = rows_sql("commit_res_rows.sql", "commit_create_rows.sql")
    pm2 = K.if_(ids, "if_PCpm2", "IF PM2 RESERVATIONS is due", is_yes("needPM2"), [
        K.sql("sql_node_PCpm2facts", "PM2 facts: the reservations the move changes + this job's creates", pm2_sql, ["k", "j"]),
        K.code("code_node_PCpm2plan", "PM2 plan: at before -> write, at after -> done, else review; creates once", common + "\n" + code("commit_pm2.js") + "\n" + pm2_tail("commitPM2Plan", "sql_node_PCpm2facts", ["ok", "why", "res"]),
               END_F + ["slices", "writeCount", "createRows", "needCreates"], arrays=END_A + ("slices", "createRows"), objects=("writeCount",)),
        K.if_(ids, "if_PCpm2stop", "IF a reservation changed meanwhile", is_end("code_node_PCpm2plan"),
              end_branch(ids, nodes, "pm2s", "code_node_PCpm2plan", "PM2_STOP", steps_base + [("pm2", "code_node_PCpm2plan")])),
        slice_loop(ids, "pm2", "code_node_PCpm2plan", RESV, PM_RES_COLS, "PM2 WRITE: reservations (the classic update node's columns)"),
        K.when_yes(ids, "cor_PCpm2add", "Reservations to create?", "node.code_node_PCpm2plan.data.needCreates", "needCreates", [
            K.add(ids, "add_node_PCpm2add", "PM2 WRITE: new reservations (job_line_key <job>|R|<gi>.<k>)", RESV, [(c, N("code_node_PCpm2plan", "data.createRows." + c)) for c in PM_RES_CREATE_COLS])]),
        K.sql("sql_node_PCpm2back", "PM2 read-back: the reservations + this job's creates", pm2_sql, ["k", "j"]),
        K.code("code_node_PCpm2check", "PM2 check: every update at its target, every create once -> DONE; else retry / review", common + "\n" + code("commit_pm2.js") + "\n" + pm2_tail("commitPM2Check", "sql_node_PCpm2back", ["ok", "why", "res"]),
               END_F, arrays=END_A),
        K.if_(ids, "if_PCpm2end", "IF PM2 did not complete", is_end("code_node_PCpm2check"),
              end_branch(ids, nodes, "pm2", "code_node_PCpm2check", "PM2_END", steps_base + [("pm2", "code_node_PCpm2check")])),
        step_add(ids, nodes, "pm2", "code_node_PCpm2check", "PM2_RESERVATIONS")])

    pm3_sql = code("commit_line_rows.sql").rstrip("\n")
    pm3 = K.if_(ids, "if_PCpm3", "IF PM3 GD ALLOCATION is due", is_yes("needPM3"), [
        K.sql("sql_node_PCpm3facts", "PM3 facts: the moved delivery lines now + the move's reservations (PM2's result must still stand)",
              rows_sql("commit_res_rows.sql", "commit_create_rows.sql", "commit_line_rows.sql"), ["k", "j"]),
        K.code("code_node_PCpm3plan", "PM3 plan: at before -> the new allocation, at the new one -> done, else review", common + "\n" + code("commit_pm3.js") + "\n" + pm2_tail("commitPM3Plan", "sql_node_PCpm3facts", ["ok", "why", "alc", "res"]),
               END_F + ["slices", "writeCount"], arrays=END_A + ("slices",), objects=("writeCount",)),
        K.if_(ids, "if_PCpm3stop", "IF a moved line changed meanwhile", is_end("code_node_PCpm3plan"),
              end_branch(ids, nodes, "pm3s", "code_node_PCpm3plan", "PM3_STOP", steps_base + [("pm3", "code_node_PCpm3plan")])),
        slice_loop(ids, "pm3", "code_node_PCpm3plan", GDLT, ["temp_qty_data", "view_stock", "prev_temp_qty_data"], "PM3 WRITE: the moved lines' allocation"),
        K.sql("sql_node_PCpm3back", "PM3 read-back: the moved delivery lines", pm3_sql, ["k", "j"]),
        K.code("code_node_PCpm3check", "PM3 check: every moved line holds its new allocation -> DONE; else retry", common + "\n" + code("commit_pm3.js") + "\n" + pm2_tail("commitPM3Check", "sql_node_PCpm3back", ["ok", "why", "alc"]),
               END_F, arrays=END_A),
        K.if_(ids, "if_PCpm3end", "IF PM3 did not complete", is_end("code_node_PCpm3check"),
              end_branch(ids, nodes, "pm3", "code_node_PCpm3check", "PM3_END", steps_base + [("pm3", "code_node_PCpm3check")])),
        step_add(ids, nodes, "pm3", "code_node_PCpm3check", "PM3_GD_ALLOC")])

    lst, i = parent_of(nodes, "if_PCp0")
    assert lst[i + 1]["id"] == "if_PCp1", lst[i + 1]["id"]
    assert not find(nodes, "if_PCpm1")
    lst[i + 1:i + 1] = [load, pm1, pm2, pm3]
    return ["code_node_PCentry", "if_PCmv, if_PCpm1, if_PCpm2, if_PCpm3 (new)"]


PATCHES = {"SUBMIT": ("Picking/AsyncV2/PICKING_ASYNC_SUBMIT.json", patch_submit), "PREPARE": ("Picking/AsyncV2/PICKING_BULK_PREPARE.json", patch_prepare),
           "COMMIT": ("Picking/AsyncV2/PICKING_BULK_COMMIT.json", patch_commit)}

if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")] or list(PATCHES)
    write = "--write" in sys.argv
    for name in want:
        path, fn = PATCHES[name]
        raw = open(R + path, encoding="utf-8").read()
        doc = json.loads(raw)
        assert fmt(doc) == raw, path + ": the printer does not round-trip the file"
        changed = fn(doc)
        out = fmt(doc)
        print(name, "->", ", ".join(changed), "| %d -> %d chars" % (len(raw), len(out)))
        if write:
            open(R + path, "w", encoding="utf-8").write(out)
    print("written" if write else "dry run (--write to save)")
