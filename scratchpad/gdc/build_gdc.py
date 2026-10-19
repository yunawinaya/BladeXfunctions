"""Builds the GD Completion V2 workflows as FlowGram JSON (pkv2tools/wfkit.py) into the repo's Goods Delivery/CompleteV2/.
Published with .dbtools/wf_upload.mjs (a compile-made sql-node never runs).

usage: python3 build_gdc.py [--write] [NAME ...]
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "pkv2tools"))
sys.path.insert(0, os.path.join(HERE, "prepare"))
import wfkit as K  # noqa: E402
from sql import SQL as PSQL  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
OUT = R + "Goods Delivery/CompleteV2/"
WRITE = "--write" in sys.argv
JOB = "GD Async Job:Table:2104845286495150081"
STEP = "GD Publish Step:Table:2105131615547461634"
GD = "Goods Delivery:Table:1902054888473481218"
ENGINE = ("INVENTORY_BULK_APPLY", "2109916822821744641")
JOB_PROPS = ["id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "row_version", "error_code", "error_message", "error_details", "finished_at"]


def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def raw(path):
    with open(os.path.join(HERE, path), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def code(path):
    return raw(os.path.join("code", path))


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


def job_update(ids, nid, title, src, field, props):
    return K.update(ids, nid, title, JOB, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in props])


# ============================================================================================== GD_COMPLETE_PREPARE
def plan_code():
    F = json.load(open(os.path.join(HERE, "lift", "fields.json")))
    kinds = {"header": F["goods_delivery"], "line": F["goods_delivery_fwii8mvb_sub"]}
    lifted = raw("lift/lifted_prepare.js")
    assert "{{" not in lifted, "a lifted body still holds a platform token"
    body = "\n".join([
        raw("lift/runtime.js"), lifted, code("prepare/adapter.js"), code("prepare/chain.js"), code("prepare/plan.js"),
        "const GC_KINDS = " + json.dumps(kinds, separators=(",", ":")) + ";",
        code("prepare/plan_tail.js"),
    ])
    return body


def build_prepare():
    ids = K.Ids(1797100000000)
    G, E, P, RD = "code_node_GCguard", "code_node_GCentry", "code_node_GCplan", "code_node_GCready"
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
                "evidence: JSON.stringify({ v: 1, workflow: \"GD_COMPLETE_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(G, "data.result_code"), N(G, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"GD_COMPLETE_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    reads = [
        ("hdr", "The Goods Delivery (every schema field, one JSON object)", ["j"]),
        ("lines", "Its lines, top-level and bundle items (parent_id), in id order", ["j"]),
        ("setup", "Picking Setup + Packing Setup (packing_required = 1) of the organization", ["k", "j"]),
        ("link", "Internal-trading links of its Sales Orders (any = not eligible)", ["j"]),
        ("items", "Items of its lines: the GOODS_DELIVERY and GD_UNUSED_FN_NEW item reads in one", ["j"]),
        ("sohl", "Sales Order lines (its SOs + any line it points at), the columns the SO nodes read", ["j"]),
        ("soh", "Its Sales Orders (status columns)", ["j"]),
        ("alloc", "on_reserved_gd Allocated to it (no row limit)", ["j"]),
        ("pend", "on_reserved_gd Pending for its materials and SO lines (no row limit)", ["j"]),
        ("top", "The Pickings of its lines (line_to_id)", ["j"]),
        ("topr", "Their picking records", ["j"]),
        ("lock", "Its latest completion lock (GD_COMPLETE_SUBMIT)", ["step_name", "result_ref"]),
    ]
    sql_nodes = [("cai_GC" + k, k, [K.sql("sql_node_GC" + k, title, PSQL[k].replace("code_node_GCentry", E), cols)]) for k, title, cols in reads]
    plan_fields = ["route", "code", "message", "operationKey", "organizationId", "movements", "payload", "partRows", "lineCount", "movementCount", "gdId", "unlockOk"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message", "job_status"]
    plan_node = K.code(P, "Plan: the GD before the lock -> GOODS_DELIVERY's Completed path + GD_UNUSED_FN_NEW's planner (lifted) -> movements, payload parts",
                       plan_code(), plan_fields, arrays=("movements", "partRows"), objects=("lineCount", "movementCount", "unlockOk"))
    nodes = [
        K.code(G, "Guard: job_id (digits), session tenant", code("prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_GCreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_GCrej", "Answer (rejected input)", rej_body, res_fields),
            K.ret("return_node_GCrej", "Return (rejected input)", [(f, N("code_node_GCrej", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_GCjob", "The job (+ DB clock, lease flag, request)", job,
              ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key",
               "correlation_id", "request_payload", "is_deleted"]),
        K.code(E, "Entry: a VALIDATING COMPLETE_GD job under a live lease; its request -> the GD", code("prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "gdId", "idempotencyKey", "rowVersion", "dbNow", "jsAt", "nonce", "request", "result_code", "result_message"],
               objects=("request", "rowVersion")),
        K.if_(ids, "if_GCnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(E, "route", "NOOP"), [
            K.code("code_node_GCnoop", "Answer (not prepared)", noop_body, res_fields),
            K.ret("return_node_GCnoop", "Return (not prepared)", [(f, N("code_node_GCnoop", "data." + f)) for f in res_fields]),
        ]),
        K.parallel("condition_all_GCread", "Set-based reads in parallel (no row limits)", sql_nodes),
        plan_node,
        K.if_(ids, "if_GCengine", "IF planned: INVENTORY_BULK_APPLY in PLAN mode (writes nothing)", is_(P, "route", "ENGINE"), [
            call(ids, "workflow_node_GCengine", "INVENTORY_BULK_APPLY PLAN: every movement priced, the operation checked as a whole", ENGINE, [
                ("operation_key", N(P, "data.operationKey")), ("mode", "PLAN", "value"), ("organization_id", N(P, "data.organizationId")),
                ("movements", N(P, "data.movements"))]),
        ]),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ GD back to Created when this job holds its lock)", code("prepare/ready.js"),
               ready_fields, arrays=("readyRows", "jobRows", "unlockRows")),
        gate(ids, "cor_GCparts", "Payload parts to write?", RD, "needParts", [
            K.add(ids, "add_node_GCparts", "Payload parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", STEP,
                  [(p, N(P, "data.partRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]],
                  labels={"organization_id": "Organization"}),
        ]),
        gate(ids, "cor_GCready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_GCready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code",
                                                                  "error_message", "error_details", "prepared_payload", "line_count"]]),
        ]),
        gate(ids, "cor_GCfail", "Job FAILED to write?", RD, "needJobUpd", [job_update(ids, "update_node_GCfail", "Job FAILED with the reason (lease released)", RD, "jobRows", JOB_PROPS)]),
        gate(ids, "cor_GCunlock", "GD lock to release?", RD, "needUnlock", [
            K.update(ids, "update_node_GCunlock", "Goods Delivery back to Created (nothing was written)", GD, ("id", "in", N(RD, "data.unlockRows.id")),
                     [("id", N(RD, "data.unlockRows.id")), ("gd_status", N(RD, "data.unlockRows.gd_status"))], labels={"gd_status": "GD Status"}),
        ]),
        K.sql("sql_node_GCback", "Read-back: the job after the write (the truth)", back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
        K.code("code_node_GCresult", "Result", code("prepare/result.js"), res_fields),
        K.ret("return_node_GCdone", "Return", [(f, N("code_node_GCresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_GD job the worker holds")], res_fields, nodes)



# =============================================================================================== GD_COMPLETE_COMMIT
GDL = "goods_delivery_fwii8mvb_sub:Table:1939904186426433537"
RESV = "On Reserved Goods Delivery:Table:1935880014687440897"
SOL = "sales_order_axszx8cj_sub:Table:1939903359943024642"
SOH = "Sales Order:Table:1902773735979597826"
ITEM = "Item:Table:1901546842240438273"
HU = "Handling Unit:Table:2036736671686529026"
HUI = "Items(Handling Unit):Table:2036977712276639745"
SNAPSHOT = ("GD_COMPLETION_SNAPSHOT", "2058818938677665794")
REORDER = ("REORDER_SET_REDIS", "2065256261729759233")
CONVERT_SI = ("GD_CONVERT_SI", "2070069049332416514")
STEP_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "finished_at", "inventory_operation_id", "result_ref", "error_code", "error_message"]
RES_FIELDS = ["job_id", "job_status", "path", "result_code", "result_message", "evidence"]
RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"]
CREATE_COLS = ["doc_type", "status", "parent_id", "parent_line_id", "parent_no", "doc_no", "doc_id", "doc_line_id", "material_id", "item_code", "item_name", "item_desc",
               "batch_id", "bin_location", "item_uom", "reserved_qty", "delivered_qty", "open_qty", "reserved_date", "line_no", "plant_id", "organization_id", "remark",
               "target_gd_id", "source_reserved_id", "handling_unit_id", "job_line_key"]
GC_LINE_COLS = ["prev_temp_qty_data", "customer_id", "organization_id", "plant_id", "billing_state_id", "billing_country_id", "shipping_state_id",
                "shipping_country_id", "assigned_to", "area_id", "line_index", "gd_undelivered_qty", "packing_qty", "net_weight"]
CG, CE = "code_node_CCguard", "code_node_CCentry"


def engine_fn(name):
    m = re.search(r"^function %s\(.*?^}\n" % name, raw("engine/core.js") + "\n", re.S | re.M)
    assert m, "engine/core.js has no function " + name
    return m.group(0).rstrip("\n")


def ccode(name, extra=()):
    inc = lambda x: engine_fn(x[7:]) if x.startswith("engine:") else raw(x) if x.startswith("lift/") else code(x)
    parts = [code("commit/_common.js"), code("commit/_cmp.js")] + [inc(x) for x in extra] + [code("commit/" + name)]
    body = "\n".join(parts)
    assert "{{" not in "\n".join(raw(x) for x in extra if x.startswith("lift/")), "a lifted body still holds a platform token"
    return body


RESULT_JS = "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\n"


def cres(tag, src, path):
    body = RESULT_JS + code("commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [K.code("code_node_CC%sres" % tag, "Result (%s)" % path, body, RES_FIELDS),
            K.ret("return_node_CC%s" % tag, "Return (%s)" % path, [(f, N("code_node_CC%sres" % tag, "data." + f)) for f in RES_FIELDS])]


def unlock_update(ids, nid, src):
    return K.update(ids, nid, "Goods Delivery back to Created (nothing but the snapshot was written)", GD, ("id", "in", N(src, "data.unlockRows.id")),
                    [("id", N(src, "data.unlockRows.id")), ("gd_status", N(src, "data.unlockRows.gd_status"))], labels={"gd_status": "GD Status"})


def end_block(ids, tag, src, title, unlock=False):
    nodes = [gate(ids, "cor_CC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
        job_update(ids, "update_node_CC%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW / FAILED (lease released)", src, "jobRows", JOB_PROPS)])]
    if unlock:
        nodes.append(gate(ids, "cor_CC%sunlock" % tag, "GD lock to release?", src, "needUnlock", [unlock_update(ids, "update_node_CC%sunlock" % tag, src)]))
    nodes += cres(tag, src, tag.upper() + "_END")
    return K.if_(ids, "if_CC%send" % tag, title, is_(src, "route", "END"), nodes)


def step_done(ids, tag, src, step):
    return gate(ids, "cor_CC%sstep" % tag, "%s DONE to record?" % step, src, "needStep", [
        K.add(ids, "add_node_CC%sstep" % tag, "%s DONE (unique job / step)" % step, STEP, [(p, N(src, "data.stepRows." + p)) for p in STEP_PROPS], labels={"organization_id": "Organization"})])


def step_add(ids, nid, title, src, field):
    return K.add(ids, nid, title, STEP, [(p, N(src, "data.%s.%s" % (field, p))) for p in STEP_PROPS], labels={"organization_id": "Organization"})


def slice_loop(ids, tag, src, field, title, table, props, labels=None):
    loop_id = "loop_CC%s" % tag
    sl = "code_node_CC%sslice" % tag
    body = code("commit/slice.js").replace("__LOOP__", loop_id)
    return K.loop(ids, loop_id, title, N(src, "data." + field), [
        K.code(sl, "This slice (the loop item: <= 250 rows)", body, ["n", "rows"], arrays=("rows",), objects=("n",)),
        K.update(ids, "update_node_CC%swrite" % tag, title + " (<= 250 per call)", table, ("id", "in", N(sl, "data.rows.id")), [(p, N(sl, "data.rows." + p)) for p in ["id"] + props], labels),
    ])


def tail_js(fn_call, log):
    return "\n" + fn_call


def build_commit():
    ids = K.Ids(1797200000000)
    T = "'%s'" % N(CG, "data.tenantId")
    JOBID = N(CG, "data.jobId")
    GDID = N(CE, "data.gdId")
    PFX = N(CE, "data.partPrefix")
    dt = lambda c: "DATE_FORMAT(%s, '%%Y-%%m-%%d %%H:%%i:%%s')" % c
    job = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%%Y-%%m-%%d %%H:%%i:%%s') AS lease_until,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.progress_percent, j.progress_message, j.attempt_count,
       %s AS next_attempt_at, j.lease_owner, %s AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live, (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = %s
   AND j.id = %s""" % (dt("j.next_attempt_at"), dt("j.lease_expires_at"), T, JOBID)
    steps = "SELECT st.step_name, st.step_status FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' AND st.step_name LIKE 'C%%' AND st.is_deleted = 0" % (T, JOBID)
    payload = "SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = %s AND j.id = %s" % (T, JOBID)
    gdlock = """SELECT g.gd_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GDC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN goods_delivery g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = %s AND j.id = %s AND j.correlation_id REGEXP '^GD\\\\|[0-9]{1,20}$'""" % (T, JOBID)
    own = "SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = %s AND j.id = %s" % (T, JOBID)
    part = lambda name: ("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' "
                         "AND st.step_name LIKE CONCAT('%s', '%s|%%') AND st.is_deleted = 0 ORDER BY st.step_name") % (T, JOBID, PFX, name)
    resrows = lambda idsref, creates: ("SELECT 'U' AS k, JSON_OBJECT('id', CAST(r.id AS CHAR), 'target_gd_id', r.target_gd_id, 'status', r.status, 'reserved_qty', r.reserved_qty, "
        "'open_qty', r.open_qty, 'delivered_qty', r.delivered_qty, 'doc_no', r.doc_no, 'doc_id', r.doc_id, 'doc_line_id', r.doc_line_id, "
        "'source_reserved_id', r.source_reserved_id, 'item_uom', CAST(r.item_uom AS CHAR), 'is_deleted', r.is_deleted) AS j\n  FROM on_reserved_gd r\n"
        " WHERE r.tenant_id = %s AND r.id IN (SELECT jt.i FROM JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) jt)" % (T, idsref)) + (
        ("\nUNION ALL\nSELECT 'C' AS k, JSON_OBJECT('id', CAST(r.id AS CHAR), 'job_line_key', r.job_line_key) AS j\n  FROM on_reserved_gd r\n"
         " WHERE r.tenant_id = %s AND r.job_line_key LIKE '%s' AND r.is_deleted = 0" % (T, creates)) if creates else "")
    hurows = lambda idsref: ("SELECT JSON_OBJECT('id', CAST(h.id AS CHAR), 'total_quantity', h.total_quantity, 'is_deleted', h.is_deleted) AS j\n  FROM handling_unit h\n"
        " WHERE h.tenant_id = %s AND h.id IN (SELECT jt.i FROM JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) jt)") % (T, idsref)
    huitems = lambda idsref: ("SELECT JSON_OBJECT('id', CAST(s.id AS CHAR), 'handling_unit_id', CAST(s.handling_unit_id AS CHAR), 'material_id', CAST(s.material_id AS CHAR), "
        "'batch_id', CAST(s.batch_id AS CHAR), 'quantity', s.quantity, 'is_deleted', s.is_deleted) AS j\n  FROM handling_unit_atu7sreg_sub s\n"
        " WHERE s.tenant_id = %s AND s.is_deleted = 0\n   AND s.handling_unit_id IN (SELECT jt.i FROM JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) jt)\n ORDER BY s.id") % (T, idsref)
    huprec = ("SELECT p.scope_type, p.rule_key, p.table_id, p.field_name, p.decimal_places, p.precision_rule, p.store_raw_value\n  FROM su_code_num_precision p\n"
        " WHERE p.tenant_id = %s\n   AND p.status = 1\n   AND p.is_deleted = 0\n   AND ((p.scope_type = '1' AND p.rule_key = 'Handling Unit Qty')\n"
        "     OR (p.scope_type = '2' AND p.table_id IN ('2036736671686529026', '2036977712276639745')))") % T
    so_lines = lambda src: ("SELECT JSON_OBJECT('id', CAST(sl.id AS CHAR), 'sales_order_id', CAST(sl.sales_order_id AS CHAR), 'parent_id', CAST(sl.parent_id AS CHAR), "
        "'item_bundle_id', CAST(sl.item_bundle_id AS CHAR), 'item_name', sl.item_name, 'so_quantity', sl.so_quantity, 'delivered_qty', sl.delivered_qty, "
        "'planned_qty', sl.planned_qty, 'outstanding_quantity', sl.outstanding_quantity, 'line_status', sl.line_status) AS j\n  FROM sales_order_axszx8cj_sub sl\n"
        " WHERE sl.tenant_id = %s AND sl.is_deleted = 0\n   AND (sl.sales_order_id IN (SELECT jt.i FROM JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) jt)\n"
        "        OR sl.id IN (SELECT jt.i FROM JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) jt))\n ORDER BY sl.id") % (T, N(src, "data.soIdsJson"), N(src, "data.lineIdsJson"))
    so_hdrs = lambda src: ("SELECT JSON_OBJECT('id', CAST(so.id AS CHAR), 'so_status', so.so_status, 'gd_status', so.gd_status, 'partially_delivered', so.partially_delivered, "
        "'fully_delivered', so.fully_delivered) AS j\n  FROM sales_order so\n WHERE so.tenant_id = %s AND so.is_deleted = 0\n"
        "   AND so.id IN (SELECT jt.i FROM JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) jt)\n ORDER BY so.id") % (T, N(src, "data.soIdsJson"))
    intent = lambda name: ("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' AND st.step_name LIKE '%s|I|%%' "
                           "AND st.is_deleted = 0 ORDER BY st.step_name") % (T, JOBID, name)
    gdraw = ("SELECT 'H' AS k, JSON_OBJECT('id', CAST(g.id AS CHAR), 'gd_status', g.gd_status, 'gd_total', CAST(g.gd_total AS CHAR), 'picking_status', g.picking_status, "
        "'so_id', CAST(g.so_id AS CHAR), 'so_no', g.so_no) AS j\n  FROM goods_delivery g\n WHERE g.tenant_id = %s AND g.id = %s AND g.is_deleted = 0\nUNION ALL\n"
        "SELECT 'L' AS k, JSON_OBJECT('id', CAST(l.id AS CHAR), 'prev_temp_qty_data', l.prev_temp_qty_data, 'customer_id', CAST(l.customer_id AS CHAR), "
        "'organization_id', l.organization_id, 'plant_id', CAST(l.plant_id AS CHAR), 'billing_state_id', CAST(l.billing_state_id AS CHAR), "
        "'billing_country_id', CAST(l.billing_country_id AS CHAR), 'shipping_state_id', CAST(l.shipping_state_id AS CHAR), "
        "'shipping_country_id', CAST(l.shipping_country_id AS CHAR), 'assigned_to', CAST(l.assigned_to AS CHAR), 'area_id', CAST(l.area_id AS CHAR), "
        "'line_index', l.line_index, 'gd_undelivered_qty', CAST(l.gd_undelivered_qty AS CHAR), 'packing_qty', CAST(l.packing_qty AS CHAR), "
        "'net_weight', CAST(l.net_weight AS CHAR)) AS j\n  FROM goods_delivery_fwii8mvb_sub l\n WHERE l.tenant_id = %s AND l.goods_delivery_id = %s AND l.is_deleted = 0") % (T, GDID, T, GDID)

    entry_fields = ["route", "phase", "dbNow", "jsAt", "jobId", "organizationId", "gdId", "gdNo", "idempotencyKey", "jobStatus", "rowVersion", "attempts", "leaseUntil", "unlockOk",
                    "partPrefix", "manifest", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "needC0", "needC1", "needC2", "needC3", "needC3H", "needC4",
                    "needC5", "needC6", "doneC6Reorder", "doneC6Si", "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows")
    rej_body = RESULT_JS + code("commit/result.js") + "\nreturn commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");" % (N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    nodes = [
        K.code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_CCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            K.code("code_node_CCrejres", "Result (REJECTED_INPUT)", rej_body, RES_FIELDS),
            K.ret("return_node_CCrej", "Return (rejected input)", [(f, N("code_node_CCrejres", "data." + f)) for f in RES_FIELDS])]),
        K.parallel("condition_all_CCfacts", "Facts in parallel: the job, its step rows, its manifest, the GD's status and lock", [
            ("cai_CCjob", "Job", [K.sql("sql_node_CCjob", "The job (+ DB clock, lease flag, lease_until, due)", job,
                ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                 "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted"])]),
            ("cai_CCsteps", "Steps", [K.sql("sql_node_CCsteps", "This job's C step rows", steps, ["step_name", "step_status"])]),
            ("cai_CCpayload", "Manifest", [K.sql("sql_node_CCpayload", "The prepared manifest", payload, ["prepared_payload"])]),
            ("cai_CCgd", "GD + lock", [K.sql("sql_node_CCgd", "The GD's status and its latest completion lock", gdlock, ["gd_status", "lock_ref"])]),
        ]),
        K.code(CE, "Entry: what this run does (phase A: C0 C1 C2, SPLIT; phase B: C3 C4 C5 C6, COMPLETED), the lease claim", ccode("entry.js") ,
               entry_fields, arrays=("jobRows", "unlockRows"), objects=("rowVersion", "attempts", "manifest")),
        K.if_(ids, "if_CCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_CCentryend", "IF the manifest is unusable: job FAILED (+ GD back to Created) or REQUIRES_REVIEW", "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
            gate(ids, "cor_CCefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_CCefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows", JOB_PROPS)]),
            gate(ids, "cor_CCefunlock", "GD lock to release?", CE, "needUnlock", [unlock_update(ids, "update_node_CCefunlock", CE)]),
        ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_CCclaim", "Lease claim: job COMMITTING_GD, lease_owner = this run, lease_expires_at = now + 10 min", CE, "jobRows", JOB_PROPS),
        K.sql("sql_node_CCown", "Read-back: the job after the lease claim", own, ["id", "job_status", "lease_owner", "row_version"]),
        K.code("code_node_CCown", "Own: COMMITTING_GD under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_CClost", "IF another run took the job: stop", is_("code_node_CCown", "route", "LOST"), cres("lost", "code_node_CCown", "LOST")),
        # ---------------------------------------------------------------- C0
        K.if_(ids, "if_CCc0", "IF C0 REVALIDATE is due", is_(CE, "needC0", "YES"), [
            K.parallel("condition_all_CCc0parts", "C0: the RES and HU parts in parallel", [
                ("cai_CCc0part", "RES part", [K.sql("sql_node_CCc0part", "C0: the RES part", part("RES"), ["step_name", "result_ref"])]),
                ("cai_CCc0hupart", "HU part", [K.sql("sql_node_CCc0hupart", "C0: the HU part", part("HU"), ["step_name", "result_ref"])]),
            ]),
            K.code("code_node_CCc0ids", "C0: the reservation ids and the handling units", ccode("c0_ids.js"), ["ok", "idsJson", "count", "huIdsJson"], objects=("count",)),
            K.parallel("condition_all_CCc0rows", "C0: those rows now, in parallel", [
                ("cai_CCc0rows", "Reservations", [K.sql("sql_node_CCc0rows", "C0: those reservations now", resrows(N("code_node_CCc0ids", "data.idsJson"), None), ["k", "j"])]),
                ("cai_CCc0hus", "Handling units", [K.sql("sql_node_CCc0hus", "C0: those handling units now", hurows(N("code_node_CCc0ids", "data.huIdsJson")), ["j"])]),
                ("cai_CCc0huitems", "HU items", [K.sql("sql_node_CCc0huitems", "C0: their item rows now", huitems(N("code_node_CCc0ids", "data.huIdsJson")), ["j"])]),
            ]),
            K.code("code_node_CCc0", "C0 REVALIDATE: GD still locked by this job, reservations as PREPARE read them, handling units hold enough -> DONE; else FAILED + GD back to Created",
                   ccode("c0.js", ("engine:roundDec", "commit/_hu.js")), chk, arrays=chk_arr),
            end_block(ids, "c0", "code_node_CCc0", "IF the delivery changed meanwhile", unlock=True),
            step_done(ids, "c0", "code_node_CCc0", "C0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- C1
        K.if_(ids, "if_CCc1", "IF C1 SNAPSHOT is due", is_(CE, "needC1", "YES"), [
            K.sql("sql_node_CCc1part", "C1: the SNAP part", part("SNAP"), ["step_name", "result_ref"]),
            K.code("code_node_CCc1in", "C1: GD_COMPLETION_SNAPSHOT's allData", ccode("c1_in.js"), ["ok", "allData"], objects=("allData",)),
            call(ids, "workflow_node_CCc1", "GD_COMPLETION_SNAPSHOT (what Revert Completed reads)", SNAPSHOT, [("allData", N("code_node_CCc1in", "data.allData"))]),
            K.code("code_node_CCc1", "C1 check: 200 -> DONE; else retry, then FAILED + GD back to Created", ccode("c1.js"), chk, arrays=chk_arr),
            end_block(ids, "c1", "code_node_CCc1", "IF the snapshot was not written", unlock=True),
            step_done(ids, "c1", "code_node_CCc1", "C1_SNAPSHOT"),
        ]),
        # ---------------------------------------------------------------- C2
        K.if_(ids, "if_CCc2", "IF C2 INVENTORY is due (phase A ends here: SPLIT)", is_(CE, "needC2", "YES"), [
            K.sql("sql_node_CCc2part", "C2: the ENGINE part", part("ENGINE"), ["step_name", "result_ref"]),
            K.code("code_node_CCc2in", "C2: the operation key and the movements", ccode("c2_in.js"), ["ok", "operationKey", "movements"], arrays=("movements",)),
            call(ids, "workflow_node_CCc2", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; GDC|<job> replays on a re-run)", ENGINE, [
                ("operation_key", N("code_node_CCc2in", "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")),
                ("movements", N("code_node_CCc2in", "data.movements"))]),
            K.sql("sql_node_CCc2ops", "C2: this operation's engine intent rows (any = it may have written)",
                  "SELECT COUNT(*) AS intents FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = 'GDC|%s' AND st.step_name LIKE 'IBA|I|%%' AND st.is_deleted = 0" % (T, JOBID), ["intents"]),
            K.code("code_node_CCc2", "C2 check: 200 -> DONE + SPLIT; 409 -> wait, then FAILED + GD back to Created (review once it has intent rows); 400 -> FAILED + GD back to Created; else review", ccode("c2.js"),
                   chk + ["splitRows", "needSplit"], arrays=chk_arr + ("splitRows",)),
            end_block(ids, "c2", "code_node_CCc2", "IF the stock did not move", unlock=True),
            step_done(ids, "c2", "code_node_CCc2", "C2_INVENTORY"),
            gate(ids, "cor_CCsplit", "SPLIT hand-over to write?", "code_node_CCc2", "needSplit", [
                job_update(ids, "update_node_CCsplit", "Job: SPLIT| hand-over lease (the next run does phase B)", "code_node_CCc2", "splitRows", JOB_PROPS)]),
        ] + cres("split", "code_node_CCc2", "SPLIT")),
        # ---------------------------------------------------------------- C3
        K.if_(ids, "if_CCc3", "IF C3 RESERVATIONS is due", is_(CE, "needC3", "YES"), [
            K.sql("sql_node_CCc3part", "C3: the RES part", part("RES"), ["step_name", "result_ref"]),
            K.code("code_node_CCc3ids", "C3: the reservation ids and the creates' key prefix", ccode("c3_ids.js"), ["ok", "idsJson", "createLike", "updates", "creates"], objects=("updates", "creates")),
            K.sql("sql_node_CCc3rows", "C3: those reservations now + this job's creates", resrows(N("code_node_CCc3ids", "data.idsJson"), N("code_node_CCc3ids", "data.createLike")), ["k", "j"]),
            K.code("code_node_CCc3plan", "C3 plan: write a row only while it holds what PREPARE read; each create once", ccode("c3_plan.js"),
                   ["route", "slices", "writeCount", "createRows", "needCreates", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"], arrays=("slices", "createRows", "jobRows"), objects=("writeCount",)),
            end_block(ids, "c3pl", "code_node_CCc3plan", "IF the reservations cannot be written"),
            slice_loop(ids, "c3", "code_node_CCc3plan", "slices", "C3 WRITE: on_reserved_gd", RESV, RES_COLS),
            gate(ids, "cor_CCc3add", "Reservations to create?", "code_node_CCc3plan", "needCreates", [
                K.add(ids, "add_node_CCc3add", "C3 WRITE: new on_reserved_gd rows (job_line_key <job>|C|<n>)", RESV, [(p, N("code_node_CCc3plan", "data.createRows." + p)) for p in CREATE_COLS])]),
            K.sql("sql_node_CCc3back", "C3 read-back", resrows(N("code_node_CCc3ids", "data.idsJson"), N("code_node_CCc3ids", "data.createLike")), ["k", "j"]),
            K.code("code_node_CCc3check", "C3 check: every row at its target, every create once -> DONE", ccode("c3_check.js"), chk, arrays=chk_arr),
            end_block(ids, "c3", "code_node_CCc3check", "IF C3 did not complete"),
            step_done(ids, "c3", "code_node_CCc3check", "C3_RESERVATIONS"),
        ]),
        # ---------------------------------------------------------------- C3H
        K.if_(ids, "if_CCc3h", "IF C3H HANDLING UNITS is due", is_(CE, "needC3H", "YES"), [
            K.sql("sql_node_CCc3hpart", "C3H: the HU part", part("HU"), ["step_name", "result_ref"]),
            K.code("code_node_CCc3hids", "C3H: the handling units the delivery draws from", ccode("c3h_ids.js"), ["ok", "idsJson", "count"], objects=("count",)),
            K.parallel("condition_all_CCc3hread", "C3H fresh reads in parallel", [
                ("cai_CCc3hhus", "Handling units", [K.sql("sql_node_CCc3hhus", "C3H: the handling units now", hurows(N("code_node_CCc3hids", "data.idsJson")), ["j"])]),
                ("cai_CCc3hitems", "HU items", [K.sql("sql_node_CCc3hitems", "C3H: their item rows now", huitems(N("code_node_CCc3hids", "data.idsJson")), ["j"])]),
                ("cai_CCc3hintent", "Intent", [K.sql("sql_node_CCc3hintent", "C3H: an intent of an earlier run", intent("C3H"), ["step_name", "result_ref"])]),
                ("cai_CCc3hprec", "Number rules", [K.sql("sql_node_CCc3hprec", "C3H: the tenant's Handling Unit Qty rules", huprec,
                    ["scope_type", "rule_key", "table_id", "field_name", "decimal_places", "precision_rule", "store_raw_value"])]),
            ]),
            K.code("code_node_CCc3hplan", "C3H plan: the classic HU decrements on the fresh rows -> intent; write what is at before", ccode("c3h_plan.js", ("engine:roundDec", "commit/_hu.js")),
                   ["route", "needIntent", "intentRows", "huSlices", "huCount", "itemSlices", "itemCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("intentRows", "huSlices", "itemSlices", "jobRows"), objects=("huCount", "itemCount")),
            end_block(ids, "c3hpl", "code_node_CCc3hplan", "IF the handling units cannot be written"),
            gate(ids, "cor_CCc3hintent", "Intent to record?", "code_node_CCc3hplan", "needIntent", [step_add(ids, "add_node_CCc3hintent", "C3H INTENT: C3H|I|<nnn> (before + after of every row)", "code_node_CCc3hplan", "intentRows")]),
            slice_loop(ids, "c3hh", "code_node_CCc3hplan", "huSlices", "C3H WRITE: Handling Unit total_quantity", HU, ["total_quantity"], {"total_quantity": "Total Item Quantity"}),
            slice_loop(ids, "c3hi", "code_node_CCc3hplan", "itemSlices", "C3H WRITE: HU item quantity", HUI, ["quantity"], {"quantity": "Quantity"}),
            K.parallel("condition_all_CCc3hback", "C3H read-back in parallel", [
                ("cai_CCc3hhusB", "Handling units", [K.sql("sql_node_CCc3hhusB", "C3H read-back: handling units", hurows(N("code_node_CCc3hids", "data.idsJson")), ["j"])]),
                ("cai_CCc3hitemsB", "HU items", [K.sql("sql_node_CCc3hitemsB", "C3H read-back: item rows", huitems(N("code_node_CCc3hids", "data.idsJson")), ["j"])]),
                ("cai_CCc3hintentB", "Intent", [K.sql("sql_node_CCc3hintentB", "C3H read-back: the intent", intent("C3H"), ["step_name", "result_ref"])]),
            ]),
            K.code("code_node_CCc3hcheck", "C3H check: every intent row at its after-value -> DONE", ccode("c3h_check.js", ("engine:roundDec", "commit/_hu.js")), chk, arrays=chk_arr),
            end_block(ids, "c3h", "code_node_CCc3hcheck", "IF C3H did not complete"),
            step_done(ids, "c3h", "code_node_CCc3hcheck", "C3H_HU"),
        ]),
        # ---------------------------------------------------------------- C4
        K.if_(ids, "if_CCc4", "IF C4 SALES ORDERS is due", is_(CE, "needC4", "YES"), [
            K.sql("sql_node_CCc4part", "C4: the SO part", part("SO"), ["step_name", "result_ref"]),
            K.code("code_node_CCc4ids", "C4: the Sales Orders and the SO lines of the delivery", ccode("c4_ids.js"), ["ok", "soIdsJson", "lineIdsJson"]),
            K.parallel("condition_all_CCc4read", "C4 fresh reads in parallel", [
                ("cai_CCc4lines", "SO lines", [K.sql("sql_node_CCc4lines", "C4: the SO lines now", so_lines("code_node_CCc4ids"), ["j"])]),
                ("cai_CCc4hdrs", "SO headers", [K.sql("sql_node_CCc4hdrs", "C4: the Sales Orders now", so_hdrs("code_node_CCc4ids"), ["j"])]),
                ("cai_CCc4intent", "Intent", [K.sql("sql_node_CCc4intent", "C4: an intent of an earlier run", intent("C4"), ["step_name", "result_ref"])]),
            ]),
            K.code("code_node_CCc4plan", "C4 plan: QtyCheckBatch + UMQapdjk + lwB2FVe0 (lifted) on the fresh rows -> intent; write what is at before", ccode("c4_plan.js", ("lift/runtime.js", "lift/lifted_commit.js", "prepare/adapter.js")),
                   ["route", "needIntent", "intentRows", "lineSlices", "lineCount", "headerRows", "needHeaders", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("intentRows", "lineSlices", "headerRows", "jobRows"), objects=("lineCount",)),
            end_block(ids, "c4pl", "code_node_CCc4plan", "IF the sales orders cannot be written"),
            gate(ids, "cor_CCc4intent", "Intent to record?", "code_node_CCc4plan", "needIntent", [step_add(ids, "add_node_CCc4intent", "C4 INTENT: C4|I|<nnn> (before + after of every row)", "code_node_CCc4plan", "intentRows")]),
            slice_loop(ids, "c4", "code_node_CCc4plan", "lineSlices", "C4 WRITE: SO lines", SOL, ["delivered_qty", "planned_qty", "outstanding_quantity", "line_status"]),
            gate(ids, "cor_CCc4hdr", "Sales Orders to write?", "code_node_CCc4plan", "needHeaders", [
                K.update(ids, "update_node_CCc4hdr", "C4 WRITE: Sales Order status", SOH, ("id", "in", N("code_node_CCc4plan", "data.headerRows.id")),
                         [(p, N("code_node_CCc4plan", "data.headerRows." + p)) for p in ["id", "so_status", "gd_status", "partially_delivered", "fully_delivered"]])]),
            K.parallel("condition_all_CCc4back", "C4 read-back in parallel", [
                ("cai_CCc4linesB", "SO lines", [K.sql("sql_node_CCc4linesB", "C4 read-back: SO lines", so_lines("code_node_CCc4ids"), ["j"])]),
                ("cai_CCc4hdrsB", "SO headers", [K.sql("sql_node_CCc4hdrsB", "C4 read-back: Sales Orders", so_hdrs("code_node_CCc4ids"), ["j"])]),
                ("cai_CCc4intentB", "Intent", [K.sql("sql_node_CCc4intentB", "C4 read-back: the intent", intent("C4"), ["step_name", "result_ref"])]),
            ]),
            K.code("code_node_CCc4check", "C4 check: every intent row at its after-values -> DONE", ccode("c4_check.js", ("prepare/adapter.js",)), chk, arrays=chk_arr),
            end_block(ids, "c4", "code_node_CCc4check", "IF C4 did not complete"),
            step_done(ids, "c4", "code_node_CCc4check", "C4_SO"),
        ]),
        # ---------------------------------------------------------------- C5
        K.if_(ids, "if_CCc5", "IF C5 THE DELIVERY is due", is_(CE, "needC5", "YES"), [
            K.parallel("condition_all_CCc5read", "C5 reads in parallel", [
                ("cai_CCc5part", "GD part", [K.sql("sql_node_CCc5part", "C5: the GD part", part("GD"), ["step_name", "result_ref"])]),
                ("cai_CCc5raw", "GD now", [K.sql("sql_node_CCc5raw", "C5: the GD and its lines as stored (raw)", gdraw, ["k", "j"])]),
            ]),
            K.code("code_node_CCc5plan", "C5 plan: the patches on the stored values; changed lines in slices, the header", ccode("c5_plan.js"),
                   ["route", "headerRows", "soRows", "needSoHead", "lineSlices", "lineCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("headerRows", "soRows", "lineSlices", "jobRows"), objects=("lineCount",)),
            end_block(ids, "c5pl", "code_node_CCc5plan", "IF the delivery cannot be written"),
            slice_loop(ids, "c5", "code_node_CCc5plan", "lineSlices", "C5 WRITE: GD lines", GDL, GC_LINE_COLS),
            gate(ids, "cor_CCc5so", "Order list to write?", "code_node_CCc5plan", "needSoHead", [
                K.update(ids, "update_node_CCc5so", "C5 WRITE: the GD's order list", GD, ("id", "in", N("code_node_CCc5plan", "data.soRows.id")),
                         [(p, N("code_node_CCc5plan", "data.soRows." + p)) for p in ["id", "so_id", "so_no"]])]),
            K.update(ids, "update_node_CCc5head", "C5 WRITE: the GD Completed (gd_status, gd_total, picking_status)", GD, ("id", "in", N("code_node_CCc5plan", "data.headerRows.id")),
                     [(p, N("code_node_CCc5plan", "data.headerRows." + p)) for p in ["id", "gd_status", "gd_total", "picking_status"]], labels={"gd_status": "GD Status"}),
            K.sql("sql_node_CCc5back", "C5 read-back (raw)", gdraw, ["k", "j"]),
            K.code("code_node_CCc5check", "C5 check: Completed, every patch reads back -> DONE", ccode("c5_check.js"), chk, arrays=chk_arr),
            end_block(ids, "c5", "code_node_CCc5check", "IF C5 did not complete"),
            step_done(ids, "c5", "code_node_CCc5check", "C5_GD"),
        ]),
        # ---------------------------------------------------------------- C6 + finish
        K.if_(ids, "if_CCc6", "IF C6 AFTER is due: item dates, reorder, auto-SI", is_(CE, "needC6", "YES"), [
            K.sql("sql_node_CCc6part", "C6: the AFTER part", part("AFTER"), ["step_name", "result_ref"]),
            K.code("code_node_CCc6", "C6 plan: item dates in slices; REORDER_SET_REDIS and auto-SI at most once", ccode("c6_in.js"),
                   ["route", "itemSlices", "reorderRows", "needReorder", "reorderPrevious", "reorderLatest", "siRows", "needSi", "gdIds", "stepRows", "needStep", "jobRows", "needJobUpd"],
                   arrays=("itemSlices", "reorderRows", "reorderPrevious", "reorderLatest", "siRows", "gdIds", "stepRows", "jobRows")),
            end_block(ids, "c6", "code_node_CCc6", "IF the after part cannot be read"),
            slice_loop(ids, "c6", "code_node_CCc6", "itemSlices", "C6 WRITE: Item last_transaction_date", ITEM, ["last_transaction_date"]),
            gate(ids, "cor_CCc6reorder", "Reorder tracking to run?", "code_node_CCc6", "needReorder", [
                step_add(ids, "add_node_CCc6reorder", "C6_REORDER marker (written before the call: at most once)", "code_node_CCc6", "reorderRows"),
                call(ids, "workflow_node_CCc6reorder", "REORDER_SET_REDIS GD_COMPLETED", REORDER, [
                    ("document_type", "GD_COMPLETED", "value"), ("previous_data", N("code_node_CCc6", "data.reorderPrevious")), ("latest_data", N("code_node_CCc6", "data.reorderLatest")),
                    ("organization_id", N(CE, "data.organizationId"))]),
            ]),
            gate(ids, "cor_CCc6si", "Auto Sales Invoice to create?", "code_node_CCc6", "needSi", [
                step_add(ids, "add_node_CCc6si", "C6_SI marker (written before the call: at most once)", "code_node_CCc6", "siRows"),
                call(ids, "workflow_node_CCc6si", "GD_CONVERT_SI (headless, as the old path's auto-SI)", CONVERT_SI, [
                    ("ids", N("code_node_CCc6", "data.gdIds")), ("convert_to", "completed", "value"), ("is_multiple", "multiple", "value"),
                    ("filter_draft", "no", "value"), ("source", "auto", "value")]),
            ]),
        ]),
        K.code("code_node_CCfinish", "FINISH: C6 DONE, the job COMPLETED (an auto-SI that did not invoice is reported on the job)", ccode("finish.js"),
               ["stepRows", "jobRows", "result_message", "siFailed"], arrays=("stepRows", "jobRows"), objects=("siFailed",)),
        gate(ids, "cor_CCfinstep", "C6 DONE to record?", CE, "needC6", [step_add(ids, "add_node_CCfinstep", "C6_AFTER DONE", "code_node_CCfinish", "stepRows")]),
        job_update(ids, "update_node_CCdone", "Job COMPLETED (lease released)", "code_node_CCfinish", "jobRows", JOB_PROPS),
    ] + cres("done", "code_node_CCfinish", "DONE")
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_GD job (READY_TO_COMMIT, or COMMITTING_GD to resume)")], RES_FIELDS, nodes)


# =============================================================================================== GD_COMPLETE_WORKER
# PICKING_ASYNC_WORKER (pkv2tools build.py build_worker, == deployed) with the GD's names: polls COMPLETE_GD only; the lock
# to release before COMMIT is the GD's Processing status (gd_id = the GD when it is Processing under this job's lock, else 0)
IDS_FILE = os.path.join(HERE, "ids.json")
GD_IDS = json.load(open(IDS_FILE)) if os.path.exists(IDS_FILE) else {}


def wcode(path, subs=None):
    body = code(os.path.join("worker", path))
    if "//@include _common.js\n" in body:
        body = body.replace("//@include _common.js\n", code("worker/_common.js") + "\n")
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
    ids = K.Ids(1797300000000)
    G = "code_node_GWguard"
    T = N(G, "data.tenantId")
    prep = ("GD_COMPLETE_PREPARE", GD_IDS.get("GD_COMPLETE_PREPARE", "0"))
    comm = ("GD_COMPLETE_COMMIT", GD_IDS.get("GD_COMPLETE_COMMIT", "0"))
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
                AND j.command = 'COMPLETE_GD'
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
  %(LOCK)s""" % {"T": T, "IDS": N("code_node_GWplan", "data.jobIdsSql"), "GDCOL": GD_ID_COL, "LOCK": GD_LOCK_JOIN}
    final = """SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.attempt_count, j.lease_owner, j.error_code, j.error_message, SUBSTRING(j.correlation_id, 4) AS gd_id
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id IN (%s)""" % (T, N("code_node_GWplan", "data.jobIdsSql"))
    JOBREF = N("code_node_GWpick", "data.jobId")

    def jobread(nid, title):
        return K.sql(nid, title, wjob_sql(T, JOBREF), WJOB_COLS)

    def gd_unlock(nid, title, src, field="unlockRows"):
        return K.update(ids, nid, title, GD, ("id", "in", N(src, "data.%s.id" % field)),
                        [("id", N(src, "data.%s.id" % field)), ("gd_status", N(src, "data.%s.gd_status" % field))], labels={"gd_status": "GD Status"})

    def wjob_update(nid, title, src, field="jobRows", props=JOB_PROPS):
        return job_update(ids, nid, title, src, field, props)

    def publish(prefix, mid_node, which, wf_title):
        resp, back, after = "code_node_GW%sResp" % prefix, "sql_node_GW%sBack" % prefix, "code_node_GW%sAfter" % prefix
        return [
            call(ids, "workflow_node_GW%s" % prefix, wf_title, comm, [("job_id", JOBREF)]),
            K.code(resp, "The %s response, normalized (evidence; the job row decides)" % which,
                   wcode("callee.js", {"__WHAT__": which, "__NODE__": "workflow_node_GW%s" % prefix, "\"__EXTRA__\"": "\"path\""}),
                   ["called", "job_id", "job_status", "result_code", "result_message", "path"]),
            jobread(back, "Read-back: the job after the %s (the truth)" % which),
            K.code(after, "After the %s: COMMIT wrote the job itself; the worker writes only when nothing was saved" % which,
                   wcode("after_publish.js", {"__WHICH__": which, "__MID__": mid_node, "__RESP__": resp, "__BACK__": back}),
                   ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "publishRoute", "result_code", "result_message", "job_status"],
                   arrays=("jobRows", "unlockRows")),
            gate(ids, "cor_GW%sJob" % prefix, "Job row to write after the %s?" % which, after, "needJobUpd", [wjob_update("update_node_GW%sJob" % prefix, "Job: FAILED (a hard code) / retry with backoff (lease released)", after)]),
            gate(ids, "cor_GW%sUnlock" % prefix, "GD lock to release after the %s?" % which, after, "needUnlock", [gd_unlock("update_node_GW%sUnlock" % prefix, "Goods Delivery back to Created (nothing was saved)", after)]),
        ]

    plan_ref = "[%s][0]" % N("code_node_GWplan", "data")
    nodes = [
        K.code(G, "Guard: optional job_id, session tenant, this run's lease owner WRK|<nonce>", wcode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_GWreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_GWrejres", "Result (REJECTED_INPUT)", wcode("result.js", {"__PATH__": "REJECTED_INPUT", "__PLAN__": "null", "__ROWS__": "[]"}), res_fields),
            K.ret("return_node_GWrej", "Return (invalid input)", [(f, N("code_node_GWrejres", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_GWpoll", "Poll: the due COMPLETE_GD jobs of the tenant (at most 5, oldest first; lease expired or never set; backoff over; no live claim row) + DB clock", poll,
              ["db_now", "id", "organization_id", "gd_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
               "lease_expires_at", "dead_lease", "row_version", "error_code", "error_message", "error_details", "claim_id", "claim_started_at", "claim_owner"]),
        K.code("code_node_GWplan", "Plan: the loop's items (the due jobs with their claim facts), the run start", wcode("plan.js"),
               ["route", "dbNow", "runStart", "items", "count", "jobIdsSql", "result_code", "result_message"], arrays=("items",)),
        K.set_cache("set_cache_GWidx0", "Loop index = 0 (per run: the key carries this run's nonce)", "gdc_wrk_" + N(G, "data.nonce"), "0"),
        K.loop(ids, "loop_GWjobs", "Loop over the planned jobs (in order; a lost claim gate ends the tick, the rest wait for the next)", N("code_node_GWplan", "data.items"), [
            K.get_cache("get_cache_GWidx", "Loop index", "gdc_wrk_" + N(G, "data.nonce")),
            K.sql("sql_node_GWtick", "Tick: the FRESH read of the planned jobs (state, lease, backoff, claim row) + the lease end of a claim made now", tick,
                  ["db_now", "lease_until", "id", "organization_id", "gd_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
                   "lease_owner", "lease_expires_at", "lease_live", "dead_lease", "due_now", "row_version", "error_code", "error_message", "error_details", "claim_id",
                   "claim_started_at", "claim_owner", "claim_live"]),
            K.code("code_node_GWpick", "Pick: the item by index; SKIP after the budget / not due / live lease / live claim; the claim gate rows", wcode("pick.js"),
                   ["route", "index", "nextIndex", "dbNow", "leaseUntil", "elapsed", "jobId", "organizationId", "gdId", "item", "rvBase", "rvRows", "needRvUpd", "claimName",
                    "claimRows", "needClaimAdd", "result_message"], arrays=("rvRows", "claimRows"), objects=("item",)),
            gate(ids, "cor_GWrv", "Dead claim to move past (row_version = v + 1)?", "code_node_GWpick", "needRvUpd", [
                wjob_update("update_node_GWrv", "Job: row_version = v + 1 and the retry count (absolute)", "code_node_GWpick", "rvRows", ["id", "row_version", "attempt_count"])]),
            gate(ids, "cor_GWclaimAdd", "Claim row to insert?", "code_node_GWpick", "needClaimAdd", [
                step_add(ids, "add_node_GWclaim", "CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> (unique tenant / job / step: a twin's insert fails and its run ends)", "code_node_GWpick", "claimRows")]),
            K.code("code_node_GWclaim", "Claim: the lease / state write; a dead lease or claim = one retry; exhausted after max_retries", wcode("claim.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "gdId", "rowVersion", "attempts", "claimRows", "needClaim", "failRows", "unlockRows", "exhausted",
                    "result_code", "result_message", "job_status"], arrays=("claimRows", "failRows", "unlockRows")),
            gate(ids, "cor_GWlease", "Lease / state to write?", "code_node_GWclaim", "needClaim", [
                wjob_update("update_node_GWlease", "Lease write: WRK|<nonce> for 10 min, VALIDATING for a QUEUED job, the retry count", "code_node_GWclaim", "claimRows")]),
            jobread("sql_node_GWown", "Read-back: the job after the lease write"),
            K.code("code_node_GWown", "Own: state and lease as written -> PREPARE / PUBLISH / RESUME / EXHAUST; else LOST", wcode("own.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "gdId", "attempts", "failRows", "unlockRows", "needFail", "needUnlock", "rowVersion",
                    "result_code", "result_message", "job_status"], arrays=("failRows", "unlockRows")),
            gate(ids, "cor_GWfail", "Exhausted: job row to write?", "code_node_GWown", "needFail", [
                wjob_update("update_node_GWfail", "Job FAILED (pre-commit) / REQUIRES_REVIEW (COMMITTING_GD)", "code_node_GWown", "failRows")]),
            gate(ids, "cor_GWfailUnlock", "Exhausted pre-commit: GD lock to release?", "code_node_GWown", "needUnlock", [
                gd_unlock("update_node_GWfailUnlock", "Goods Delivery back to Created (nothing was saved)", "code_node_GWown")]),
            K.if_(ids, "if_GWprep", "IF the job is pre-commit under this run's lease: the ONE GD_COMPLETE_PREPARE call", is_("code_node_GWown", "route", "PREPARE"), [
                call(ids, "workflow_node_GWprep", "GD_COMPLETE_PREPARE (set-based reads; writes the job + releases the lock on FAILED)", prep, [("job_id", JOBREF)]),
                K.code("code_node_GWprepResp", "The prepare response, normalized (evidence; the job row decides)",
                       wcode("callee.js", {"__WHAT__": "prepare", "__NODE__": "workflow_node_GWprep", "\"__EXTRA__\"": "\"evidence\""}),
                       ["called", "job_id", "job_status", "result_code", "result_message", "evidence"]),
                jobread("sql_node_GWprepBack", "Read-back: the job after prepare (the truth)"),
                K.code("code_node_GWafterPrep", "After prepare: READY_TO_COMMIT -> publish; FAILED -> lease released; else a hard code fails it / a counted retry", wcode("after_prepare.js"),
                       ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "prepareResult", "prepareMessage", "result_code", "result_message", "job_status"],
                       arrays=("jobRows", "unlockRows")),
                gate(ids, "cor_GWprepJob", "Job row to write after prepare?", "code_node_GWafterPrep", "needJobUpd", [
                    wjob_update("update_node_GWprepJob", "Job: lease released / FAILED / retry with backoff", "code_node_GWafterPrep")]),
                gate(ids, "cor_GWprepUnlock", "GD lock to release after prepare?", "code_node_GWafterPrep", "needUnlock", [
                    gd_unlock("update_node_GWprepUnlock", "Goods Delivery back to Created (nothing was saved)", "code_node_GWafterPrep")]),
            ]),
            jobread("sql_node_GWmid", "The job before the publish decision"),
            K.code("code_node_GWmid", "Before publish: READY_TO_COMMIT under this run's lease, or COMMITTING_GD with no live lease -> PUBLISH", wcode("mid.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_GWpub", "IF the job is to be published / resumed: the ONE GD_COMPLETE_COMMIT call", is_("code_node_GWmid", "route", "PUBLISH"),
                  publish("pub", "code_node_GWmid", "publish", "GD_COMPLETE_COMMIT (phase A: revalidate, snapshot, inventory; or phase B on a resume)")),
            jobread("sql_node_GWsplit", "The job after the publish call (the split decision)"),
            K.code("code_node_GWsplit", "Second publish: COMMITTING_GD under a SPLIT| hand-over lease -> PUBLISH again", wcode("split.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_GWpub2", "IF GD_COMPLETE_COMMIT ended SPLIT: the second call (reservations, sales orders, the delivery, after)", is_("code_node_GWsplit", "route", "PUBLISH"),
                  publish("pub2", "code_node_GWsplit", "second publish", "GD_COMPLETE_COMMIT again after its SPLIT (phase B)")),
            K.set_cache("set_cache_GWidxN", "Next loop index", "gdc_wrk_" + N(G, "data.nonce"), N("code_node_GWpick", "data.nextIndex")),
        ]),
        K.sql("sql_node_GWfinal", "Read-back: the planned jobs (final)", final, ["id", "job_status", "attempt_count", "lease_owner", "error_code", "error_message", "gd_id"]),
        K.code("code_node_GWresult", "Result (DONE)", wcode("result.js", {"__PATH__": "DONE", "__PLAN__": plan_ref, "__ROWS__": "[%s][0]" % N("sql_node_GWfinal", "data")}), res_fields),
        K.ret("return_node_GWdone", "Return the tick's result", [(f, N("code_node_GWresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "optional: gd_async_job.id (digits) to drive this job only (the form's kick after a submit); empty under Quartz: the oldest due jobs of the session tenant (at most 5 per tick)")],
                      res_fields, nodes)

# =============================================================================================== GD_COMPLETE_SUBMIT
CREDIT_LIMIT = ("CREDIT_LIMIT_CHECK", "1990247316342333442")
SUB_RES = ["route", "code", "message", "reason", "job_id", "job_status", "gd_id", "gd_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "evidence"]


def scode(name):
    return code("submit/_common.js") + "\n" + code("submit/" + name)


def gate_code():
    F = json.load(open(os.path.join(HERE, "lift", "fields.json")))
    kinds = {"header": F["goods_delivery"], "line": F["goods_delivery_fwii8mvb_sub"]}
    lifted = raw("lift/lifted_prepare.js")
    assert "{{" not in lifted, "a lifted body still holds a platform token"
    return "\n".join([raw("lift/runtime.js"), lifted, code("prepare/adapter.js"), code("prepare/chain.js"), code("submit/required.js"), code("submit/_common.js"),
                      "const GC_KINDS = " + json.dumps(kinds, separators=(",", ":")) + ";", code("submit/gate.js"), code("submit/gate_tail.js")])


def build_submit():
    ids = K.Ids(1797400000000)
    G, E, GT, PO = "code_node_GSguard", "code_node_GSentry", "code_node_GSgate", "code_node_GSpost"
    T, GD_ID = N(G, "data.tenantId"), N(G, "data.gdId")
    open_sets = ("(o.command = 'COMPLETE_GD' AND o.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'REQUIRES_REVIEW'))\n"
                 "                 OR (o.command = 'COMPLETE_PACKING' AND o.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PACKING', 'REQUIRES_REVIEW'))\n"
                 "                 OR (o.command = 'EDIT_GD' AND o.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED'))")
    facts = """SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(g.id AS CHAR) AS gd_id,
       g.delivery_no,
       g.gd_status,
       g.organization_id,
       CAST(g.plant_id AS CHAR) AS plant_id,
       (SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub l WHERE l.tenant_id = '@T' AND l.goods_delivery_id = @G AND l.is_deleted = 0) AS line_count,
       (SELECT p.step_name FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'GDC|@G' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS last_lock,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(o.id AS CHAR), 'command', o.command, 'job_status', o.job_status, 'progress_percent', o.progress_percent,
                                             'progress_message', o.progress_message, 'error_code', o.error_code, 'error_message', o.error_message)) AS CHAR)
          FROM gd_async_job o
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0 AND o.correlation_id = 'GD|@G'
           AND (@OPEN)) AS open_jobs,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(pj.id AS CHAR), 'command', pj.command, 'job_status', pj.job_status)) AS CHAR)
          FROM gd_async_job pj
         WHERE pj.tenant_id = '@T' AND pj.is_deleted = 0 AND pj.command = 'CONFIRM_PICKING'
           AND pj.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND EXISTS (SELECT 1 FROM transfer_order_jz8m9w3h_sub ti
                        WHERE ti.transfer_order_id = pj.picking_id AND ti.tenant_id = '@T' AND ti.is_deleted = 0
                          AND ti.gd_id = @G AND IFNULL(ti.line_status, '') <> 'Cancelled')) AS picking_jobs,
       (SELECT CAST(JSON_OBJECT('id', CAST(x.id AS CHAR), 'job_status', x.job_status, 'progress_percent', x.progress_percent, 'progress_message', x.progress_message,
                                'error_code', x.error_code, 'error_message', x.error_message) AS CHAR)
          FROM gd_async_job x
         WHERE x.tenant_id = '@T' AND x.is_deleted = 0 AND x.command = 'COMPLETE_GD' AND x.correlation_id = 'GD|@G'
         ORDER BY x.id DESC LIMIT 1) AS last_job
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN goods_delivery g
    ON g.tenant_id = '@T'
   AND g.id = @G
   AND g.is_deleted = 0""".replace("@OPEN", open_sets).replace("@T", T).replace("@G", GD_ID)
    back = """SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       g.gd_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'GDC|@G' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM (SELECT 1 AS one) x
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.organization_id = '@O'
   AND j.idempotency_key = '@KEY'
   AND j.is_deleted = 0
  LEFT JOIN goods_delivery g
    ON g.tenant_id = '@T'
   AND g.id = @G
   AND g.is_deleted = 0""".replace("@T", T).replace("@G", GD_ID).replace("@O", N(E, "data.organizationId")).replace("@KEY", N(PO, "data.idemKey"))

    def sres(tag, src, title, back_node=None):
        call_ = "submitResult([%s][0], %s, [%s][0], %s)" % (N(G, "data"), "null" if src == G else "[%s][0]" % N(E, "data"), N(src, "data"),
                                                          "[%s][0]" % N(back_node, "data") if back_node else "null")
        body = scode("result.js") + "\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, job: res.job_id }));\nreturn res;" % call_
        return [K.code("code_node_GS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_GS%s" % tag, "Return (%s)" % title, [(f, N("code_node_GS%sres" % tag, "data." + f)) for f in SUB_RES])]

    reads = [("hdr", "The Goods Delivery (every schema field)"), ("lines", "Its lines, top-level and bundle items"),
             ("setup", "Picking Setup + Packing Setup of the organization"), ("link", "Internal-trading links of its Sales Orders"),
             ("items", "Items of its lines (flags, serial management, UOM)"), ("sohl", "Sales Order lines it points at (QtyCheckBatch's columns)")]
    read_nodes = [("cai_GS" + k, k, [K.sql("sql_node_GS" + k, title, PSQL[k].replace("code_node_GCentry", E), ["j"] if k != "setup" else ["k", "j"])]) for k, title in reads]
    entry_fields = ["route", "code", "message", "reason", "tenantId", "gdId", "gdNo", "organizationId", "plantId", "lineCount", "dbNow", "lockN", "jobId", "jobStatus",
                    "progressPercent", "progressMessage", "errorCode", "errorMessage"]
    nodes = [
        K.code(G, "Guard: operation, gd_id (digits), source, answers, session tenant + user", scode("guard.js"),
               ["route", "code", "message", "operation", "gdId", "tenantId", "source", "uid", "causationId", "answers"], objects=("answers",)),
        K.if_(ids, "if_GSreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), sres("rej", G, "rejected input")),
        K.sql("sql_node_GSfacts", "Facts: the GD, its line count, its latest completion lock, open COMPLETE_GD / COMPLETE_PACKING / EDIT_GD jobs, open Picking V2 confirms of its Pickings, the latest COMPLETE_GD job, DB clock", facts,
              ["db_now", "gd_id", "delivery_no", "gd_status", "organization_id", "plant_id", "line_count", "last_lock", "open_jobs", "picking_jobs", "last_job"]),
        K.code(E, "Entry: STATUS; SUBMIT goes on for a Created GD with no open job (BUSY / NOT_ELIGIBLE / STOP otherwise)", scode("entry.js"), entry_fields,
               objects=("lineCount", "lockN", "progressPercent")),
        K.if_(ids, "if_GSanswer", "IF answered here (STATUS / BUSY / NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"), sres("ans", E, "entry")),
        K.parallel("condition_all_GSread", "PREPARE's reads in parallel (no row limits)", read_nodes),
        K.code(GT, "Gate: unsaved form edits, what PREPARE refuses, then GOODS_DELIVERY's gates to CHECK_REQUIRED_FIELD in its order (lifted)", gate_code(),
               ["route", "code", "message", "reason", "needCL", "clAutoOverride", "customer", "total", "post", "overrides"], objects=("customer", "total", "post", "overrides")),
        K.if_(ids, "if_GSgateEnd", "IF the gate answered (NOT_ELIGIBLE / 400 / 401): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"), sres("gate", GT, "gate")),
        K.if_(ids, "if_GScl", "IF the credit limit is to be checked (GOODS_DELIVERY's Need CL?)", is_(GT, "needCL", "required"), [
            call(ids, "workflow_node_GScl", "CREDIT_LIMIT_CHECK (as GOODS_DELIVERY calls it)", CREDIT_LIMIT, [
                ("customer_id", N(GT, "data.customer")), ("total", N(GT, "data.total")), ("document_type", "Goods Delivery", "value")]),
        ]),
        K.code(PO, "Post: 402 / 403, 405 / 406 / 407, the quantity 400s, 412; else the lock, job and Processing rows", scode("post.js"),
               ["route", "code", "message", "idemKey", "lockRows", "jobRows", "gdRows"], arrays=("lockRows", "jobRows", "gdRows")),
        K.if_(ids, "if_GSpostEnd", "IF a gate answered: answer, write nothing", "'%s' != 'QUEUE'" % N(PO, "data.route"), sres("post", PO, "post")),
        K.add(ids, "add_node_GSlock", "LOCK: gd_publish_step GDC|<gd> / LOCK|<n> (unique tenant / job / step: a concurrent submit fails its run)", STEP,
              [(p, N(PO, "data.lockRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "result_ref"]],
              labels={"organization_id": "Organization"}),
        K.add(ids, "add_node_GSjob", "Job insert: COMPLETE_GD QUEUED (idempotency_key GDC|<gd>|<n>, correlation_id GD|<gd>)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in ["organization_id", "plant_id", "command", "idempotency_key", "job_status", "progress_percent", "progress_message",
                                                      "attempt_count", "row_version", "cancel_requested", "next_attempt_at", "request_payload", "causation_id", "correlation_id", "line_count", "queued_at"]],
              labels={"organization_id": "Organization"}),
        K.update(ids, "update_node_GSgd", "Goods Delivery Processing (the lock every writer honours)", GD, ("id", "in", N(PO, "data.gdRows.id")),
                 [("id", N(PO, "data.gdRows.id")), ("gd_status", N(PO, "data.gdRows.gd_status"))], labels={"gd_status": "GD Status"}),
        K.sql("sql_node_GSback", "Read-back: the job, the GD's status, its latest lock", back, ["job_id", "job_status", "gd_status", "lock_ref"]),
        K.code("code_node_GSdue", "Due: the GD is Processing under this job's lock -> the job due now", scode("due.js"), ["dueRows", "needDue"], arrays=("dueRows",)),
        gate(ids, "cor_GSdue", "Job to make due?", "code_node_GSdue", "needDue", [
            K.update(ids, "update_node_GSdue", "Job due now (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_GSdue", "data.dueRows.id")),
                     [("id", N("code_node_GSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_GSdue", "data.dueRows.next_attempt_at"))])]),
    ] + sres("done", PO, "queued", "sql_node_GSback")
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"), ("gd_id", "string", "goods_delivery.id (digits)"),
                       ("source", "string", "FORM (default) | LIST | PICKING | PACKING"),
                       ("answers", "any", "{ needCL, continueZero, isForceComplete, auto_si_confirmed, auto_si_skip } as GOODS_DELIVERY takes them"),
                       ("form", "any", "FORM only: the form's data (allData) - unsaved edits go to the classic save"),
                       ("causation_id", "string", "optional: what caused this completion (e.g. a Packing job id)")], SUB_RES, nodes)


BUILDERS = [("GD_COMPLETE_PREPARE", build_prepare), ("GD_COMPLETE_COMMIT", build_commit), ("GD_COMPLETE_WORKER", build_worker),
            ("GD_COMPLETE_SUBMIT", build_submit)]

SQL_WIDTH = 160
SQL_BREAK = ",\n\t\t"


def wrap_sql(text):
    """A long SQL line breaks after ", " outside quotes (the platform's addDraft failed on a 5,681-char SQL line, 2026-10-14;
    no deployed dev workflow has an SQL line over 2,047)"""
    assert SQL_BREAK not in text
    out, line, quote, i = [], 0, False, 0
    while i < len(text):
        c = text[i]
        out.append(c)
        line = 0 if c == "\n" else line + 1
        if c == "'":
            quote = not quote
        elif c == "," and not quote and line > SQL_WIDTH and text[i + 1:i + 2] == " ":
            out.append(SQL_BREAK[1:])
            line = len(SQL_BREAK) - 2
            i += 1
        i += 1
    w = "".join(out)
    assert w.replace(SQL_BREAK, ", ") == text, "wrapping changed the SQL"
    return w


def wrap_doc_sql(doc):
    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                n["data"]["script"]["code"] = wrap_sql(n["data"]["script"]["code"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return doc


if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, fn in BUILDERS:
        if want and name not in want:
            continue
        doc = wrap_doc_sql(fn())
        K.check_ids(doc)
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        path = os.path.join(OUT, name + ".json")
        print(f"{name}: {len(text)} chars, {len(K.check_ids(doc))} nodes" + (f" -> {path}" if WRITE else " (dry; --write to save)"))
        if WRITE:
            os.makedirs(OUT, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text + "\n")
