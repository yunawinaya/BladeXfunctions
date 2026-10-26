"""Builds GD Cancel V2's workflows - GD_CANCEL_PREPARE, GD_CANCEL_COMMIT, GD_CANCEL_WORKER, GD_CANCEL_SUBMIT - as FlowGram JSON with
GD Completed V2's wfkit (scratchpad/gdc/pkv2tools/wfkit.py, imported by path, unchanged) into Goods Delivery/CancelV2/.
Step code: code/{prepare,commit,submit,worker}/*.js. Read live from scratchpad/gdc (unchanged by this build): the lift (runtime.js,
lifted_prepare.js / lifted_commit.js = GOODS_DELIVERY v245 + GD_UNUSED_FN_NEW v55, pinned: gde/lift/check_fresh.sh), prepare/
adapter.js, prepare/chain.js (gcGdWrite, gcAfterImage), _fc.js (fcBusy), prepare/sql.py (via prepare/sql.py here), engine/core.js.
Published with .dbtools/wf_upload.mjs (a compile-made sql-node never runs).

usage: python3 build_gdcan.py [--write] [NAME ...]
"""
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
GDC = R + "scratchpad/gdc/"
sys.path.insert(0, GDC + "pkv2tools")
import wfkit as K  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


PSQL = _load("gdcan_prepare_sql", os.path.join(HERE, "prepare", "sql.py")).SQL
_BGDC = _load("gdcan_build_gdc", GDC + "build_gdc.py")
wrap_doc_sql, keep_published, engine_fn_src = _BGDC.wrap_doc_sql, _BGDC.keep_published, _BGDC.engine_fn
OUT = R + "Goods Delivery/CancelV2/"
WRITE = "--write" in sys.argv
IDS = json.load(open(OUT + "ids.json")) if os.path.exists(OUT + "ids.json") else {}
FIELDS = json.load(open(GDC + "lift/fields.json"))
KINDS = {"header": FIELDS["goods_delivery"], "line": FIELDS["goods_delivery_fwii8mvb_sub"]}

JOB = "GD Async Job:Table:2104845286495150081"
STEP = "GD Publish Step:Table:2105131615547461634"
GD = "Goods Delivery:Table:1902054888473481218"
GDL = "goods_delivery_fwii8mvb_sub:Table:1939904186426433537"
RESV = "On Reserved Goods Delivery:Table:1935880014687440897"
SOL = "sales_order_axszx8cj_sub:Table:1939903359943024642"
SOH = "Sales Order:Table:1902773735979597826"
ITEM = "Item:Table:1901546842240438273"
HU = "Handling Unit:Table:2036736671686529026"
PKH = "Transfer Order Picking:Table:1935556443668959233"
PKL = "transfer_order_jz8m9w3h_sub:Table:1939915130724524033"
PACKH = "Packing:Table:1993515601863524353"
PACKL = "packing_jz8m9w3h_sub:Table:1993584505721864194"
PACKS = "packing_mudjw4xk_sub:Table:2045094034631213057"
PACKU = "packing_hr4nq20g_sub:Table:1993956081773305857"
MOVE = "Inventory Movement:Table:1902259348776800257"
ENGINE = ("INVENTORY_BULK_APPLY", "2109916822821744641")
REORDER = ("REORDER_SET_REDIS", "2065256261729759233")
REPACK = ("REPACKING_PROCESS", "2043602532898443266")
JOB_PROPS = ["id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "row_version", "error_code", "error_message", "error_details", "finished_at"]
STEP_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "finished_at", "inventory_operation_id", "result_ref",
              "error_code", "error_message"]
ORG = {"organization_id": "Organization"}


def wf_id(name):
    return IDS.get(name, "0")


# ------------------------------------------------------------------------------------------------- helpers (gdc's)
def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def int_out(node, *names):
    for e in node["data"]["response_json"]:
        if e["name"] in names:
            e["bsonType"] = "int"
    return node


def try_catch(nid, title, try_nodes, catch_title, catch_nodes):
    """the try-catch as the designer saves it (GD_BULK_COMMIT prod v31: no block keys, no try-block data; catch-all: Filter, empty list)"""
    return {"id": nid, "type": "tryCatch", "data": {"title": title},
            "blocks": [{"type": "tryBlock", "id": nid + "_tryBlock_0", "blocks": try_nodes},
                       {"type": "catchBlock",
                        "data": {"title": catch_title, "trycatch_type": "Filter", "filter": {"list": []},
                                 "expression": {"type": "javascript", "code": ""}, "displayContent": "sdk.form.setCondition"},
                        "id": nid + "_catchBlock_1", "blocks": catch_nodes}]}


ENGINE_CRASH_JS = ('// %s - the INVENTORY_BULK_APPLY call failed (caught, 2026-10-27): %s decides from the intent rows - a counted\n'
                   '// retry with the lease released, instead of a crash that leaves the job leased 30 min (10-26: Kenhin GD 2097, LSH GD-2610-1473)\n'
                   'console.log("inventory call failed (caught): %s decides from the intent rows");\n'
                   'return { crashed: "YES" };')


def raw(path):
    with open(path, encoding="utf-8") as f:
        return f.read().rstrip("\n")


def mine(path):
    return raw(os.path.join(HERE, "code", path))


def gdc(path):
    return raw(GDC + path)


def is_(node, field, value):
    return "'%s' == '%s'" % (N(node, "data." + field), value)


def gate(ids, nid, title, src, flag, nodes):
    return K.when_yes(ids, nid, title, "node.%s.data.%s" % (src, flag), flag, nodes)


def call(ids, nid, title, wf, params):
    """params: (prop, value) references, or (prop, value, "value") literals"""
    n = K.call(ids, nid, title, wf[0], wf[1], [(p[0], p[1]) for p in params])
    for item, p in zip(n["data"]["body_params"]["list"], params):
        if len(p) > 2:
            item["valueType"] = p[2]
    return n


def job_update(ids, nid, title, src, field, props=JOB_PROPS):
    return K.update(ids, nid, title, JOB, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in props])


def unlock_update(ids, nid, src, field="unlockRows", title="Goods Delivery back to Created (nothing was written)"):
    return K.update(ids, nid, title, GD, ("id", "in", N(src, "data.%s.id" % field)),
                    [("id", N(src, "data.%s.id" % field)), ("gd_status", N(src, "data.%s.gd_status" % field))], labels={"gd_status": "GD Status"})


def step_add(ids, nid, title, src, field):
    return K.add(ids, nid, title, STEP, [(p, N(src, "data.%s.%s" % (field, p))) for p in STEP_PROPS], labels=ORG)


def lifted_ok(text):
    assert "{{" not in text, "a lifted body still holds a platform token"
    return text


def kinds_js():
    return "const GC_KINDS = " + json.dumps(KINDS, separators=(",", ":")) + ";"


# ============================================================================================== GD_CANCEL_PREPARE
PE = "code_node_XPentry"


def prepare_sql(k):
    return PSQL[k].replace("code_node_GCentry", PE)


def plan_code():
    return "\n".join([gdc("lift/runtime.js"), lifted_ok(gdc("lift/lifted_prepare.js")), gdc("code/prepare/adapter.js"), gdc("code/prepare/chain.js"), gdc("code/_fc.js"),
                      mine("prepare/chain.js"), mine("prepare/plan.js"), kinds_js(), mine("prepare/plan_tail.js")])


def build_prepare():
    ids = K.Ids(1798500000000)
    G, E, P, RD = "code_node_XPguard", PE, "code_node_XPplan", "code_node_XPready"
    T = N(G, "data.tenantId")
    job = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       j.command,
       j.job_status,
       j.lease_owner,
       (j.lease_expires_at > n.t) AS lease_live,
       j.row_version,
       j.attempt_count,
       j.idempotency_key,
       j.correlation_id,
       j.request_payload,
       j.is_deleted
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '%s'
   AND j.id = %s""" % (T, N(G, "data.jobId"))
    back = """SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_message,
       j.error_code,
       j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id = %s""" % (T, N(G, "data.jobId"))
    res_fields = ["job_id", "job_status", "result_code", "result_message", "evidence"]
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], "
                "evidence: JSON.stringify({ v: 1, workflow: \"GD_CANCEL_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(G, "data.result_code"), N(G, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"GD_CANCEL_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    reads = [
        ("hdr", "The Goods Delivery (every schema field, one JSON object)", ["j"]),
        ("lines", "Its lines, top-level and bundle items (parent_id), in id order", ["j"]),
        ("setup", "Picking Setup + Packing Setup of the organization", ["k", "j"]),
        ("link", "Internal-trading links of its Sales Orders", ["j"]),
        ("items", "Items of its lines: the GOODS_DELIVERY and GD_UNUSED_FN_NEW item reads in one", ["j"]),
        ("sohl", "Sales Order lines (its SOs + any line it points at), the columns the SO nodes read", ["j"]),
        ("soh", "Its Sales Orders (status columns)", ["j"]),
        ("alloc", "on_reserved_gd Allocated to it (no row limit)", ["j"]),
        ("pend", "on_reserved_gd Pending for its materials and SO lines (no row limit)", ["j"]),
        ("top", "The Pickings of its lines (line_to_id)", ["j"]),
        ("topr", "Their picking records", ["j"]),
        ("lock", "Its latest lock (GDC|<gd>: GD_CANCEL_SUBMIT's)", ["step_name", "result_ref"]),
        ("pick", "The Pickings that name it (header gd_no or a row's gd_id) and their rows", ["k", "j"]),
        ("pack", "Its Packings with their item, source and box rows, the mobile lease", ["k", "j"]),
        ("box", "The handling units of those boxes and their stored items", ["k", "j"]),
    ]
    sql_nodes = [("cai_XP" + k, k, [K.sql("sql_node_XP" + k, title, prepare_sql(k), cols)]) for k, title, cols in reads]
    plan_fields = ["route", "code", "message", "operationKey", "organizationId", "movements", "payload", "partRows", "lineCount", "movementCount", "gdId", "unlockOk"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message", "job_status"]
    nodes = [
        K.code(G, "Guard: job_id (digits), session tenant", mine("prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_XPreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_XPrej", "Answer (rejected input)", rej_body, res_fields),
            K.ret("return_node_XPrej", "Return (rejected input)", [(f, N("code_node_XPrej", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_XPjob", "The job (+ DB clock, lease flag, request)", job,
              ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key",
               "correlation_id", "request_payload", "is_deleted"]),
        K.code(E, "Entry: a VALIDATING CANCEL_GD job under a live lease; its request -> the GD", mine("prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "gdId", "idempotencyKey", "rowVersion", "dbNow", "jsAt", "nonce", "request", "result_code", "result_message"],
               objects=("request", "rowVersion")),
        K.if_(ids, "if_XPnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(E, "route", "NOOP"), [
            K.code("code_node_XPnoop", "Answer (not prepared)", noop_body, res_fields),
            K.ret("return_node_XPnoop", "Return (not prepared)", [(f, N("code_node_XPnoop", "data." + f)) for f in res_fields]),
        ]),
        K.parallel("condition_all_XPread", "Set-based reads in parallel (no row limits)", sql_nodes),
        K.code(P, "Plan: the GD before the lock -> GOODS_DELIVERY's cancel + GD_UNUSED_FN_NEW's planner (lifted) -> movements, payload parts (stock, reservations, SO, GD, Pickings, Packings, boxes, numbers)",
               plan_code(), plan_fields, arrays=("movements", "partRows"), objects=("lineCount", "movementCount", "unlockOk")),
        K.if_(ids, "if_XPengine", "IF there is stock to release: INVENTORY_BULK_APPLY in PLAN mode (writes nothing)", is_(P, "route", "ENGINE"), [
            call(ids, "workflow_node_XPengine", "INVENTORY_BULK_APPLY PLAN: every movement priced, the operation checked as a whole", ENGINE, [
                ("operation_key", N(P, "data.operationKey")), ("mode", "PLAN", "value"), ("organization_id", N(P, "data.organizationId")),
                ("movements", N(P, "data.movements"))]),
        ]),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ GD back to Created when this job holds its lock)", mine("prepare/ready.js"),
               ready_fields, arrays=("readyRows", "jobRows", "unlockRows")),
        gate(ids, "cor_XPparts", "Payload parts to write?", RD, "needParts", [
            K.add(ids, "add_node_XPparts", "Payload parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", STEP,
                  [(p, N(P, "data.partRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]], labels=ORG),
        ]),
        gate(ids, "cor_XPready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_XPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code",
                                                                  "error_message", "error_details", "prepared_payload", "line_count"]]),
        ]),
        gate(ids, "cor_XPfail", "Job FAILED to write?", RD, "needJobUpd", [job_update(ids, "update_node_XPfail", "Job FAILED with the reason (lease released)", RD, "jobRows")]),
        gate(ids, "cor_XPunlock", "GD lock to release?", RD, "needUnlock", [unlock_update(ids, "update_node_XPunlock", RD)]),
        K.sql("sql_node_XPback", "Read-back: the job after the write (the truth)", back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
        K.code("code_node_XPresult", "Result", mine("prepare/result.js"), res_fields),
        K.ret("return_node_XPdone", "Return", [(f, N("code_node_XPresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a CANCEL_GD job the worker holds")], res_fields, nodes)


# =============================================================================================== GD_CANCEL_COMMIT
CG, CE = "code_node_XCguard", "code_node_XCentry"
RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"]
CREATE_COLS = ["doc_type", "status", "parent_id", "parent_line_id", "parent_no", "doc_no", "doc_id", "doc_line_id", "material_id", "item_code", "item_name", "item_desc",
               "batch_id", "bin_location", "item_uom", "reserved_qty", "delivered_qty", "open_qty", "reserved_date", "line_no", "plant_id", "organization_id", "remark",
               "target_gd_id", "source_reserved_id", "handling_unit_id", "job_line_key"]
GX_LINE_COLS = ["prev_temp_qty_data", "customer_id", "organization_id", "plant_id", "billing_state_id", "billing_country_id", "shipping_state_id",
                "shipping_country_id", "assigned_to", "area_id", "line_index", "gd_undelivered_qty", "packing_qty", "net_weight", "picking_status", "packing_status"]
RES_FIELDS = ["job_id", "job_status", "path", "result_code", "result_message", "evidence"]
RESULT_JS = "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\n"


def engine_fn(name):
    m = re.search(r"^function %s\(.*?^}\n" % name, gdc("engine/core.js") + "\n", re.S | re.M)
    assert m, "engine/core.js has no function " + name
    return m.group(0).rstrip("\n")


def cc(mods, tail=""):
    """a COMMIT code node: the shared helpers, the modules (code/commit/<x>.js, gdc:<path>, engine:<fn>), a tail binding the refs"""
    inc = lambda x: engine_fn(x[7:]) if x.startswith("engine:") else lifted_ok(gdc(x[4:])) if x.startswith("gdc:") else mine("commit/" + x)
    return "\n".join([mine("commit/_common.js"), mine("commit/_cmp.js")] + [inc(x) for x in mods] + ([tail] if tail else []))


def ctail(fn_call, log):
    return "const res = %s;\nconsole.log(%s, JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));\nreturn res;" % (fn_call, json.dumps(log))


def cres(tag, src, path):
    body = RESULT_JS + mine("commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [K.code("code_node_XC%sres" % tag, "Result (%s)" % path, body, RES_FIELDS),
            K.ret("return_node_XC%s" % tag, "Return (%s)" % path, [(f, N("code_node_XC%sres" % tag, "data." + f)) for f in RES_FIELDS])]


def end_block(ids, tag, src, title, unlock=False):
    nodes = [gate(ids, "cor_XC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
        job_update(ids, "update_node_XC%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW / FAILED (lease released)", src, "jobRows")])]
    if unlock:
        nodes.append(gate(ids, "cor_XC%sunlock" % tag, "GD lock to release?", src, "needUnlock", [unlock_update(ids, "update_node_XC%sunlock" % tag, src)]))
    nodes += cres(tag, src, tag.upper() + "_END")
    return K.if_(ids, "if_XC%send" % tag, title, is_(src, "route", "END"), nodes)


def step_done(ids, tag, src, step):
    return gate(ids, "cor_XC%sstep" % tag, "%s DONE to record?" % step, src, "needStep", [
        K.add(ids, "add_node_XC%sstep" % tag, "%s DONE (unique job / step)" % step, STEP, [(p, N(src, "data.stepRows." + p)) for p in STEP_PROPS], labels=ORG)])


LANES = 12
LANE_IDS = K.Ids(1798660000000)  # its own range: the published nodes keep their filter ids


def slice_loop(ids, tag, src, field, title, table, props, labels=None):
    # update-nodes write row by row (~46 ms a row on dev): the first LANES slices go to parallel lanes, the rest to the loop (10-22)
    loop_id = "loop_XC%s" % tag
    sl = "code_node_XC%sslice" % tag
    ln = "code_node_XC%slanes" % tag
    body = mine("commit/slice.js").replace("__LOOP__", loop_id)
    lanes = mine("commit/lanes.js").replace("__SRC__", "%s.data.%s" % (src, field)).replace("__LANES__", str(LANES))
    lane_names = ["lane%d" % k for k in range(LANES)]
    lane = lambda k: K.update(LANE_IDS, "update_node_XC%sl%d" % (tag, k), "%s (lane %d)" % (title, k), table, ("id", "in", N(ln, "data.lane%d.id" % k)),
                              [(p, N(ln, "data.lane%d.%s" % (k, p))) for p in ["id"] + props], labels)
    return [
        K.code(ln, "Lanes of %s: the first %d slices in parallel, the rest in the loop" % (tag, LANES), lanes,
               ["rest", "hasRest", "count"] + lane_names + ["has%d" % k for k in range(LANES)], arrays=tuple(["rest"] + lane_names)),
        K.parallel("cond_all_XC%sl" % tag, "%s: %d parallel lanes" % (title, LANES),
                   [("cai_XC%sl%d" % (tag, k), "Lane %d" % k, [K.when_yes(LANE_IDS, "cor_XC%sl%d" % (tag, k), "Lane %d has rows?" % k, "node.%s.data.has%d" % (ln, k), "has%d" % k, [lane(k)])])
                    for k in range(LANES)]),
        K.when_yes(LANE_IDS, "cor_XC%slrest" % tag, "Slices past lane %d?" % (LANES - 1), "node.%s.data.hasRest" % ln, "hasRest", [
            K.loop(ids, loop_id, title, N(ln, "data.rest"), [
                K.code(sl, "This slice (the loop item: <= 250 rows)", body, ["n", "rows"], arrays=("rows",), objects=("n",)),
                K.update(ids, "update_node_XC%swrite" % tag, title + " (<= 250 per call)", table, ("id", "in", N(sl, "data.rows.id")), [(p, N(sl, "data.rows." + p)) for p in ["id"] + props], labels),
            ])]),
    ]


def upd(ids, nid, title, table, src, field, props, labels=None):
    return K.update(ids, nid, title, table, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in ["id"] + props], labels)


def build_commit():
    ids = K.Ids(1798600000000)
    T = "'%s'" % N(CG, "data.tenantId")
    JOBID = N(CG, "data.jobId")
    GDID = N(CE, "data.gdId")
    PFX = N(CE, "data.partPrefix")
    dt = lambda c: "DATE_FORMAT(%s, '%%Y-%%m-%%d %%H:%%i:%%s')" % c
    jt = lambda ref: "(SELECT jt.i FROM JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) jt)" % ref
    # 30 min, as GD Completed V2's (an engine APPLY of ~2,000 distinct materials takes ~10 min on dev)
    job = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 30 MINUTE, '%%Y-%%m-%%d %%H:%%i:%%s') AS lease_until,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.progress_percent, j.progress_message, j.attempt_count,
       %s AS next_attempt_at, j.lease_owner, %s AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live, (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = %s
   AND j.id = %s""" % (dt("j.next_attempt_at"), dt("j.lease_expires_at"), T, JOBID)
    steps = "SELECT st.step_name, st.step_status FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' AND st.step_name LIKE 'X%%' AND st.is_deleted = 0" % (T, JOBID)
    payload = "SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = %s AND j.id = %s" % (T, JOBID)
    gdlock = """SELECT g.gd_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GDC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN goods_delivery g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = %s AND j.id = %s AND j.correlation_id REGEXP '^GD\\\\|[0-9]{1,20}$'""" % (T, JOBID)
    own = "SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = %s AND j.id = %s" % (T, JOBID)
    part = lambda *names: ("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' AND (%s) AND st.is_deleted = 0 "
                           "ORDER BY st.step_name") % (T, JOBID, " OR ".join("st.step_name LIKE CONCAT('%s', '%s|%%')" % (PFX, nm) for nm in names))
    resrows = lambda idsref, creates: ("SELECT 'U' AS k, JSON_OBJECT('id', CAST(r.id AS CHAR), 'target_gd_id', r.target_gd_id, 'status', r.status, 'reserved_qty', r.reserved_qty, "
        "'open_qty', r.open_qty, 'delivered_qty', r.delivered_qty, 'doc_no', r.doc_no, 'doc_id', r.doc_id, 'doc_line_id', r.doc_line_id, "
        "'source_reserved_id', r.source_reserved_id, 'item_uom', CAST(r.item_uom AS CHAR), 'is_deleted', r.is_deleted) AS j\n  FROM on_reserved_gd r\n"
        " WHERE r.tenant_id = %s AND r.id IN %s" % (T, jt(idsref))) + (
        ("\nUNION ALL\nSELECT 'C' AS k, JSON_OBJECT('id', CAST(r.id AS CHAR), 'job_line_key', r.job_line_key) AS j\n  FROM on_reserved_gd r\n"
         " WHERE r.tenant_id = %s AND r.job_line_key LIKE '%s' AND r.is_deleted = 0" % (T, creates)) if creates else "")
    so_lines = lambda src: ("SELECT JSON_OBJECT('id', CAST(sl.id AS CHAR), 'sales_order_id', CAST(sl.sales_order_id AS CHAR), 'parent_id', CAST(sl.parent_id AS CHAR), "
        "'item_bundle_id', CAST(sl.item_bundle_id AS CHAR), 'item_name', sl.item_name, 'so_quantity', sl.so_quantity, 'delivered_qty', sl.delivered_qty, "
        "'planned_qty', sl.planned_qty, 'outstanding_quantity', sl.outstanding_quantity, 'line_status', sl.line_status) AS j\n  FROM sales_order_axszx8cj_sub sl\n"
        " WHERE sl.tenant_id = %s AND sl.is_deleted = 0\n   AND (sl.sales_order_id IN %s\n        OR sl.id IN %s)\n ORDER BY sl.id") % (T, jt(N(src, "data.soIdsJson")), jt(N(src, "data.lineIdsJson")))
    so_hdrs = lambda src: ("SELECT JSON_OBJECT('id', CAST(so.id AS CHAR), 'so_status', so.so_status, 'gd_status', so.gd_status, 'partially_delivered', so.partially_delivered, "
        "'fully_delivered', so.fully_delivered) AS j\n  FROM sales_order so\n WHERE so.tenant_id = %s AND so.is_deleted = 0\n   AND so.id IN %s\n ORDER BY so.id") % (T, jt(N(src, "data.soIdsJson")))
    intent = lambda name: ("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' AND st.step_name LIKE '%s|I|%%' "
                           "AND st.is_deleted = 0 ORDER BY st.step_name") % (T, JOBID, name)
    myt = "CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')"
    x0pick = ("SELECT CAST(t.id AS CHAR) AS id, t.to_id, COALESCE(t.is_processing, 0) AS is_processing, TIMESTAMPDIFF(SECOND, t.update_time, %s) AS lock_age_sec,\n"
              "       (SELECT COUNT(*) FROM gd_async_job j WHERE j.tenant_id = %s AND j.command = 'CONFIRM_PICKING' AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')\n"
              "           AND j.is_deleted = 0 AND CAST(j.picking_id AS UNSIGNED) = t.id) AS open_jobs\n  FROM transfer_order t\n WHERE t.tenant_id = %s AND t.is_deleted = 0 AND t.id IN %s") % (
        myt, T, T, jt(N("code_node_XCx0ids", "data.pickIdsJson")))
    x0pack = ("SELECT CAST(p.id AS CHAR) AS id, p.packing_no, p.packing_lock_session_id AS lock_session, p.packing_lock_user_name AS lock_user,\n"
              "       CAST(COALESCE(p.packing_lock_expires_at > %s, 0) AS CHAR) AS lock_live\n  FROM packing p\n WHERE p.tenant_id = %s AND p.is_deleted = 0 AND p.id IN %s") % (
        myt, T, jt(N("code_node_XCx0ids", "data.packIdsJson")))
    huitems = lambda ref: ("SELECT CAST(hi.handling_unit_id AS CHAR) AS handling_unit_id, CAST(hi.material_id AS CHAR) AS material_id, hi.balance_id, CAST(hi.batch_id AS CHAR) AS batch_id,\n"
                           "       CAST(hi.quantity AS CHAR) AS quantity\n  FROM handling_unit_atu7sreg_sub hi\n WHERE hi.tenant_id = %s AND hi.is_deleted = 0 AND hi.handling_unit_id IN %s") % (T, jt(ref))
    x4prows = ("SELECT 'L' AS k, JSON_OBJECT('id', CAST(pl.id AS CHAR), 'line_status', pl.line_status, 'pending_process_qty', pl.pending_process_qty, 'is_deleted', pl.is_deleted) AS j\n"
               "  FROM transfer_order_jz8m9w3h_sub pl\n WHERE pl.tenant_id = %s AND pl.id IN %s\nUNION ALL\n"
               "SELECT 'P' AS k, JSON_OBJECT('id', CAST(t.id AS CHAR), 'to_status', t.to_status, 'to_id', t.to_id, 'is_deleted', t.is_deleted, 'is_processing', COALESCE(t.is_processing, 0),\n"
               "                             'lock_age_sec', TIMESTAMPDIFF(SECOND, t.update_time, %s)) AS j\n"
               "  FROM transfer_order t\n WHERE t.tenant_id = %s AND t.id IN %s\nUNION ALL\n"
               "SELECT 'A' AS k, JSON_OBJECT('id', CAST(pa.id AS CHAR), 'picking_id', CAST(pa.transfer_order_id AS CHAR), 'gd_id', CAST(pa.gd_id AS CHAR),\n"
               "                             'line_status', pa.line_status, 'is_deleted', pa.is_deleted) AS j\n"
               "  FROM transfer_order_jz8m9w3h_sub pa\n WHERE pa.tenant_id = %s AND pa.is_deleted = 0 AND pa.transfer_order_id IN %s") % (
        T, jt(N("code_node_XCx4pids", "data.lineIdsJson")), myt, T, jt(N("code_node_XCx4pids", "data.pickingIdsJson")), T, jt(N("code_node_XCx4pids", "data.pickingIdsJson")))
    x4krows = ("SELECT 'L' AS k, JSON_OBJECT('id', CAST(l.id AS CHAR), 'line_status', l.line_status, 'remaining_qty', l.remaining_qty, 'is_deleted', l.is_deleted) AS j\n"
               "  FROM packing_jz8m9w3h_sub l\n WHERE l.tenant_id = %s AND l.id IN %s\nUNION ALL\n"
               "SELECT 'H' AS k, JSON_OBJECT('id', CAST(p.id AS CHAR), 'packing_status', p.packing_status, 'gd_status', p.gd_status, 'is_deleted', p.is_deleted) AS j\n"
               "  FROM packing p\n WHERE p.tenant_id = %s AND p.id IN %s") % (T, jt(N("code_node_XCx4kids", "data.lineIdsJson")), T, jt(N("code_node_XCx4kids", "data.packingIdsJson")))
    HX = "code_node_XCx4hids"
    x4hfacts = ("SELECT 'HI' AS k, JSON_OBJECT('id', CAST(hi.id AS CHAR), 'handling_unit_id', CAST(hi.handling_unit_id AS CHAR), 'material_id', CAST(hi.material_id AS CHAR),\n"
                "       'balance_id', hi.balance_id, 'batch_id', CAST(hi.batch_id AS CHAR), 'quantity', CAST(hi.quantity AS CHAR)) AS j\n"
                "  FROM handling_unit_atu7sreg_sub hi\n WHERE hi.tenant_id = %s AND hi.is_deleted = 0 AND hi.handling_unit_id IN %s\nUNION ALL\n"
                "SELECT 'HU' AS k, JSON_OBJECT('id', CAST(h.id AS CHAR), 'packing_id', h.packing_id, 'parent_hu_id', h.parent_hu_id, 'is_deleted', h.is_deleted) AS j\n"
                "  FROM handling_unit h\n WHERE h.tenant_id = %s AND h.id IN %s\nUNION ALL\n"
                "SELECT 'U' AS k, JSON_OBJECT('id', CAST(u.id AS CHAR), 'temp_data', u.temp_data, 'item_count', u.item_count, 'total_quantity', u.total_quantity,\n"
                "       'hu_status', u.hu_status, 'is_deleted', u.is_deleted) AS j\n  FROM packing_hr4nq20g_sub u\n WHERE u.tenant_id = %s AND u.id IN %s\nUNION ALL\n"
                "SELECT 'S' AS k, JSON_OBJECT('id', CAST(sr.id AS CHAR), 'hu_status', sr.hu_status, 'is_deleted', sr.is_deleted) AS j\n"
                "  FROM packing_mudjw4xk_sub sr\n WHERE sr.tenant_id = %s AND sr.id IN %s") % (
        T, jt(N(HX, "data.boxIdsJson")), T, jt(N(HX, "data.huIdsJson")), T, jt(N(HX, "data.rowIdsJson")), T, jt(N(HX, "data.sourceIdsJson")))
    X5 = "code_node_XCx5ids"
    x5rows = ("SELECT 'H' AS k, JSON_OBJECT('id', CAST(t.id AS CHAR), 'delivery_no', t.delivery_no, 'is_deleted', t.is_deleted, 'is_processing', COALESCE(t.is_processing, 0),\n"
              "                             'lock_age_sec', TIMESTAMPDIFF(SECOND, t.update_time, %(MYT)s)) AS j FROM transfer_order t WHERE t.tenant_id = %(T)s AND t.id IN %(H)s\nUNION ALL\n"
              "SELECT 'L' AS k, JSON_OBJECT('id', CAST(pl.id AS CHAR), 'gd_no', pl.gd_no, 'is_deleted', pl.is_deleted) AS j FROM transfer_order_jz8m9w3h_sub pl WHERE pl.tenant_id = %(T)s AND pl.id IN %(L)s\nUNION ALL\n"
              "SELECT 'P' AS k, JSON_OBJECT('id', CAST(p.id AS CHAR), 'gd_no', p.gd_no, 'is_deleted', p.is_deleted) AS j FROM packing p WHERE p.tenant_id = %(T)s AND p.id IN %(P)s\nUNION ALL\n"
              "SELECT 'I' AS k, JSON_OBJECT('id', CAST(l.id AS CHAR), 'gd_no', l.gd_no, 'is_deleted', l.is_deleted) AS j FROM packing_jz8m9w3h_sub l WHERE l.tenant_id = %(T)s AND l.id IN %(I)s\nUNION ALL\n"
              "SELECT 'S' AS k, JSON_OBJECT('id', CAST(sr.id AS CHAR), 'gd_no', sr.gd_no, 'is_deleted', sr.is_deleted) AS j FROM packing_mudjw4xk_sub sr WHERE sr.tenant_id = %(T)s AND sr.id IN %(S)s\nUNION ALL\n"
              # the sibling GDs of each header that will end Cancelled (x5.js x5Siblings): already Cancelled under this token + "-Cancelled"
              # (a rename lost before), or still Processing under this token with a cancel past its point of no return (X2 / X3 done)
              # STRAIGHT_JOIN: ids -> header -> its tokens -> goods_delivery by (organization_id, delivery_no); otherwise MySQL reads the org's
              # GDs first (5.9 s on LSH prod instead of 0.4 s)
              "SELECT STRAIGHT_JOIN 'X' AS k, JSON_OBJECT('id', CAST(t.id AS CHAR), 'tok', TRIM(x.tok)) AS j\n"
              "  FROM %(HID)s JOIN transfer_order t ON t.id = hid.i AND t.tenant_id = %(T)s JOIN %(TOK)s\n"
              "  JOIN goods_delivery g ON g.tenant_id = t.tenant_id AND g.organization_id = '%(ORG)s' AND g.is_deleted = 0 AND g.gd_status = 'Cancelled'\n"
              "   AND g.delivery_no = CONCAT(TRIM(x.tok), '-Cancelled') COLLATE utf8mb4_general_ci\nUNION ALL\n"
              "SELECT STRAIGHT_JOIN 'X' AS k, JSON_OBJECT('id', CAST(t.id AS CHAR), 'tok', TRIM(x.tok)) AS j\n"
              "  FROM %(HID)s JOIN transfer_order t ON t.id = hid.i AND t.tenant_id = %(T)s JOIN %(TOK)s\n"
              "  JOIN goods_delivery g ON g.tenant_id = t.tenant_id AND g.organization_id = '%(ORG)s' AND g.is_deleted = 0 AND g.gd_status = 'Processing'\n"
              "   AND g.delivery_no = TRIM(x.tok) COLLATE utf8mb4_general_ci\n"
              " WHERE (SELECT COUNT(*) FROM gd_async_job j JOIN gd_publish_step p ON p.job_id = CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci AND p.is_deleted = 0 AND p.step_status = 'DONE'\n"
              "         AND p.step_name IN ('X2_INVENTORY', 'X3_RESERVATIONS')\n"
              "         WHERE j.tenant_id = t.tenant_id AND j.command = 'CANCEL_GD' AND j.correlation_id = CONCAT('GD|', g.id) COLLATE utf8mb4_general_ci AND j.is_deleted = 0\n"
              "           AND j.job_status NOT IN ('FAILED', 'CANCELLED')) > 0") % {
        "T": T, "MYT": myt, "H": jt(N(X5, "data.HIdsJson")), "L": jt(N(X5, "data.LIdsJson")), "P": jt(N(X5, "data.PIdsJson")), "I": jt(N(X5, "data.IIdsJson")), "S": jt(N(X5, "data.SIdsJson")),
        "ORG": N(X5, "data.orgSql"), "HID": "JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) hid" % N(X5, "data.HIdsJson"),
        "TOK": "JSON_TABLE(CONCAT('[\"', REPLACE(REPLACE(REPLACE(IFNULL(t.delivery_no, ''), '\"', ''), ', ', ','), ',', '\",\"'), '\"]'), '$[*]' COLUMNS (tok VARCHAR(128) PATH '$')) x"}
    x5moves = ("SELECT CAST(m.id AS CHAR) AS id\n  FROM inventory_movement m\n WHERE m.id >= %s AND m.tenant_id = %s AND m.organization_id = '%s' AND m.trx_no = '%s' AND m.is_deleted = 0\n ORDER BY m.id") % (
        N(X5, "data.idFloor"), T, N(X5, "data.orgSql"), N(X5, "data.oldNoSql"))
    gdraw = ("SELECT 'H' AS k, JSON_OBJECT('id', CAST(g.id AS CHAR), 'gd_status', g.gd_status, 'gd_total', CAST(g.gd_total AS CHAR), 'picking_status', g.picking_status, "
        "'delivery_no', g.delivery_no, 'so_id', CAST(g.so_id AS CHAR), 'so_no', g.so_no) AS j\n  FROM goods_delivery g\n WHERE g.tenant_id = %s AND g.id = %s AND g.is_deleted = 0\nUNION ALL\n"
        "SELECT 'L' AS k, JSON_OBJECT('id', CAST(l.id AS CHAR), 'prev_temp_qty_data', l.prev_temp_qty_data, 'customer_id', CAST(l.customer_id AS CHAR), "
        "'organization_id', l.organization_id, 'plant_id', CAST(l.plant_id AS CHAR), 'billing_state_id', CAST(l.billing_state_id AS CHAR), "
        "'billing_country_id', CAST(l.billing_country_id AS CHAR), 'shipping_state_id', CAST(l.shipping_state_id AS CHAR), "
        "'shipping_country_id', CAST(l.shipping_country_id AS CHAR), 'assigned_to', CAST(l.assigned_to AS CHAR), 'area_id', CAST(l.area_id AS CHAR), "
        "'line_index', l.line_index, 'gd_undelivered_qty', CAST(l.gd_undelivered_qty AS CHAR), 'packing_qty', CAST(l.packing_qty AS CHAR), "
        "'net_weight', CAST(l.net_weight AS CHAR), 'picking_status', l.picking_status, 'packing_status', l.packing_status) AS j\n"
        "  FROM goods_delivery_fwii8mvb_sub l\n WHERE l.tenant_id = %s AND l.goods_delivery_id = %s AND l.is_deleted = 0") % (T, GDID, T, GDID)
    E_ = "[%s][0]" % N(CE, "data")
    entry_fields = ["route", "phase", "dbNow", "jsAt", "jobId", "organizationId", "gdId", "gdNo", "newNo", "idempotencyKey", "jobStatus", "rowVersion", "attempts", "leaseUntil",
                    "unlockOk", "partPrefix", "manifest", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "needX0", "needX2", "needX3", "needX4", "needX4P", "needX4K",
                    "needX4H", "needX5", "needX6", "needX7", "doneX7Reorder", "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows")
    rej_body = RESULT_JS + mine("commit/result.js") + "\nreturn commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");" % (N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    sqlj = lambda nid, title, text: K.sql(nid, title, text, ["k", "j"])
    nodes = [
        K.code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", cc(["guard.js"]), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_XCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            K.code("code_node_XCrejres", "Result (REJECTED_INPUT)", rej_body, RES_FIELDS),
            K.ret("return_node_XCrej", "Return (rejected input)", [(f, N("code_node_XCrejres", "data." + f)) for f in RES_FIELDS])]),
        K.parallel("condition_all_XCfacts", "Facts in parallel: the job, its step rows, its manifest, the GD's status and lock", [
            ("cai_XCjob", "Job", [K.sql("sql_node_XCjob", "The job (+ DB clock, lease flag, lease_until, due)", job,
                ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                 "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted"])]),
            ("cai_XCsteps", "Steps", [K.sql("sql_node_XCsteps", "This job's X step rows", steps, ["step_name", "step_status"])]),
            ("cai_XCpayload", "Manifest", [K.sql("sql_node_XCpayload", "The prepared manifest", payload, ["prepared_payload"])]),
            ("cai_XCgd", "GD + lock", [K.sql("sql_node_XCgd", "The GD's status and its latest lock", gdlock, ["gd_status", "lock_ref"])]),
        ]),
        K.code(CE, "Entry: what this run does (phase A: X0 X2, SPLIT; phase B: X3 X4 X4P X4K X4H X5 X6 X7, COMPLETED), the lease claim", cc(["entry.js"]),
               entry_fields, arrays=("jobRows", "unlockRows"), objects=("rowVersion", "attempts", "manifest")),
        K.if_(ids, "if_XCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_XCentryend", "IF the manifest is unusable: job FAILED (+ GD back to Created) or REQUIRES_REVIEW", "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
            gate(ids, "cor_XCefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_XCefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows")]),
            gate(ids, "cor_XCefunlock", "GD lock to release?", CE, "needUnlock", [unlock_update(ids, "update_node_XCefunlock", CE)]),
        ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_XCclaim", "Lease claim: job COMMITTING_GD, lease_owner = this run, lease_expires_at = now + 30 min", CE, "jobRows"),
        K.sql("sql_node_XCown", "Read-back: the job after the lease claim", own, ["id", "job_status", "lease_owner", "row_version"]),
        K.code("code_node_XCown", "Own: COMMITTING_GD under this run's lease, else LOST", cc(["own.js"]), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_XClost", "IF another run took the job: stop", is_("code_node_XCown", "route", "LOST"), cres("lost", "code_node_XCown", "LOST")),
        # ---------------------------------------------------------------- X0
        K.if_(ids, "if_XCx0", "IF X0 REVALIDATE is due", is_(CE, "needX0", "YES"), [
            K.sql("sql_node_XCx0parts", "X0: the RES, PICK, PACK and HU parts", part("RES", "PICK", "PACK", "HU"), ["step_name", "result_ref"]),
            K.code("code_node_XCx0ids", "X0: the reservations, Pickings, Packings and boxes to read now", cc(["x0_ids.js"]), ["ok", "idsJson", "pickIdsJson", "packIdsJson", "boxIdsJson"]),
            K.parallel("condition_all_XCx0rows", "X0: those rows now, in parallel", [
                ("cai_XCx0rows", "Reservations", [sqlj("sql_node_XCx0rows", "X0: those reservations now", resrows(N("code_node_XCx0ids", "data.idsJson"), None))]),
                ("cai_XCx0pick", "Pickings", [K.sql("sql_node_XCx0pick", "X0: the Pickings it writes - held on a device or by a Picking V2 confirm?", x0pick,
                                                    ["id", "to_id", "is_processing", "lock_age_sec", "open_jobs"])]),
                ("cai_XCx0pack", "Packings", [K.sql("sql_node_XCx0pack", "X0: the Packings it cancels - open on a phone?", x0pack, ["id", "packing_no", "lock_session", "lock_user", "lock_live"])]),
                ("cai_XCx0box", "Boxes", [K.sql("sql_node_XCx0box", "X0: what the boxes it unpacks hold now", huitems(N("code_node_XCx0ids", "data.boxIdsJson")),
                                                ["handling_unit_id", "material_id", "balance_id", "batch_id", "quantity"])]),
            ]),
            K.code("code_node_XCx0", "X0 REVALIDATE: GD still locked by this job, reservations as PREPARE read them, Pickings / Packings free, boxes unchanged -> DONE; else FAILED + GD back to Created",
                   cc(["gdc:code/_fc.js", "x0.js"]), chk, arrays=chk_arr),
            end_block(ids, "x0", "code_node_XCx0", "IF the delivery changed meanwhile", unlock=True),
            step_done(ids, "x0", "code_node_XCx0", "X0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- X2
        K.if_(ids, "if_XCx2", "IF X2 INVENTORY is due (phase A ends here: SPLIT)", is_(CE, "needX2", "YES"), [
            K.sql("sql_node_XCx2part", "X2: the ENGINE part", part("ENGINE"), ["step_name", "result_ref"]),
            K.code("code_node_XCx2in", "X2: the operation key and the movements", cc(["x2_in.js"]), ["ok", "operationKey", "movements"], arrays=("movements",)),
            try_catch("try_catch_XCx2", "try-catch: a failed INVENTORY_BULK_APPLY call is a counted retry decided from its intent rows (no crash, no 30-min lease)", [call(ids, "workflow_node_XCx2", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; GDX|<job> replays on a re-run)", ENGINE, [
                ("operation_key", N("code_node_XCx2in", "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")),
                ("movements", N("code_node_XCx2in", "data.movements"))])], "The inventory call failed",
                [K.code("code_node_XCx2crash", "The inventory call failed: mark it (X2 decides from the intent rows)", ENGINE_CRASH_JS % ("GD_CANCEL_COMMIT", "X2", "X2"), ["crashed"])]),
            K.sql("sql_node_XCx2ops", "X2: this operation's engine intent rows (any = it may have written)",
                  "SELECT COUNT(*) AS intents FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = 'GDX|%s' AND st.step_name LIKE 'IBA|I|%%' AND st.is_deleted = 0" % (T, JOBID), ["intents"]),
            K.code("code_node_XCx2", "X2 check: 200 -> DONE + SPLIT; 409 -> wait, then FAILED + GD back to Created (review once it has intent rows); 400 -> FAILED + GD back to Created; else review; a failed call (caught) -> as 409",
                   cc(["x2.js"]), chk + ["splitRows", "needSplit"], arrays=chk_arr + ("splitRows",)),
            end_block(ids, "x2", "code_node_XCx2", "IF the stock was not released", unlock=True),
            step_done(ids, "x2", "code_node_XCx2", "X2_INVENTORY"),
            gate(ids, "cor_XCsplit", "SPLIT hand-over to write?", "code_node_XCx2", "needSplit", [
                job_update(ids, "update_node_XCsplit", "Job: SPLIT| hand-over lease (the next run does phase B)", "code_node_XCx2", "splitRows")]),
        ] + cres("split", "code_node_XCx2", "SPLIT")),
        # ---------------------------------------------------------------- X3
        K.if_(ids, "if_XCx3", "IF X3 RESERVATIONS is due", is_(CE, "needX3", "YES"), [
            K.sql("sql_node_XCx3part", "X3: the RES part", part("RES"), ["step_name", "result_ref"]),
            K.code("code_node_XCx3ids", "X3: the reservation ids and the creates' key prefix", cc(["x3_ids.js"]), ["ok", "idsJson", "createLike", "updates", "creates"], objects=("updates", "creates")),
            sqlj("sql_node_XCx3rows", "X3: those reservations now + this job's creates", resrows(N("code_node_XCx3ids", "data.idsJson"), N("code_node_XCx3ids", "data.createLike"))),
            K.code("code_node_XCx3plan", "X3 plan: write a row only while it holds what PREPARE read; each create once", cc(["x3_plan.js"]),
                   ["route", "slices", "writeCount", "createRows", "needCreates", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"], arrays=("slices", "createRows", "jobRows"), objects=("writeCount",)),
            end_block(ids, "x3pl", "code_node_XCx3plan", "IF the reservations cannot be written"),
            *slice_loop(ids, "x3", "code_node_XCx3plan", "slices", "X3 WRITE: on_reserved_gd", RESV, RES_COLS),
            gate(ids, "cor_XCx3add", "Reservations to create?", "code_node_XCx3plan", "needCreates", [
                K.add(ids, "add_node_XCx3add", "X3 WRITE: new on_reserved_gd rows (job_line_key <job>|C|<n>)", RESV, [(p, N("code_node_XCx3plan", "data.createRows." + p)) for p in CREATE_COLS])]),
            sqlj("sql_node_XCx3back", "X3 read-back", resrows(N("code_node_XCx3ids", "data.idsJson"), N("code_node_XCx3ids", "data.createLike"))),
            K.code("code_node_XCx3check", "X3 check: every row at its target, every create once -> DONE", cc(["x3_check.js"]), chk, arrays=chk_arr),
            end_block(ids, "x3", "code_node_XCx3check", "IF X3 did not complete"),
            step_done(ids, "x3", "code_node_XCx3check", "X3_RESERVATIONS"),
        ]),
        # ---------------------------------------------------------------- X4
        K.if_(ids, "if_XCx4", "IF X4 SALES ORDERS is due", is_(CE, "needX4", "YES"), [
            K.sql("sql_node_XCx4part", "X4: the SO part", part("SO"), ["step_name", "result_ref"]),
            K.code("code_node_XCx4ids", "X4: the Sales Orders and the SO lines of the delivery", cc(["x4_ids.js"]), ["ok", "soIdsJson", "lineIdsJson"]),
            K.parallel("condition_all_XCx4read", "X4 fresh reads in parallel", [
                ("cai_XCx4lines", "SO lines", [K.sql("sql_node_XCx4lines", "X4: the SO lines now", so_lines("code_node_XCx4ids"), ["j"])]),
                ("cai_XCx4hdrs", "SO headers", [K.sql("sql_node_XCx4hdrs", "X4: the Sales Orders now", so_hdrs("code_node_XCx4ids"), ["j"])]),
                ("cai_XCx4intent", "Intent", [K.sql("sql_node_XCx4intent", "X4: an intent of an earlier run", intent("X4"), ["step_name", "result_ref"])]),
            ]),
            K.code("code_node_XCx4plan", "X4 plan: QtyCheckBatch + UMQapdjk + lwB2FVe0 (lifted, saveAs Cancelled; lwB2FVe0 on the written lines) on the fresh rows -> intent; write what is at before",
                   cc(["gdc:lift/runtime.js", "gdc:lift/lifted_commit.js", "gdc:code/prepare/adapter.js", "x4_plan.js"]),
                   ["route", "needIntent", "intentRows", "lineSlices", "lineCount", "headerRows", "needHeaders", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("intentRows", "lineSlices", "headerRows", "jobRows"), objects=("lineCount",)),
            end_block(ids, "x4pl", "code_node_XCx4plan", "IF the sales orders cannot be written"),
            gate(ids, "cor_XCx4intent", "Intent to record?", "code_node_XCx4plan", "needIntent", [step_add(ids, "add_node_XCx4intent", "X4 INTENT: X4|I|<nnn> (before + after of every row)", "code_node_XCx4plan", "intentRows")]),
            *slice_loop(ids, "x4", "code_node_XCx4plan", "lineSlices", "X4 WRITE: SO lines", SOL, ["delivered_qty", "planned_qty", "outstanding_quantity", "line_status"]),
            gate(ids, "cor_XCx4hdr", "Sales Orders to write?", "code_node_XCx4plan", "needHeaders", [
                upd(ids, "update_node_XCx4hdr", "X4 WRITE: Sales Order status", SOH, "code_node_XCx4plan", "headerRows", ["so_status", "gd_status", "partially_delivered", "fully_delivered"])]),
            K.parallel("condition_all_XCx4back", "X4 read-back in parallel", [
                ("cai_XCx4linesB", "SO lines", [K.sql("sql_node_XCx4linesB", "X4 read-back: SO lines", so_lines("code_node_XCx4ids"), ["j"])]),
                ("cai_XCx4hdrsB", "SO headers", [K.sql("sql_node_XCx4hdrsB", "X4 read-back: Sales Orders", so_hdrs("code_node_XCx4ids"), ["j"])]),
                ("cai_XCx4intentB", "Intent", [K.sql("sql_node_XCx4intentB", "X4 read-back: the intent", intent("X4"), ["step_name", "result_ref"])]),
            ]),
            K.code("code_node_XCx4check", "X4 check: every intent row at its after-values -> DONE", cc(["gdc:code/prepare/adapter.js", "x4_check.js"]), chk, arrays=chk_arr),
            end_block(ids, "x4", "code_node_XCx4check", "IF X4 did not complete"),
            step_done(ids, "x4", "code_node_XCx4check", "X4_SO"),
        ]),
        # ---------------------------------------------------------------- X4P
        K.if_(ids, "if_XCx4p", "IF X4P PICKINGS is due (the bulk Cancel's Picking writes, server-side)", is_(CE, "needX4P", "YES"), [
            K.sql("sql_node_XCx4ppart", "X4P: the PICK part", part("PICK"), ["step_name", "result_ref"]),
            K.code("code_node_XCx4pids", "X4P: the Picking rows and headers to read", cc(["_rows.js", "x4p.js"], "return cancelX4PIds(%s, [%s][0]);" % (E_, N("sql_node_XCx4ppart", "data"))),
                   ["ok", "lineIdsJson", "pickingIdsJson"]),
            sqlj("sql_node_XCx4prows", "X4P: those Picking rows and headers now", x4prows),
            K.code("code_node_XCx4pplan", "X4P plan: rows still at before are written (else review); each Picking header decided on its rows as they are now",
                   cc(["_rows.js", "x4p.js"], ctail("cancelX4PPlan(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx4ppart", "data"), N("sql_node_XCx4prows", "data")), "commit X4P plan")),
                   ["route", "lineSlices", "lineCount", "headerRows", "needHeaders", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("lineSlices", "headerRows", "jobRows"), objects=("lineCount",)),
            end_block(ids, "x4ppl", "code_node_XCx4pplan", "IF the Pickings cannot be written"),
            *slice_loop(ids, "x4p", "code_node_XCx4pplan", "lineSlices", "X4P WRITE: Picking rows Cancelled, nothing pending", PKL, ["line_status", "pending_process_qty"],
                       {"line_status": "Line Status", "pending_process_qty": "Pending Process Quantity"}),
            gate(ids, "cor_XCx4phdr", "Picking headers to close?", "code_node_XCx4pplan", "needHeaders", [
                upd(ids, "update_node_XCx4phdr", "X4P WRITE: Picking Cancelled (+ -Cancelled) / Completed", PKH, "code_node_XCx4pplan", "headerRows", ["to_status", "to_id"], {"to_status": "Transfer Order Status"})]),
            sqlj("sql_node_XCx4pback", "X4P read-back", x4prows),
            K.code("code_node_XCx4pcheck", "X4P check: every row at its after-values, every header at the status its rows give now -> DONE",
                   cc(["_rows.js", "x4p.js"], ctail("cancelX4PCheck(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx4ppart", "data"), N("sql_node_XCx4pback", "data")), "commit X4P check")), chk, arrays=chk_arr),
            end_block(ids, "x4p", "code_node_XCx4pcheck", "IF X4P did not complete"),
            step_done(ids, "x4p", "code_node_XCx4pcheck", "X4P_PICKING"),
        ]),
        # ---------------------------------------------------------------- X4K
        K.if_(ids, "if_XCx4k", "IF X4K PACKINGS is due (every open Packing of the GD Cancelled)", is_(CE, "needX4K", "YES"), [
            K.sql("sql_node_XCx4kpart", "X4K: the PACK part", part("PACK"), ["step_name", "result_ref"]),
            K.code("code_node_XCx4kids", "X4K: the Packing lines and headers to read", cc(["_rows.js", "x4k.js"], "return cancelX4KIds(%s, [%s][0]);" % (E_, N("sql_node_XCx4kpart", "data"))),
                   ["ok", "lineIdsJson", "packingIdsJson"]),
            sqlj("sql_node_XCx4krows", "X4K: those Packing lines and headers now", x4krows),
            K.code("code_node_XCx4kplan", "X4K plan: rows / headers still at before are written; at after = done; else review",
                   cc(["_rows.js", "x4k.js"], ctail("cancelX4KPlan(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx4kpart", "data"), N("sql_node_XCx4krows", "data")), "commit X4K plan")),
                   ["route", "lineSlices", "lineCount", "headerRows", "needHeaders", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("lineSlices", "headerRows", "jobRows"), objects=("lineCount",)),
            end_block(ids, "x4kpl", "code_node_XCx4kplan", "IF the Packings cannot be written"),
            *slice_loop(ids, "x4k", "code_node_XCx4kplan", "lineSlices", "X4K WRITE: Packing lines Cancelled, nothing remaining", PACKL, ["line_status", "remaining_qty"]),
            gate(ids, "cor_XCx4khdr", "Packing headers to cancel?", "code_node_XCx4kplan", "needHeaders", [
                upd(ids, "update_node_XCx4khdr", "X4K WRITE: Packing Cancelled (packing_status, gd_status)", PACKH, "code_node_XCx4kplan", "headerRows", ["packing_status", "gd_status"])]),
            sqlj("sql_node_XCx4kback", "X4K read-back", x4krows),
            K.code("code_node_XCx4kcheck", "X4K check: every row at its after-values -> DONE",
                   cc(["_rows.js", "x4k.js"], ctail("cancelX4KCheck(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx4kpart", "data"), N("sql_node_XCx4kback", "data")), "commit X4K check")), chk, arrays=chk_arr),
            end_block(ids, "x4k", "code_node_XCx4kcheck", "IF X4K did not complete"),
            step_done(ids, "x4k", "code_node_XCx4kcheck", "X4K_PACKING"),
        ]),
        # ---------------------------------------------------------------- X4H
        K.if_(ids, "if_XCx4h", "IF X4H UNPACK is due (the cancelled Packings' generated boxes)", is_(CE, "needX4H", "YES"), [
            K.sql("sql_node_XCx4hpart", "X4H: the HU part", part("HU"), ["step_name", "result_ref"]),
            K.code(HX, "X4H: the boxes, their nested / released handling units, box rows and source rows to read",
                   cc(["_rows.js", "x4h.js"], "return cancelX4HIds(%s, [%s][0]);" % (E_, N("sql_node_XCx4hpart", "data"))), ["ok", "boxIdsJson", "huIdsJson", "rowIdsJson", "sourceIdsJson"]),
            sqlj("sql_node_XCx4hnow", "X4H: the boxes' items, the handling units, box and source rows now", x4hfacts),
            K.code("code_node_XCx4hplan", "X4H plan: the boxes still holding what PREPARE read are unloaded (an empty box is done; anything else = review)",
                   cc(["_rows.js", "x4h.js"], ctail("cancelX4HPlan(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx4hpart", "data"), N("sql_node_XCx4hnow", "data")), "commit X4H plan")),
                   ["route", "unload", "unloadCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"], arrays=("unload", "jobRows"), objects=("unloadCount",)),
            end_block(ids, "x4hpl", "code_node_XCx4hplan", "IF the boxes cannot be unpacked"),
            K.loop(ids, "loop_XCx4h", "Loop: one REPACKING_PROCESS Unload per box (isPacking 1: HU records only; a failed call writes nothing, the after-read decides)", N("code_node_XCx4hplan", "data.unload"), [
                K.code("code_node_XCx4hreq", "This box's Unload request (PackingOnUnpackHU's, from the box's stored items)",
                       cc(["_rows.js", "x4h.js"], "return cancelX4HCall([%s][0]);" % N("loop_XCx4h", "request").replace(".request", "")),
                       ["plant_id", "organization_id", "process_type", "trx_no", "parent_trx_no", "items", "source_hu", "target_hu", "target_storage_location_id", "target_location_id",
                        "remark", "transaction_type", "isPacking"], arrays=("items",), objects=("source_hu", "target_hu", "isPacking")),
                call(ids, "workflow_node_XCx4hcall", "REPACKING_PROCESS Unload (the Packing form's Unpack)", REPACK, [(p, N("code_node_XCx4hreq", "data." + p)) for p in [
                    "plant_id", "organization_id", "process_type", "trx_no", "parent_trx_no", "items", "source_hu", "target_hu", "target_storage_location_id", "target_location_id",
                    "remark", "transaction_type", "isPacking"]]),
            ]),
            sqlj("sql_node_XCx4hafter", "X4H: the same rows after the Unloads", x4hfacts),
            K.code("code_node_XCx4hpost", "X4H post: every box empty (else retry), then the form's writes on the rows read now (packing_id, parent_hu_id, box rows, source rows)",
                   cc(["_rows.js", "x4h.js"], ctail("cancelX4HPost(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx4hpart", "data"), N("sql_node_XCx4hafter", "data")), "commit X4H post")),
                   ["route", "huRows", "needHu", "boxRows", "needBoxRows", "sourceRows", "needSources", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("huRows", "boxRows", "sourceRows", "jobRows")),
            end_block(ids, "x4hpo", "code_node_XCx4hpost", "IF a box is not empty"),
            gate(ids, "cor_XCx4hhu", "Handling units to release?", "code_node_XCx4hpost", "needHu", [
                upd(ids, "update_node_XCx4hhu", "X4H WRITE: handling units out of the Packing (packing_id) / out of the box (parent_hu_id)", HU, "code_node_XCx4hpost", "huRows", ["packing_id", "parent_hu_id"])]),
            gate(ids, "cor_XCx4hrow", "Box rows to empty?", "code_node_XCx4hpost", "needBoxRows", [
                upd(ids, "update_node_XCx4hrow", "X4H WRITE: box rows emptied, Unpacked", PACKU, "code_node_XCx4hpost", "boxRows", ["temp_data", "item_count", "total_quantity", "hu_status"])]),
            gate(ids, "cor_XCx4hsrc", "Source rows to unpack?", "code_node_XCx4hpost", "needSources", [
                upd(ids, "update_node_XCx4hsrc", "X4H WRITE: the nested boxes' source rows Unpacked", PACKS, "code_node_XCx4hpost", "sourceRows", ["hu_status"])]),
            sqlj("sql_node_XCx4hback", "X4H read-back", x4hfacts),
            K.code("code_node_XCx4hcheck", "X4H check: boxes empty and out of the Packing, nested boxes out, rows Unpacked -> DONE",
                   cc(["_rows.js", "x4h.js"], ctail("cancelX4HCheck(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx4hpart", "data"), N("sql_node_XCx4hback", "data")), "commit X4H check")), chk, arrays=chk_arr),
            end_block(ids, "x4h", "code_node_XCx4hcheck", "IF X4H did not complete"),
            step_done(ids, "x4h", "code_node_XCx4hcheck", "X4H_UNPACK"),
        ]),
        # ---------------------------------------------------------------- X5
        K.if_(ids, "if_XCx5", "IF X5 NUMBERS is due (the cancelled number in its Pickings, Packings and movements)", is_(CE, "needX5", "YES"), [
            K.sql("sql_node_XCx5part", "X5: the NUM part", part("NUM"), ["step_name", "result_ref"]),
            K.code(X5, "X5: the rows to read, the old number as SQL text, the movement id floor", cc(["_rows.js", "x5.js"], "return cancelX5Ids(%s, [%s][0]);" % (E_, N("sql_node_XCx5part", "data"))),
                   ["ok", "HIdsJson", "LIdsJson", "PIdsJson", "IIdsJson", "SIdsJson", "oldNoSql", "orgSql", "idFloor"]),
            K.parallel("condition_all_XCx5read", "X5 reads in parallel", [
                ("cai_XCx5rows", "Numbers", [sqlj("sql_node_XCx5rows", "X5: the Picking / Packing rows now", x5rows)]),
                ("cai_XCx5moves", "Movements", [K.sql("sql_node_XCx5moves", "X5: the movements still carrying the old number", x5moves, ["id"])]),
            ]),
            K.code("code_node_XCx5plan", "X5 plan: rows still at before are written (else review); a Picking header renames this GD's token in its current text; every movement found renamed",
                   cc(["_rows.js", "x5.js"], ctail("cancelX5Plan(%s, [%s][0], [%s][0], [%s][0])" % (E_, N("sql_node_XCx5part", "data"), N("sql_node_XCx5rows", "data"), N("sql_node_XCx5moves", "data")), "commit X5 plan")),
                   ["route", "headerRows", "needHeaders", "rowSlices", "rowCount", "packHeaderRows", "needPackHeaders", "itemSlices", "itemCount", "sourceSlices", "sourceCount",
                    "moveSlices", "moveCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("headerRows", "rowSlices", "packHeaderRows", "itemSlices", "sourceSlices", "moveSlices", "jobRows"), objects=("rowCount", "itemCount", "sourceCount", "moveCount")),
            end_block(ids, "x5pl", "code_node_XCx5plan", "IF the numbers cannot be written"),
            gate(ids, "cor_XCx5hdr", "Picking headers to renumber?", "code_node_XCx5plan", "needHeaders", [
                upd(ids, "update_node_XCx5hdr", "X5 WRITE: Picking headers' GD numbers", PKH, "code_node_XCx5plan", "headerRows", ["delivery_no"])]),
            *slice_loop(ids, "x5r", "code_node_XCx5plan", "rowSlices", "X5 WRITE: Picking rows' gd_no", PKL, ["gd_no"]),
            gate(ids, "cor_XCx5pk", "Packing headers to renumber?", "code_node_XCx5plan", "needPackHeaders", [
                upd(ids, "update_node_XCx5pk", "X5 WRITE: Packing headers' gd_no", PACKH, "code_node_XCx5plan", "packHeaderRows", ["gd_no"])]),
            *slice_loop(ids, "x5i", "code_node_XCx5plan", "itemSlices", "X5 WRITE: Packing lines' gd_no", PACKL, ["gd_no"]),
            *slice_loop(ids, "x5s", "code_node_XCx5plan", "sourceSlices", "X5 WRITE: Packing source rows' gd_no", PACKS, ["gd_no"]),
            *slice_loop(ids, "x5m", "code_node_XCx5plan", "moveSlices", "X5 WRITE: movements' trx_no", MOVE, ["trx_no"]),
            K.parallel("condition_all_XCx5back", "X5 read-back in parallel", [
                ("cai_XCx5rowsB", "Numbers", [sqlj("sql_node_XCx5rowsB", "X5 read-back: the Picking / Packing rows", x5rows)]),
                ("cai_XCx5movesB", "Movements", [K.sql("sql_node_XCx5movesB", "X5 read-back: movements still carrying the old number", x5moves, ["id"])]),
            ]),
            K.code("code_node_XCx5check", "X5 check: every number at its after-value (a header: this GD's token), no movement left with the old number -> DONE",
                   cc(["_rows.js", "x5.js"], ctail("cancelX5Check(%s, [%s][0], [%s][0], [%s][0])" % (E_, N("sql_node_XCx5part", "data"), N("sql_node_XCx5rowsB", "data"), N("sql_node_XCx5movesB", "data")), "commit X5 check")),
                   chk, arrays=chk_arr),
            end_block(ids, "x5", "code_node_XCx5check", "IF X5 did not complete"),
            step_done(ids, "x5", "code_node_XCx5check", "X5_NUMBERS"),
        ]),
        # ---------------------------------------------------------------- X6
        K.if_(ids, "if_XCx6", "IF X6 THE DELIVERY is due (Cancelled: it stops being Processing here)", is_(CE, "needX6", "YES"), [
            K.parallel("condition_all_XCx6read", "X6 reads in parallel", [
                ("cai_XCx6part", "GD part", [K.sql("sql_node_XCx6part", "X6: the GD part", part("GD"), ["step_name", "result_ref"])]),
                ("cai_XCx6raw", "GD now", [sqlj("sql_node_XCx6raw", "X6: the GD and its lines as stored (raw)", gdraw)]),
            ]),
            K.code("code_node_XCx6plan", "X6 plan: the patches on the stored values; changed lines in slices, the header",
                   cc(["x6.js"], ctail("cancelX6Plan(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx6part", "data"), N("sql_node_XCx6raw", "data")), "commit X6 plan")),
                   ["route", "headerRows", "soRows", "needSoHead", "lineSlices", "lineCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("headerRows", "soRows", "lineSlices", "jobRows"), objects=("lineCount",)),
            end_block(ids, "x6pl", "code_node_XCx6plan", "IF the delivery cannot be written"),
            *slice_loop(ids, "x6", "code_node_XCx6plan", "lineSlices", "X6 WRITE: GD lines", GDL, GX_LINE_COLS),
            gate(ids, "cor_XCx6so", "Order list to write?", "code_node_XCx6plan", "needSoHead", [
                upd(ids, "update_node_XCx6so", "X6 WRITE: the GD's order list", GD, "code_node_XCx6plan", "soRows", ["so_id", "so_no"])]),
            upd(ids, "update_node_XCx6head", "X6 WRITE: the GD Cancelled (gd_status, the -Cancelled number, picking_status, gd_total)", GD, "code_node_XCx6plan", "headerRows",
                ["gd_status", "gd_total", "picking_status", "delivery_no"], {"gd_status": "GD Status"}),
            sqlj("sql_node_XCx6back", "X6 read-back (raw)", gdraw),
            K.code("code_node_XCx6check", "X6 check: Cancelled, every patch reads back -> DONE",
                   cc(["x6.js"], ctail("cancelX6Check(%s, [%s][0], [%s][0])" % (E_, N("sql_node_XCx6part", "data"), N("sql_node_XCx6back", "data")), "commit X6 check")), chk, arrays=chk_arr),
            end_block(ids, "x6", "code_node_XCx6check", "IF X6 did not complete"),
            step_done(ids, "x6", "code_node_XCx6check", "X6_GD"),
        ]),
        # ---------------------------------------------------------------- X7 + finish
        K.if_(ids, "if_XCx7", "IF X7 AFTER is due: item dates, reorder", is_(CE, "needX7", "YES"), [
            K.sql("sql_node_XCx7part", "X7: the AFTER part", part("AFTER"), ["step_name", "result_ref"]),
            K.code("code_node_XCx7", "X7 plan: item dates in slices; REORDER_SET_REDIS GD_CANCELLED at most once",
                   cc(["x7.js"], "const res = cancelX7Plan(%s, [%s][0]);\nconsole.log(\"commit X7 plan\", JSON.stringify({ route: res.route, reorder: res.needReorder }));\nreturn res;" % (E_, N("sql_node_XCx7part", "data"))),
                   ["route", "itemSlices", "reorderRows", "needReorder", "reorderPrevious", "jobRows", "needJobUpd"], arrays=("itemSlices", "reorderRows", "reorderPrevious", "jobRows")),
            end_block(ids, "x7", "code_node_XCx7", "IF the after part cannot be read"),
            *slice_loop(ids, "x7", "code_node_XCx7", "itemSlices", "X7 WRITE: Item last_transaction_date", ITEM, ["last_transaction_date"]),
            gate(ids, "cor_XCx7reorder", "Reorder tracking to run?", "code_node_XCx7", "needReorder", [
                step_add(ids, "add_node_XCx7reorder", "X7_REORDER marker (written before the call: at most once)", "code_node_XCx7", "reorderRows"),
                call(ids, "workflow_node_XCx7reorder", "REORDER_SET_REDIS GD_CANCELLED (if_ReorderCancelled)", REORDER, [
                    ("document_type", "GD_CANCELLED", "value"), ("previous_data", N("code_node_XCx7", "data.reorderPrevious")), ("organization_id", N(CE, "data.organizationId"))]),
            ]),
        ]),
        K.code("code_node_XCfinish", "FINISH: X7 DONE, the job COMPLETED (its message names what was left in place)",
               cc(["x7.js"], "const res = cancelFinish(%s);\nconsole.log(\"commit finish\", JSON.stringify({ message: res.result_message }));\nreturn res;" % E_),
               ["stepRows", "jobRows", "result_message"], arrays=("stepRows", "jobRows")),
        gate(ids, "cor_XCfinstep", "X7 DONE to record?", CE, "needX7", [step_add(ids, "add_node_XCfinstep", "X7_AFTER DONE", "code_node_XCfinish", "stepRows")]),
        job_update(ids, "update_node_XCdone", "Job COMPLETED (lease released)", "code_node_XCfinish", "jobRows"),
    ] + cres("done", "code_node_XCfinish", "DONE")
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a CANCEL_GD job (READY_TO_COMMIT, or COMMITTING_GD to resume)")], RES_FIELDS, nodes)


# =============================================================================================== GD_CANCEL_WORKER
def wcode(path, subs=None):
    body = mine(os.path.join("worker", path))
    if "//@include _common.js\n" in body:
        body = body.replace("//@include _common.js\n", mine("worker/_common.js") + "\n")
    for a, b in (subs or {}).items():
        assert a in body, (path, a)
        body = body.replace(a, b)
    left = re.findall(r"__[A-Z]+__", body)
    assert not left, (path, left)
    return body


GD_LOCK_JOIN = """LEFT JOIN goods_delivery g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^GD\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GDC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%%' AND p.is_deleted = 0)"""
GD_ID_COL = "(CASE WHEN g.gd_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gd_id"


def wjob_sql(tenant, job_ref):
    return """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_percent,
       j.progress_message,
       j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS next_attempt_at,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live,
       j.row_version,
       j.error_code,
       j.error_message,
       j.error_details,
       %s,
       DATE_FORMAT(j.finished_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS finished_at
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '%s'
   AND j.id = %s
  %s""" % (GD_ID_COL, tenant, job_ref, GD_LOCK_JOIN)


WJOB_COLS = ["db_now", "id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "lease_live", "row_version", "error_code", "error_message", "error_details", "gd_id", "finished_at"]


def build_worker():
    """GD Completed V2's worker (build_gdc.py build_worker, verbatim) with GD Cancel's names: polls CANCEL_GD only"""
    ids = K.Ids(1798700000000)
    G = "code_node_XWguard2"
    T = N(G, "data.tenantId")
    prep = ("GD_CANCEL_PREPARE", wf_id("GD_CANCEL_PREPARE"))
    comm = ("GD_CANCEL_COMMIT", wf_id("GD_CANCEL_COMMIT"))
    res_fields = ["worker_route", "processed", "jobs", "job_id", "job_status", "result_code", "result_message", "gd_id", "evidence"]
    poll = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       x.id, x.organization_id, x.gd_id, x.job_status, x.progress_percent, x.progress_message, x.attempt_count, x.next_attempt_at, x.lease_owner,
       x.lease_expires_at, x.dead_lease, x.row_version, x.error_code, x.error_message, x.error_details, x.claim_id, x.claim_started_at, x.claim_owner
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN (SELECT CAST(j.id AS CHAR) AS id,
                    j.organization_id,
                    %(GDCOL)s,
                    j.job_status,
                    j.progress_percent,
                    j.progress_message,
                    j.attempt_count,
                    DATE_FORMAT(j.next_attempt_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS next_attempt_at,
                    j.lease_owner,
                    DATE_FORMAT(j.lease_expires_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS lease_expires_at,
                    (j.lease_owner IS NOT NULL AND j.lease_owner <> '' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= NOW(3)) AS dead_lease,
                    j.row_version,
                    j.error_code,
                    j.error_message,
                    j.error_details,
                    CAST(c.id AS CHAR) AS claim_id,
                    DATE_FORMAT(c.started_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS claim_started_at,
                    c.result_ref AS claim_owner,
                    j.create_time AS created
               FROM gd_async_job j
               LEFT JOIN gd_publish_step c
                 ON c.tenant_id = '%(T)s'
                AND c.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
                AND c.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)
                AND c.is_deleted = 0
               %(LOCK)s
              WHERE j.tenant_id = '%(T)s'
                AND j.is_deleted = 0
                AND j.command = 'CANCEL_GD'
                AND (%(JOB)s = 0 OR j.id = %(JOB)s)
                AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD')
                AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= NOW(3))
                AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW(3))
                AND (c.id IS NULL OR c.started_at <= NOW(3) - INTERVAL 10 MINUTE)
              ORDER BY j.create_time, j.id
              LIMIT 5) x
    ON 1 = 1""" % {"T": T, "JOB": N(G, "data.jobId"), "GDCOL": GD_ID_COL, "LOCK": GD_LOCK_JOIN}
    tick = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%%Y-%%m-%%d %%H:%%i:%%s') AS lease_until,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       %(GDCOL)s,
       j.job_status,
       j.progress_percent,
       j.progress_message,
       j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS next_attempt_at,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live,
       (j.lease_owner IS NOT NULL AND j.lease_owner <> '' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= n.t) AS dead_lease,
       (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due_now,
       j.row_version,
       j.error_code,
       j.error_message,
       j.error_details,
       CAST(cw.id AS CHAR) AS claim_id,
       DATE_FORMAT(cw.started_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS claim_started_at,
       cw.result_ref AS claim_owner,
       (cw.id IS NOT NULL AND cw.started_at > n.t - INTERVAL 10 MINUTE) AS claim_live
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '%(T)s'
   AND j.is_deleted = 0
   AND j.id IN (%(IDS)s)
  LEFT JOIN gd_publish_step cw
    ON cw.tenant_id = '%(T)s'
   AND cw.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
   AND cw.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)
   AND cw.is_deleted = 0
  %(LOCK)s""" % {"T": T, "IDS": N("code_node_XWplan", "data.jobIdsSql"), "GDCOL": GD_ID_COL, "LOCK": GD_LOCK_JOIN}
    final = """SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.attempt_count, j.lease_owner, j.error_code, j.error_message, SUBSTRING(j.correlation_id, 4) AS gd_id
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id IN (%s)""" % (T, N("code_node_XWplan", "data.jobIdsSql"))
    JOBREF = N("code_node_XWpick", "data.jobId")

    def jobread(nid, title):
        return K.sql(nid, title, wjob_sql(T, JOBREF), WJOB_COLS)

    def gd_unlock(nid, title, src, field="unlockRows"):
        return K.update(ids, nid, title, GD, ("id", "in", N(src, "data.%s.id" % field)),
                        [("id", N(src, "data.%s.id" % field)), ("gd_status", N(src, "data.%s.gd_status" % field))], labels={"gd_status": "GD Status"})

    def wjob_update(nid, title, src, field="jobRows", props=JOB_PROPS):
        return job_update(ids, nid, title, src, field, props)

    def publish(prefix, mid_node, which, wf_title):
        resp, back, after = "code_node_XW%sResp" % prefix, "sql_node_XW%sBack" % prefix, "code_node_XW%sAfter" % prefix
        return [
            call(ids, "workflow_node_XW%s" % prefix, wf_title, comm, [("job_id", JOBREF)]),
            K.code(resp, "The %s response, normalized (evidence; the job row decides)" % which,
                   wcode("callee.js", {"__WHAT__": which, "__NODE__": "workflow_node_XW%s" % prefix, "\"__EXTRA__\"": "\"path\""}),
                   ["called", "job_id", "job_status", "result_code", "result_message", "path"]),
            jobread(back, "Read-back: the job after the %s (the truth)" % which),
            K.code(after, "After the %s: COMMIT wrote the job itself; the worker writes only when nothing was saved" % which,
                   wcode("after_publish.js", {"__WHICH__": which, "__MID__": mid_node, "__RESP__": resp, "__BACK__": back}),
                   ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "publishRoute", "result_code", "result_message", "job_status"],
                   arrays=("jobRows", "unlockRows")),
            gate(ids, "cor_XW%sJob" % prefix, "Job row to write after the %s?" % which, after, "needJobUpd", [wjob_update("update_node_XW%sJob" % prefix, "Job: FAILED (a hard code) / retry with backoff (lease released)", after)]),
            gate(ids, "cor_XW%sUnlock" % prefix, "GD lock to release after the %s?" % which, after, "needUnlock", [gd_unlock("update_node_XW%sUnlock" % prefix, "Goods Delivery back to Created (nothing was saved)", after)]),
        ]

    plan_ref = "[%s][0]" % N("code_node_XWplan", "data")
    nodes = [
        K.code(G, "Guard: optional job_id, session tenant, this run's lease owner WRK|<nonce>", wcode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_XWreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_XWrejres", "Result (REJECTED_INPUT)", wcode("result.js", {"__PATH__": "REJECTED_INPUT", "__PLAN__": "null", "__ROWS__": "[]"}), res_fields),
            K.ret("return_node_XWrej", "Return (invalid input)", [(f, N("code_node_XWrejres", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_XWpoll", "Poll: the due CANCEL_GD jobs of the tenant (at most 5, oldest first; lease expired or never set; backoff over; no live claim row) + DB clock", poll,
              ["db_now", "id", "organization_id", "gd_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
               "lease_expires_at", "dead_lease", "row_version", "error_code", "error_message", "error_details", "claim_id", "claim_started_at", "claim_owner"]),
        K.code("code_node_XWplan", "Plan: the loop's items (the due jobs with their claim facts), the run start", wcode("plan.js"),
               ["route", "dbNow", "runStart", "items", "count", "jobIdsSql", "result_code", "result_message"], arrays=("items",)),
        K.set_cache("set_cache_XWidx0", "Loop index = 0 (per run: the key carries this run's nonce)", "gdx_wrk_" + N(G, "data.nonce"), "0"),
        K.loop(ids, "loop_XWjobs", "Loop over the planned jobs (in order; a lost claim gate ends the tick, the rest wait for the next)", N("code_node_XWplan", "data.items"), [
            K.get_cache("get_cache_XWidx", "Loop index", "gdx_wrk_" + N(G, "data.nonce")),
            K.sql("sql_node_XWtick", "Tick: the FRESH read of the planned jobs (state, lease, backoff, claim row) + the lease end of a claim made now", tick,
                  ["db_now", "lease_until", "id", "organization_id", "gd_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
                   "lease_owner", "lease_expires_at", "lease_live", "dead_lease", "due_now", "row_version", "error_code", "error_message", "error_details", "claim_id",
                   "claim_started_at", "claim_owner", "claim_live"]),
            K.code("code_node_XWpick", "Pick: the item by index; SKIP after the budget / not due / live lease / live claim; the claim gate rows", wcode("pick.js"),
                   ["route", "index", "nextIndex", "dbNow", "leaseUntil", "elapsed", "jobId", "organizationId", "gdId", "item", "rvBase", "rvRows", "needRvUpd", "claimName",
                    "claimRows", "needClaimAdd", "result_message"], arrays=("rvRows", "claimRows"), objects=("item",)),
            gate(ids, "cor_XWrv", "Dead claim to move past (row_version = v + 1)?", "code_node_XWpick", "needRvUpd", [
                wjob_update("update_node_XWrv", "Job: row_version = v + 1 and the retry count (absolute)", "code_node_XWpick", "rvRows", ["id", "row_version", "attempt_count"])]),
            gate(ids, "cor_XWclaimAdd", "Claim row to insert?", "code_node_XWpick", "needClaimAdd", [
                step_add(ids, "add_node_XWclaim", "CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> (unique tenant / job / step: a twin's insert fails and its run ends)", "code_node_XWpick", "claimRows")]),
            K.code("code_node_XWclaim", "Claim: the lease / state write; a dead lease or claim = one retry; exhausted after max_retries", wcode("claim.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "gdId", "rowVersion", "attempts", "claimRows", "needClaim", "failRows", "unlockRows", "exhausted",
                    "result_code", "result_message", "job_status"], arrays=("claimRows", "failRows", "unlockRows")),
            gate(ids, "cor_XWlease", "Lease / state to write?", "code_node_XWclaim", "needClaim", [
                wjob_update("update_node_XWlease", "Lease write: WRK|<nonce> for 10 min, VALIDATING for a QUEUED job, the retry count", "code_node_XWclaim", "claimRows")]),
            jobread("sql_node_XWown", "Read-back: the job after the lease write"),
            K.code("code_node_XWown", "Own: state and lease as written -> PREPARE / PUBLISH / RESUME / EXHAUST; else LOST", wcode("own.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "gdId", "attempts", "failRows", "unlockRows", "needFail", "needUnlock", "rowVersion",
                    "result_code", "result_message", "job_status"], arrays=("failRows", "unlockRows")),
            gate(ids, "cor_XWfail", "Exhausted: job row to write?", "code_node_XWown", "needFail", [
                wjob_update("update_node_XWfail", "Job FAILED (pre-commit) / REQUIRES_REVIEW (COMMITTING_GD)", "code_node_XWown", "failRows")]),
            gate(ids, "cor_XWfailUnlock", "Exhausted pre-commit: GD lock to release?", "code_node_XWown", "needUnlock", [
                gd_unlock("update_node_XWfailUnlock", "Goods Delivery back to Created (nothing was saved)", "code_node_XWown")]),
            K.if_(ids, "if_XWprep", "IF the job is pre-commit under this run's lease: the ONE GD_CANCEL_PREPARE call", is_("code_node_XWown", "route", "PREPARE"), [
                call(ids, "workflow_node_XWprep", "GD_CANCEL_PREPARE (set-based reads; writes the job + releases the lock on FAILED)", prep, [("job_id", JOBREF)]),
                K.code("code_node_XWprepResp", "The prepare response, normalized (evidence; the job row decides)",
                       wcode("callee.js", {"__WHAT__": "prepare", "__NODE__": "workflow_node_XWprep", "\"__EXTRA__\"": "\"evidence\""}),
                       ["called", "job_id", "job_status", "result_code", "result_message", "evidence"]),
                jobread("sql_node_XWprepBack", "Read-back: the job after prepare (the truth)"),
                K.code("code_node_XWafterPrep", "After prepare: READY_TO_COMMIT -> publish; FAILED -> lease released; else a hard code fails it / a counted retry", wcode("after_prepare.js"),
                       ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "prepareResult", "prepareMessage", "result_code", "result_message", "job_status"],
                       arrays=("jobRows", "unlockRows")),
                gate(ids, "cor_XWprepJob", "Job row to write after prepare?", "code_node_XWafterPrep", "needJobUpd", [
                    wjob_update("update_node_XWprepJob", "Job: lease released / FAILED / retry with backoff", "code_node_XWafterPrep")]),
                gate(ids, "cor_XWprepUnlock", "GD lock to release after prepare?", "code_node_XWafterPrep", "needUnlock", [
                    gd_unlock("update_node_XWprepUnlock", "Goods Delivery back to Created (nothing was saved)", "code_node_XWafterPrep")]),
            ]),
            jobread("sql_node_XWmid", "The job before the publish decision"),
            K.code("code_node_XWmid", "Before publish: READY_TO_COMMIT under this run's lease, or COMMITTING_GD with no live lease -> PUBLISH", wcode("mid.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_XWpub", "IF the job is to be published / resumed: the ONE GD_CANCEL_COMMIT call", is_("code_node_XWmid", "route", "PUBLISH"),
                  publish("pub", "code_node_XWmid", "publish", "GD_CANCEL_COMMIT (phase A: revalidate, snapshot, inventory; or phase B on a resume)")),
            jobread("sql_node_XWsplit", "The job after the publish call (the split decision)"),
            int_out(K.code("code_node_XWsplit", "Second publish: COMMITTING_GD under a SPLIT| hand-over lease -> PUBLISH again; next index past the plan after a commit call (one stock call per run)", wcode("split.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message", "nextIndex"]), "nextIndex"),
            K.if_(ids, "if_XWpub2", "IF GD_CANCEL_COMMIT ended SPLIT: the second call (reservations, sales orders, the delivery, after)", is_("code_node_XWsplit", "route", "PUBLISH"),
                  publish("pub2", "code_node_XWsplit", "second publish", "GD_CANCEL_COMMIT again after its SPLIT (phase B)")),
            K.set_cache("set_cache_XWidxN", "Next loop index", "gdx_wrk_" + N(G, "data.nonce"), N("code_node_XWsplit", "data.nextIndex")),
        ]),
        K.sql("sql_node_XWfinal", "Read-back: the planned jobs (final)", final, ["id", "job_status", "attempt_count", "lease_owner", "error_code", "error_message", "gd_id"]),
        K.code("code_node_XWresult", "Result (DONE)", wcode("result.js", {"__PATH__": "DONE", "__PLAN__": plan_ref, "__ROWS__": "[%s][0]" % N("sql_node_XWfinal", "data")}), res_fields),
        K.ret("return_node_XWdone", "Return the tick's result", [(f, N("code_node_XWresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "optional: gd_async_job.id (digits) to drive this job only (the form's kick after a submit); empty under Quartz: the oldest due jobs of the session tenant (at most 5 per tick)")],
                      res_fields, nodes)



# =============================================================================================== GD_CANCEL_SUBMIT
SUB_RES = ["route", "code", "message", "reason", "job_id", "job_status", "gd_id", "gd_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "evidence"]


def scode(name, tail=""):
    return "\n".join([mine("submit/_common.js"), mine("submit/" + name)] + ([tail] if tail else []))


def gate_code():
    tail = """const guard = [{{node:code_node_XSguard.data}}][0];
const entry = [{{node:code_node_XSentry.data}}][0];
const S = {
  organizationId: entry.organizationId,
  hdr: [{{node:sql_node_XShdr.data}}][0], lines: [{{node:sql_node_XSlines.data}}][0], setup: [{{node:sql_node_XSsetup.data}}][0],
  link: [{{node:sql_node_XSlink.data}}][0], items: [{{node:sql_node_XSitems.data}}][0], sohl: [{{node:sql_node_XSsohl.data}}][0],
  pack: [{{node:sql_node_XSpack.data}}][0], box: [{{node:sql_node_XSbox.data}}][0],
};
const t0 = Date.now();
const res = cancelGate(guard, entry, S);
console.log("cancel gate", JSON.stringify({ route: res.route, code: res.code, message: res.message, ms: Date.now() - t0 }));
return res;"""
    return "\n".join([gdc("lift/runtime.js"), lifted_ok(gdc("lift/lifted_prepare.js")), gdc("code/prepare/adapter.js"), gdc("code/prepare/chain.js"), gdc("code/_fc.js"),
                      mine("prepare/chain.js"), mine("submit/required.js"), mine("submit/_common.js"), kinds_js(), mine("submit/gate.js"), tail])


def build_submit():
    ids = K.Ids(1798800000000)
    G, E, GT, PO = "code_node_XSguard", "code_node_XSentry", "code_node_XSgate", "code_node_XSpost"
    T, GDID = N(G, "data.tenantId"), N(G, "data.gdId")
    myt = "CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')"
    # an open job on the GD (GD Edit V2's SUBMIT condition + another cancel): an edit not finished; a completion / Packing / cancel open
    # (REQUIRES_REVIEW counts); a GD V2 create whose Picking outbox is not done
    open_jobs = """(SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(o.id AS CHAR), 'command', o.command, 'job_status', o.job_status, 'progress_percent', o.progress_percent,
                                             'progress_message', o.progress_message, 'error_code', o.error_code, 'error_message', o.error_message)) AS CHAR)
          FROM gd_async_job o
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0
           AND ((o.correlation_id = 'GD|@G'
                 AND ((o.command = 'EDIT_GD' AND o.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED'))
                      OR (o.command = 'COMPLETE_GD' AND o.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'REQUIRES_REVIEW'))
                      OR (o.command = 'CANCEL_GD' AND o.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'REQUIRES_REVIEW'))
                      OR (o.command = 'COMPLETE_PACKING' AND o.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PACKING', 'REQUIRES_REVIEW'))))
                OR (o.command = 'CREATE_GD_FROM_FORM' AND o.gd_id = '@G'
                    AND o.job_status IN ('RECONCILING_GD', 'GD_COMMITTED', 'CREATING_PICKING', 'PICKING_RETRYING', 'PICKING_READY', 'REQUIRES_REVIEW')))) AS open_jobs"""
    picking_jobs = """(SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(pj.id AS CHAR), 'command', pj.command, 'job_status', pj.job_status)) AS CHAR)
          FROM gd_async_job pj
         WHERE pj.tenant_id = '@T' AND pj.is_deleted = 0 AND pj.command = 'CONFIRM_PICKING'
           AND pj.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND EXISTS (SELECT 1 FROM transfer_order_jz8m9w3h_sub ti
                        WHERE ti.transfer_order_id = CAST(pj.picking_id AS UNSIGNED) AND ti.tenant_id = '@T' AND ti.is_deleted = 0
                          AND ti.gd_id = @G AND IFNULL(ti.line_status, '') <> 'Cancelled')) AS picking_jobs"""
    facts = ("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(g.id AS CHAR) AS gd_id,
       g.delivery_no,
       g.gd_status,
       g.organization_id,
       CAST(g.plant_id AS CHAR) AS plant_id,
       (SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub l WHERE l.tenant_id = '@T' AND l.goods_delivery_id = @G AND l.is_deleted = 0) AS line_count,
       (SELECT p.step_name FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'GDC|@G' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS last_lock,
       @OPEN,
       @PJOBS,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('picking_id', CAST(t.id AS CHAR), 'picking_no', t.to_id, 'is_processing', COALESCE(t.is_processing, 0),
                                             'lock_age_sec', TIMESTAMPDIFF(SECOND, t.update_time, @MYT))) AS CHAR)
          FROM (SELECT DISTINCT x.transfer_order_id FROM transfer_order_jz8m9w3h_sub x
                 WHERE x.tenant_id = '@T' AND x.gd_id = @G AND x.is_deleted = 0 AND COALESCE(x.line_status, '') NOT IN ('Completed', 'Cancelled')) lo
          STRAIGHT_JOIN transfer_order t ON t.id = lo.transfer_order_id AND t.tenant_id = '@T' AND t.is_deleted = 0
           AND COALESCE(t.to_status, '') NOT IN ('Completed', 'Cancelled', 'Draft')) AS picking_locks,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('packing_no', p.packing_no, 'lock_user', p.packing_lock_user_name)) AS CHAR)
          FROM packing p
         WHERE p.tenant_id = '@T' AND p.is_deleted = 0 AND p.gd_id = '@G' AND COALESCE(p.packing_status, '') NOT IN ('Completed', 'Cancelled')
           AND COALESCE(p.packing_lock_session_id, '') <> '' AND COALESCE(p.packing_lock_expires_at > @MYT, 0) = 1) AS packing_leases,
       (SELECT CAST(JSON_OBJECT('id', CAST(x.id AS CHAR), 'job_status', x.job_status, 'progress_percent', x.progress_percent, 'progress_message', x.progress_message,
                                'error_code', x.error_code, 'error_message', x.error_message) AS CHAR)
          FROM gd_async_job x
         WHERE x.tenant_id = '@T' AND x.is_deleted = 0 AND x.command = 'CANCEL_GD' AND x.correlation_id = 'GD|@G'
         ORDER BY x.id DESC LIMIT 1) AS last_job
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN goods_delivery g
    ON g.tenant_id = '@T'
   AND g.id = @G
   AND g.is_deleted = 0""".replace("@OPEN", open_jobs).replace("@PJOBS", picking_jobs).replace("@MYT", myt).replace("@T", T).replace("@G", GDID))
    # after the queue rows: this job, the GD, its lock, and any other open job of it (one that slipped in before the Processing write)
    back = ("""SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       g.gd_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'GDC|@G' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       (SELECT COUNT(*) FROM gd_async_job o
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0 AND o.id <> COALESCE(j.id, 0) AND o.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND ((o.correlation_id = 'GD|@G' AND o.command IN ('EDIT_GD', 'COMPLETE_GD', 'CANCEL_GD', 'COMPLETE_PACKING'))
                OR (o.command = 'CONFIRM_PICKING' AND EXISTS (SELECT 1 FROM transfer_order_jz8m9w3h_sub ti
                      WHERE ti.transfer_order_id = CAST(o.picking_id AS UNSIGNED) AND ti.tenant_id = '@T' AND ti.is_deleted = 0 AND ti.gd_id = @G)))) AS racers
  FROM (SELECT 1 AS one) x
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.organization_id = '@O'
   AND j.idempotency_key = '@KEY'
   AND j.is_deleted = 0
  LEFT JOIN goods_delivery g
    ON g.tenant_id = '@T'
   AND g.id = @G
   AND g.is_deleted = 0""".replace("@T", T).replace("@G", GDID).replace("@O", N(E, "data.organizationId")).replace("@KEY", N(PO, "data.idemKey")))

    def sres(tag, src, title, back_node=None, due_node=None):
        call_ = "cancelResult([%s][0], %s, [%s][0], %s, %s)" % (N(G, "data"), "null" if src == G else "[%s][0]" % N(E, "data"), N(src, "data"),
                                                              "[%s][0]" % N(back_node, "data") if back_node else "null", "[%s][0]" % N(due_node, "data") if due_node else "null")
        body = scode("result.js", "const res = %s;\nconsole.log(\"cancel result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, job: res.job_id }));\nreturn res;" % call_)
        return [K.code("code_node_XS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_XS%s" % tag, "Return (%s)" % title, [(f, N("code_node_XS%sres" % tag, "data." + f)) for f in SUB_RES])]

    reads = [("hdr", "The Goods Delivery (every schema field)", ["j"]), ("lines", "Its lines, top-level and bundle items", ["j"]),
             ("setup", "Picking Setup + Packing Setup of the organization", ["k", "j"]), ("link", "Internal-trading links of its Sales Orders", ["j"]),
             ("items", "Items of its lines (flags, serial management, UOM)", ["j"]), ("sohl", "Sales Order lines it points at (QtyCheckBatch's columns)", ["j"]),
             ("pack", "Its Packings with their rows (the boxes to unpack)", ["k", "j"]), ("box", "The handling units of those boxes and their stored items", ["k", "j"])]
    read_nodes = [("cai_XS" + k, k, [K.sql("sql_node_XS" + k, title, PSQL[k].replace("code_node_GCentry", E), cols)]) for k, title, cols in reads]
    entry_fields = ["route", "code", "message", "reason", "tenantId", "gdId", "gdNo", "organizationId", "plantId", "lineCount", "dbNow", "lockN", "jobId", "jobStatus",
                    "progressPercent", "progressMessage", "errorCode", "errorMessage"]
    nodes = [
        K.code(G, "Guard: operation, gd_id (digits), source, session tenant + user", scode("guard.js"), ["route", "code", "message", "operation", "gdId", "tenantId", "source", "uid"]),
        K.if_(ids, "if_XSreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), sres("rej", G, "rejected input")),
        K.sql("sql_node_XSfacts", "Facts: the GD, its line count, its latest lock, open jobs on it, Picking V2 confirms of its Pickings, Pickings held on a device, Packings open on a phone, the latest CANCEL_GD job, DB clock",
              facts, ["db_now", "gd_id", "delivery_no", "gd_status", "organization_id", "plant_id", "line_count", "last_lock", "open_jobs", "picking_jobs", "picking_locks", "packing_leases", "last_job"]),
        K.code(E, "Entry: STATUS; SUBMIT goes on for a Created GD nothing else holds (BUSY / STOP otherwise)", scode("entry.js").replace("const cancelEntry", gdc("code/_fc.js") + "\nconst cancelEntry"), entry_fields,
               objects=("lineCount", "lockN", "progressPercent")),
        K.if_(ids, "if_XSanswer", "IF answered here (STATUS / BUSY / STOP): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"), sres("ans", E, "entry")),
        K.parallel("condition_all_XSread", "PREPARE's reads in parallel (no row limits)", read_nodes),
        K.code(GT, "Gate: what PREPARE refuses (-> the classic cancel), GOODS_DELIVERY's cancel gates to CHECK_REQUIRED_FIELD (lifted), the box cap", gate_code(),
               ["route", "code", "message", "reason"]),
        K.if_(ids, "if_XSgateEnd", "IF the gate answered (NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"), sres("gate", GT, "gate")),
        K.code(PO, "Post: the lock, job and Processing rows", scode("post.js", "const res = cancelPost([%s][0], [%s][0]);\nconsole.log(\"cancel post\", JSON.stringify({ route: res.route, key: res.idemKey }));\nreturn res;" % (N(G, "data"), N(E, "data"))),
               ["route", "code", "message", "idemKey", "lockRows", "jobRows", "gdRows"], arrays=("lockRows", "jobRows", "gdRows")),
        K.add(ids, "add_node_XSlock", "LOCK: gd_publish_step GDC|<gd> / LOCK|<n> (unique tenant / job / step: a concurrent submit fails its run)", STEP,
              [(p, N(PO, "data.lockRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "result_ref"]], labels=ORG),
        K.add(ids, "add_node_XSjob", "Job insert: CANCEL_GD QUEUED (idempotency_key GDC|<gd>|<n>, correlation_id GD|<gd>)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in ["organization_id", "plant_id", "command", "idempotency_key", "job_status", "progress_percent", "progress_message",
                                                      "attempt_count", "row_version", "cancel_requested", "next_attempt_at", "request_payload", "causation_id", "correlation_id", "line_count", "queued_at"]],
              labels=ORG),
        upd(ids, "update_node_XSgd", "Goods Delivery Processing (the lock every writer honours)", GD, PO, "gdRows", ["gd_status"], {"gd_status": "GD Status"}),
        K.sql("sql_node_XSback", "Read-back: the job, the GD's status, its latest lock, any other open job of it (a racer)", back, ["job_id", "job_status", "gd_status", "lock_ref", "racers"]),
        K.code("code_node_XSdue", "Due: Processing under this job's lock and no racer -> the job due now; a racer -> GD back to Created, this job CANCELLED",
               scode("post.js", "const res = cancelDue([%s][0], [%s][0], [%s][0]);\nconsole.log(\"cancel due\", JSON.stringify({ route: res.route }));\nreturn res;" % (N(E, "data"), N(PO, "data"), N("sql_node_XSback", "data"))),
               ["route", "dueRows", "needDue", "undoJobRows", "needUndo", "unlockRows"], arrays=("dueRows", "undoJobRows", "unlockRows")),
        gate(ids, "cor_XSundo", "A racer: undo?", "code_node_XSdue", "needUndo", [
            job_update(ids, "update_node_XSundoJob", "Job CANCELLED (a Packing / Picking job of the GD started first)", "code_node_XSdue", "undoJobRows",
                       ["id", "job_status", "progress_message", "error_code", "error_message", "finished_at"]),
            unlock_update(ids, "update_node_XSundoGd", "code_node_XSdue", title="Goods Delivery back to Created (the cancel did not start)"),
        ]),
        gate(ids, "cor_XSdue", "Job to make due?", "code_node_XSdue", "needDue", [
            K.update(ids, "update_node_XSdue", "Job due now (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_XSdue", "data.dueRows.id")),
                     [("id", N("code_node_XSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_XSdue", "data.dueRows.next_attempt_at"))])]),
    ] + sres("done", PO, "queued", "sql_node_XSback", "code_node_XSdue")
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"), ("gd_id", "string", "goods_delivery.id (digits)"),
                       ("source", "string", "LIST (default) | MOBILE")], SUB_RES, nodes)


BUILDERS = [("GD_CANCEL_PREPARE", build_prepare), ("GD_CANCEL_COMMIT", build_commit), ("GD_CANCEL_WORKER", build_worker), ("GD_CANCEL_SUBMIT", build_submit)]

if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, fn in BUILDERS:
        if want and name not in want:
            continue
        path = os.path.join(OUT, name + ".json")
        published = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else None
        if published:
            K._taken.update(re.findall(r'"key": "([a-z0-9]{8})"', json.dumps(published)))
        doc = wrap_doc_sql(fn())
        K.check_ids(doc)
        if published:
            print(f"{name}: {keep_published(doc, published)} unchanged node(s) keep their published data")
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        print(f"{name}: {len(text)} chars, {len(K.check_ids(doc))} nodes" + (f" -> {path}" if WRITE else " (dry; --write to save)"))
        if WRITE:
            os.makedirs(OUT, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text + "\n")
