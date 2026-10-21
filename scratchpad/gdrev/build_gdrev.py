"""Builds GD Revert V2's workflows - GD_REVERT_PREPARE, GD_REVERT_COMMIT, GD_REVERT_WORKER, GD_REVERT_SUBMIT - as FlowGram JSON with
GD Completed V2's wfkit (scratchpad/gdc/pkv2tools/wfkit.py, imported by path, unchanged) into Goods Delivery/RevertV2/.
Step code: code/{prepare,commit,submit,worker}/*.js. The classic revert's code nodes run lifted (lift/lifted_revert.js =
GD_REVERT_COMPLETED v17 + GD_PROCESS_REVERT v13, pinned: lift/build_lift.py) on GD Completed V2's runtime (gdc/lift/runtime.js) and
adapter (gdc/code/prepare/adapter.js); fcBusy from gdc/code/_fc.js; the GD / lines / lock reads from gdc/prepare/sql.py (via
prepare/sql.py here). Published with .dbtools/wf_upload.mjs (a compile-made sql-node never runs).

usage: python3 build_gdrev.py [--write] [NAME ...]
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


_PS = _load("gdrev_prepare_sql", os.path.join(HERE, "prepare", "sql.py"))
PSQL, ROUND1, ROUND2 = _PS.SQL, _PS.ROUND1, _PS.ROUND2
_BGDC = _load("gdrev_build_gdc", GDC + "build_gdc.py")
wrap_doc_sql, keep_published = _BGDC.wrap_doc_sql, _BGDC.keep_published
OUT = R + "Goods Delivery/RevertV2/"
WRITE = "--write" in sys.argv
IDS = json.load(open(OUT + "ids.json")) if os.path.exists(OUT + "ids.json") else {}

JOB = "GD Async Job:Table:2104845286495150081"
STEP = "GD Publish Step:Table:2105131615547461634"
GD = "Goods Delivery:Table:1902054888473481218"
GDL = "goods_delivery_fwii8mvb_sub:Table:1939904186426433537"
RESV = "On Reserved Goods Delivery:Table:1935880014687440897"
SOL = "sales_order_axszx8cj_sub:Table:1939903359943024642"
SOH = "Sales Order:Table:1902773735979597826"
SNAP = "GD Completion Snapshot:Table:2058814896563986434"
ENGINE = ("INVENTORY_BULK_APPLY", "2109916822821744641")
JOB_PROPS = ["id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "row_version", "error_code", "error_message", "error_details", "finished_at"]
STEP_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "finished_at", "inventory_operation_id", "result_ref",
              "error_code", "error_message"]
ORG = {"organization_id": "Organization"}
# the classic update nodes' columns and labels (GD_PROCESS_REVERT v13, GD_REVERT_COMPLETED v17); code/commit/rstep.js RV_COLS
LABELS = {"status": "Status", "reserved_qty": "Reserved Quantity", "open_qty": "Open Quantity", "delivered_qty": "Delivered Quantity", "doc_type": "Document Type",
          "doc_id": "Document ID", "doc_no": "Document Number", "doc_line_id": "Document Line ID", "target_gd_id": "Target Goods Delivery ID", "is_deleted": "Is Deleted",
          "planned_qty": "Planned Quantity", "outstanding_quantity": "Outstanding Quantity", "line_status": "Line Status", "so_status": "SO Status", "gd_status": "GD Status",
          "partially_delivered": "Partially Delivered", "fully_delivered": "Fully Delivered", "snapshot_status": "Snapshot Status", "picking_status": "Picking Status"}
GROUPS = {
    "res": ("on_reserved_gd", "r", RESV, ["status", "reserved_qty", "open_qty", "delivered_qty", "doc_type", "doc_id", "doc_no", "doc_line_id", "target_gd_id"]),
    "frag": ("on_reserved_gd", "r", RESV, ["is_deleted", "status", "open_qty"]),
    "pend": ("on_reserved_gd", "r", RESV, ["reserved_qty", "open_qty"]),
    "gdl": ("goods_delivery_fwii8mvb_sub", "l", GDL, ["picking_status"]),
    "snap": ("gd_completion_snapshot", "s", SNAP, ["snapshot_status"]),
    "gdh": ("goods_delivery", "g", GD, ["gd_status", "picking_status"]),
}


def wf_id(name):
    return IDS.get(name, "0")


# ------------------------------------------------------------------------------------------------- helpers (gdc's)
def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def raw(path):
    with open(path, encoding="utf-8") as f:
        return f.read().rstrip("\n")


def mine(path):
    return raw(os.path.join(HERE, "code", path))


def gdc(path):
    return raw(GDC + path)


def lifted():
    text = raw(os.path.join(HERE, "lift", "lifted_revert.js"))
    assert "{{" not in text, "a lifted body still holds a platform token"
    return text


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


def unlock_update(ids, nid, src, field="unlockRows", title="Goods Delivery back to Completed (nothing was written)"):
    return K.update(ids, nid, title, GD, ("id", "in", N(src, "data.%s.id" % field)),
                    [("id", N(src, "data.%s.id" % field)), ("gd_status", N(src, "data.%s.gd_status" % field))], labels={"gd_status": "GD Status"})


def step_add(ids, nid, title, src, field):
    return K.add(ids, nid, title, STEP, [(p, N(src, "data.%s.%s" % (field, p))) for p in STEP_PROPS], labels=ORG)


def lift_code():
    """the classic revert's nodes on GD Completed V2's runtime + adapter, and the replay of their order (chain.js)"""
    return [gdc("lift/runtime.js"), lifted(), gdc("code/prepare/adapter.js"), mine("prepare/chain.js")]


# ============================================================================================== GD_REVERT_PREPARE
PE = "code_node_RPentry"


def prepare_sql(k):
    return PSQL[k].replace("code_node_GCentry", PE)


def build_prepare():
    ids = K.Ids(1799500000000)
    G, E, I, P, RD = "code_node_RPguard", PE, "code_node_RPids", "code_node_RPplan", "code_node_RPready"
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
                "evidence: JSON.stringify({ v: 1, workflow: \"GD_REVERT_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(G, "data.result_code"), N(G, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"GD_REVERT_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    titles = {
        "hdr": ("The Goods Delivery (every schema field, one JSON object)", ["j"]),
        "lines": ("Its lines, top-level and bundle items, in id order", ["j"]),
        "lock": ("Its latest lock (GDC|<gd>: GD_REVERT_SUBMIT's)", ["step_name", "result_ref"]),
        "snap": ("Its active completion snapshot (search_node_hrFindSnap)", ["j"]),
        "soh": ("Its Sales Orders, the status columns (search_node_hrCurSoHdr)", ["j"]),
        "sol": ("Every line of those Sales Orders (search_node_hrCurSoLines + table_so)", ["j"]),
        "resv": ("on_reserved_gd pointing at it (search_node_inCurReserved)", ["j"]),
        "pick": ("Picking facts (GD_REVERT_COMPLETED's sql_node_hrPickFacts)", ["kind", "ref_id", "line_status", "to_status", "n", "stock_control", "show_delivery",
                                                                            "picking_required", "gd_flow"]),
        "items": ("Its items (GD_PROCESS_REVERT's sql_node_InItems + serial management)", ["id", "material_code", "material_name", "material_desc", "based_uom",
                                                                                         "stock_control", "item_batch_management", "material_costing_method",
                                                                                         "purchase_unit_price", "uom_conversion_json", "serial_number_management"]),
        "cost": ("The delivery cost per item / batch / bin / box (GD_PROCESS_REVERT's sql_node_inDlvCost)", ["item", "b", "bin", "hu", "tp", "bq"]),
        "dout": ("The completion's movements per balance: net out + Unrestricted cost (GD_PROCESS_REVERT's sql_node_inDirectOut)",
                 ["item", "b", "bin", "hu", "net_bq", "u_tp", "u_bq", "parent_no"]),
        "pend": ("The pending rows the snapshot names (search_node_inCurPending)", ["j"]),
        "prec": ("The Picking records it names (search_node_inCurPicking)", ["j"]),
        "phdr": ("The Picking Plan headers it names (search_node_inCurPpHdr)", ["j"]),
        "hu": ("The handling units it names (search_node_inCurHu)", ["j"]),
        "hul": ("Their lines (search_node_inCurHuLn)", ["j"]),
    }
    branches = lambda keys: [("cai_RP" + k, k, [K.sql("sql_node_RP" + k, titles[k][0], prepare_sql(k), titles[k][1])]) for k in keys]
    plan_fields = ["route", "code", "message", "operationKey", "organizationId", "movements", "payload", "partRows", "lineCount", "movementCount", "gdId", "unlockOk"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message", "job_status"]
    nodes = [
        K.code(G, "Guard: job_id (digits), session tenant", mine("prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_RPreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_RPrej", "Answer (rejected input)", rej_body, res_fields),
            K.ret("return_node_RPrej", "Return (rejected input)", [(f, N("code_node_RPrej", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_RPjob", "The job (+ DB clock, lease flag, request)", job,
              ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key",
               "correlation_id", "request_payload", "is_deleted"]),
        K.code(E, "Entry: a VALIDATING REVERT_GD job under a live lease; its request -> the GD", mine("prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "gdId", "idempotencyKey", "rowVersion", "dbNow", "jsAt", "nonce", "request", "result_code", "result_message"],
               objects=("request", "rowVersion")),
        K.if_(ids, "if_RPnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(E, "route", "NOOP"), [
            K.code("code_node_RPnoop", "Answer (not prepared)", noop_body, res_fields),
            K.ret("return_node_RPnoop", "Return (not prepared)", [(f, N("code_node_RPnoop", "data." + f)) for f in res_fields]),
        ]),
        K.parallel("condition_all_RPread1", "Round 1, set-based reads in parallel (no row limits): the GD, its snapshot, sales orders, reservations, Picking facts, items, delivery cost",
                   branches(ROUND1)),
        K.code(I, "Ids: GD_REVERT_COMPLETED's hrExtract / hrParseSnap + GD_PROCESS_REVERT's inExtract / inParseSnap (lifted) -> the rows the snapshot names",
               "\n".join(lift_code() + [mine("prepare/ids.js")]), ["route", "pendingIdsSql", "pickingRecordIdsSql", "ppHeaderIdsSql", "huIdsSql", "huLineIdsSql", "message"]),
        K.parallel("condition_all_RPread2", "Round 2 in parallel: the pending rows, Picking records / headers and handling units the snapshot names", branches(ROUND2)),
        K.code(P, "Plan: the GD before the lock -> GD_REVERT_COMPLETED + GD_PROCESS_REVERT (lifted: conflicts, SO, reservations, picking status) -> movements, payload parts",
               "\n".join(lift_code() + [mine("prepare/plan.js"), mine("prepare/plan_tail.js")]), plan_fields, arrays=("movements", "partRows"),
               objects=("lineCount", "movementCount", "unlockOk")),
        K.if_(ids, "if_RPengine", "IF there is stock to return: INVENTORY_BULK_APPLY in PLAN mode (writes nothing)", is_(P, "route", "ENGINE"), [
            call(ids, "workflow_node_RPengine", "INVENTORY_BULK_APPLY PLAN: every movement priced, the operation checked as a whole", ENGINE, [
                ("operation_key", N(P, "data.operationKey")), ("mode", "PLAN", "value"), ("organization_id", N(P, "data.organizationId")),
                ("movements", N(P, "data.movements"))]),
        ]),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ GD back to Completed when this job holds its lock)", mine("prepare/ready.js"),
               ready_fields, arrays=("readyRows", "jobRows", "unlockRows")),
        gate(ids, "cor_RPparts", "Payload parts to write?", RD, "needParts", [
            K.add(ids, "add_node_RPparts", "Payload parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", STEP,
                  [(p, N(P, "data.partRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]], labels=ORG),
        ]),
        gate(ids, "cor_RPready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_RPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code",
                                                                  "error_message", "error_details", "prepared_payload", "line_count"]]),
        ]),
        gate(ids, "cor_RPfail", "Job FAILED to write?", RD, "needJobUpd", [job_update(ids, "update_node_RPfail", "Job FAILED with the reason (lease released)", RD, "jobRows")]),
        gate(ids, "cor_RPunlock", "GD lock to release?", RD, "needUnlock", [unlock_update(ids, "update_node_RPunlock", RD)]),
        K.sql("sql_node_RPback", "Read-back: the job after the write (the truth)", back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
        K.code("code_node_RPresult", "Result", mine("prepare/result.js"), res_fields),
        K.ret("return_node_RPdone", "Return", [(f, N("code_node_RPresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a REVERT_GD job the worker holds")], res_fields, nodes)


# =============================================================================================== GD_REVERT_COMMIT
CG, CE = "code_node_RCguard", "code_node_RCentry"
RES_FIELDS = ["job_id", "job_status", "path", "result_code", "result_message", "evidence"]
RESULT_JS = "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\n"


def cc(mods, tail=""):
    """a COMMIT code node: the shared helpers, the modules (code/commit/<x>.js, gdc:<path>, lift:revert), a tail binding the refs"""
    def inc(x):
        if x == "lift:revert":
            return lifted()
        if x.startswith("gdc:"):
            return gdc(x[4:])
        return mine("commit/" + x)
    return "\n".join([mine("commit/_common.js"), mine("commit/_cmp.js")] + [inc(x) for x in mods] + ([tail] if tail else []))


def cres(tag, src, path):
    body = RESULT_JS + mine("commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [K.code("code_node_RC%sres" % tag, "Result (%s)" % path, body, RES_FIELDS),
            K.ret("return_node_RC%s" % tag, "Return (%s)" % path, [(f, N("code_node_RC%sres" % tag, "data." + f)) for f in RES_FIELDS])]


def end_block(ids, tag, src, title, unlock=False):
    nodes = [gate(ids, "cor_RC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
        job_update(ids, "update_node_RC%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW / FAILED (lease released)", src, "jobRows")])]
    if unlock:
        nodes.append(gate(ids, "cor_RC%sunlock" % tag, "GD lock to release?", src, "needUnlock", [unlock_update(ids, "update_node_RC%sunlock" % tag, src)]))
    nodes += cres(tag, src, tag.upper() + "_END")
    return K.if_(ids, "if_RC%send" % tag, title, is_(src, "route", "END"), nodes)


def step_done(ids, tag, src, step):
    return gate(ids, "cor_RC%sstep" % tag, "%s DONE to record?" % step, src, "needStep", [
        K.add(ids, "add_node_RC%sstep" % tag, "%s DONE (unique job / step)" % step, STEP, [(p, N(src, "data.stepRows." + p)) for p in STEP_PROPS], labels=ORG)])


def slice_loop(ids, tag, src, field, title, table, props):
    loop_id = "loop_RC%s" % tag
    sl = "code_node_RC%sslice" % tag
    body = mine("commit/slice.js").replace("__LOOP__", loop_id)
    return K.loop(ids, loop_id, title, N(src, "data." + field), [
        K.code(sl, "This slice (the loop item: <= 250 rows)", body, ["n", "rows"], arrays=("rows",), objects=("n",)),
        K.update(ids, "update_node_RC%swrite" % tag, title + " (<= 250 per call)", table, ("id", "in", N(sl, "data.rows.id")), [(p, N(sl, "data.rows." + p)) for p in ["id"] + props],
                 {p: LABELS[p] for p in props}),
    ])


def upd(ids, nid, title, table, src, field, props):
    return K.update(ids, nid, title, table, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in ["id"] + props],
                    {p: LABELS[p] for p in props})


def build_commit():
    ids = K.Ids(1799600000000)
    T = "'%s'" % N(CG, "data.tenantId")
    JOBID = N(CG, "data.jobId")
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
    steps = "SELECT st.step_name, st.step_status FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' AND st.step_name LIKE 'R%%' AND st.is_deleted = 0" % (T, JOBID)
    payload = "SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = %s AND j.id = %s" % (T, JOBID)
    gdlock = """SELECT g.gd_status, g.si_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GDC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN goods_delivery g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = %s AND j.id = %s AND j.correlation_id REGEXP '^GD\\\\|[0-9]{1,20}$'""" % (T, JOBID)
    own = "SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = %s AND j.id = %s" % (T, JOBID)
    part = lambda *names: ("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' AND (%s) AND st.is_deleted = 0 "
                           "ORDER BY st.step_name") % (T, JOBID, " OR ".join("st.step_name LIKE CONCAT('%s', '%s|%%')" % (PFX, nm) for nm in names))
    intent = lambda name: ("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = '%s' AND st.step_name LIKE '%s|I|%%' "
                           "AND st.is_deleted = 0 ORDER BY st.step_name") % (T, JOBID, name)

    # the guarded groups now, by the ids the step's ids node read from its part (no is_deleted filter: a fragment's write deletes it)
    def grp_sql(groups, ids_node):
        out = []
        for g in groups:
            table, a, _src, cols = GROUPS[g]
            obj = ", ".join(["'id', CAST(%s.id AS CHAR)" % a] + ["'%s', %s.`%s`" % (c, a, c) for c in cols if c != "is_deleted"] + ["'is_deleted', %s.is_deleted" % a])
            out.append("SELECT '%s' AS k, JSON_OBJECT(%s) AS j\n  FROM %s %s\n WHERE %s.tenant_id = %s AND %s.id IN %s" % (
                g, obj, table, a, a, T, a, jt(N(ids_node, "data.%sIdsJson" % g))))
        return "\nUNION ALL\n".join(out)

    def ids_node(nid, title, part_node, groups):
        tail = "const res = rvIds([%s][0], [%s][0], %s);\nconsole.log(%s, JSON.stringify(res));\nreturn res;" % (N(CE, "data"), N(part_node, "data"), json.dumps(groups),
                                                                                                             json.dumps("commit " + nid))
        return K.code(nid, title, cc(["_rows.js", "rstep.js"], tail), ["ok"] + [g + "IdsJson" for g in GROUPS])

    # R3 reads the sales orders as PREPARE does (keyed on the GD's lines: unchanged while it is Processing)
    so_sql = lambda k: PSQL[k].replace("code_node_GCentry", CE)
    E_ = "[%s][0]" % N(CE, "data")
    entry_fields = ["route", "phase", "dbNow", "jsAt", "jobId", "tenantId", "organizationId", "gdId", "gdNo", "idempotencyKey", "jobStatus", "rowVersion", "attempts",
                    "leaseUntil", "unlockOk", "siStatus", "partPrefix", "manifest", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "needR0", "needR1", "needR2", "needR3",
                    "needR4", "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows")
    plan_head = ["route", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"]
    rej_body = RESULT_JS + mine("commit/result.js") + "\nreturn commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");" % (N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    sqlj = lambda nid, title, text: K.sql(nid, title, text, ["k", "j"])
    R2G, R4G, ALL = ["res", "frag", "pend"], ["gdl", "snap", "gdh"], list(GROUPS)
    rv = lambda fn_call, log: cc(["_rows.js", "rstep.js"], "const res = %s;\nconsole.log(%s, JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));\nreturn res;" % (fn_call, json.dumps(log)))
    nodes = [
        K.code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", cc(["guard.js"]), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_RCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            K.code("code_node_RCrejres", "Result (REJECTED_INPUT)", rej_body, RES_FIELDS),
            K.ret("return_node_RCrej", "Return (rejected input)", [(f, N("code_node_RCrejres", "data." + f)) for f in RES_FIELDS])]),
        K.parallel("condition_all_RCfacts", "Facts in parallel: the job, its step rows, its manifest, the GD's status, invoice status and lock", [
            ("cai_RCjob", "Job", [K.sql("sql_node_RCjob", "The job (+ DB clock, lease flag, lease_until, due)", job,
                ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                 "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted"])]),
            ("cai_RCsteps", "Steps", [K.sql("sql_node_RCsteps", "This job's R step rows", steps, ["step_name", "step_status"])]),
            ("cai_RCpayload", "Manifest", [K.sql("sql_node_RCpayload", "The prepared manifest", payload, ["prepared_payload"])]),
            ("cai_RCgd", "GD + lock", [K.sql("sql_node_RCgd", "The GD's status, invoice status and its latest lock", gdlock, ["gd_status", "si_status", "lock_ref"])]),
        ]),
        K.code(CE, "Entry: what this run does (phase A: R0 R1, SPLIT; phase B: R2 R3 R4, COMPLETED), the lease claim", cc(["entry.js"]),
               entry_fields, arrays=("jobRows", "unlockRows"), objects=("rowVersion", "attempts", "manifest")),
        K.if_(ids, "if_RCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_RCentryend", "IF the manifest is unusable: job FAILED (+ GD back to Completed) or REQUIRES_REVIEW", "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
            gate(ids, "cor_RCefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_RCefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows")]),
            gate(ids, "cor_RCefunlock", "GD lock to release?", CE, "needUnlock", [unlock_update(ids, "update_node_RCefunlock", CE)]),
        ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_RCclaim", "Lease claim: job COMMITTING_GD, lease_owner = this run, lease_expires_at = now + 30 min", CE, "jobRows"),
        K.sql("sql_node_RCown", "Read-back: the job after the lease claim", own, ["id", "job_status", "lease_owner", "row_version"]),
        K.code("code_node_RCown", "Own: COMMITTING_GD under this run's lease, else LOST", cc(["own.js"]), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_RClost", "IF another run took the job: stop", is_("code_node_RCown", "route", "LOST"), cres("lost", "code_node_RCown", "LOST")),
        # ---------------------------------------------------------------- R0
        K.if_(ids, "if_RCr0", "IF R0 REVALIDATE is due", is_(CE, "needR0", "YES"), [
            K.sql("sql_node_RCr0part", "R0: the RES and GD parts", part("RES", "GD"), ["step_name", "result_ref"]),
            ids_node("code_node_RCr0ids", "R0: the rows the revert writes", "sql_node_RCr0part", ALL),
            sqlj("sql_node_RCr0rows", "R0: those rows now (reservations, the GD's lines, its snapshot, the GD)", grp_sql(ALL, "code_node_RCr0ids")),
            K.code("code_node_RCr0", "R0 REVALIDATE: the GD still locked by this job and not invoiced, every row still as PREPARE read it -> DONE; else FAILED + GD back to Completed",
                   rv("rvRevalidate(%s, [%s][0], [%s][0])" % (E_, N("sql_node_RCr0part", "data"), N("sql_node_RCr0rows", "data")), "commit R0"), chk, arrays=chk_arr),
            end_block(ids, "r0", "code_node_RCr0", "IF the delivery changed meanwhile", unlock=True),
            step_done(ids, "r0", "code_node_RCr0", "R0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- R1
        K.if_(ids, "if_RCr1", "IF R1 INVENTORY is due (phase A ends here: SPLIT)", is_(CE, "needR1", "YES"), [
            K.sql("sql_node_RCr1part", "R1: the ENGINE part", part("ENGINE"), ["step_name", "result_ref"]),
            K.code("code_node_RCr1in", "R1: the operation key and the movements", cc(["r1_in.js"]), ["ok", "operationKey", "movements"], arrays=("movements",)),
            call(ids, "workflow_node_RCr1", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; GDR|<job> replays on a re-run)", ENGINE, [
                ("operation_key", N("code_node_RCr1in", "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")),
                ("movements", N("code_node_RCr1in", "data.movements"))]),
            K.sql("sql_node_RCr1ops", "R1: this operation's engine intent rows (any = it may have written)",
                  "SELECT COUNT(*) AS intents FROM gd_publish_step st WHERE st.tenant_id = %s AND st.job_id = 'GDR|%s' AND st.step_name LIKE 'IBA|I|%%' AND st.is_deleted = 0" % (T, JOBID), ["intents"]),
            K.code("code_node_RCr1", "R1 check: 200 -> DONE + SPLIT; 409 -> wait, then FAILED + GD back to Completed (review once it has intent rows); 400 -> FAILED + GD back to Completed; else review",
                   cc(["r1.js"]), chk + ["splitRows", "needSplit"], arrays=chk_arr + ("splitRows",)),
            end_block(ids, "r1", "code_node_RCr1", "IF the stock was not returned", unlock=True),
            step_done(ids, "r1", "code_node_RCr1", "R1_INVENTORY"),
            gate(ids, "cor_RCsplit", "SPLIT hand-over to write?", "code_node_RCr1", "needSplit", [
                job_update(ids, "update_node_RCsplit", "Job: SPLIT| hand-over lease (the next run does phase B)", "code_node_RCr1", "splitRows")]),
        ] + cres("split", "code_node_RCr1", "SPLIT")),
        # ---------------------------------------------------------------- R2
        K.if_(ids, "if_RCr2", "IF R2 RESERVATIONS is due", is_(CE, "needR2", "YES"), [
            K.sql("sql_node_RCr2part", "R2: the RES part", part("RES"), ["step_name", "result_ref"]),
            ids_node("code_node_RCr2ids", "R2: the reservations, fragments and pending rows", "sql_node_RCr2part", R2G),
            sqlj("sql_node_RCr2rows", "R2: those rows now", grp_sql(R2G, "code_node_RCr2ids")),
            K.code("code_node_RCr2plan", "R2 plan: write a row only while it holds what PREPARE read (Delivered -> Allocated, fragments soft-deleted, pending restored); at after = done; else review",
                   rv("rvPlan(%s, [%s][0], [%s][0], %s, \"R2_RESERVATIONS\")" % (E_, N("sql_node_RCr2part", "data"), N("sql_node_RCr2rows", "data"), json.dumps(R2G)), "commit R2 plan"),
                   plan_head + ["resSlices", "fragSlices", "pendSlices"], arrays=("jobRows", "resSlices", "fragSlices", "pendSlices")),
            end_block(ids, "r2pl", "code_node_RCr2plan", "IF the reservations cannot be written"),
            slice_loop(ids, "r2r", "code_node_RCr2plan", "resSlices", "R2 WRITE: reservations back to Allocated (update_node_inReservedRevert)", RESV, GROUPS["res"][3]),
            slice_loop(ids, "r2f", "code_node_RCr2plan", "fragSlices", "R2 WRITE: fragments soft-deleted (update_node_inFragSoftDel)", RESV, GROUPS["frag"][3]),
            slice_loop(ids, "r2p", "code_node_RCr2plan", "pendSlices", "R2 WRITE: pending rows restored (update_node_inPendingRestore)", RESV, GROUPS["pend"][3]),
            sqlj("sql_node_RCr2back", "R2 read-back", grp_sql(R2G, "code_node_RCr2ids")),
            K.code("code_node_RCr2check", "R2 check: every row at its after-values -> DONE",
                   rv("rvCheck(%s, [%s][0], [%s][0], %s, \"R2_RESERVATIONS\")" % (E_, N("sql_node_RCr2part", "data"), N("sql_node_RCr2back", "data"), json.dumps(R2G)), "commit R2 check"),
                   chk, arrays=chk_arr),
            end_block(ids, "r2", "code_node_RCr2check", "IF R2 did not complete"),
            step_done(ids, "r2", "code_node_RCr2check", "R2_RESERVATIONS"),
        ]),
        # ---------------------------------------------------------------- R3
        K.if_(ids, "if_RCr3", "IF R3 SALES ORDERS is due", is_(CE, "needR3", "YES"), [
            K.parallel("condition_all_RCr3read", "R3 fresh reads in parallel", [
                ("cai_RCr3part", "SO part", [K.sql("sql_node_RCr3part", "R3: the SO part", part("SO"), ["step_name", "result_ref"])]),
                ("cai_RCr3intent", "Intent", [K.sql("sql_node_RCr3intent", "R3: an intent of an earlier run", intent("R3"), ["step_name", "result_ref"])]),
                ("cai_RCr3lines", "SO lines", [K.sql("sql_node_RCr3lines", "R3: every line of its Sales Orders now", so_sql("sol"), ["j"])]),
                ("cai_RCr3hdrs", "SO headers", [K.sql("sql_node_RCr3hdrs", "R3: its Sales Orders now", so_sql("soh"), ["j"])]),
            ]),
            K.code("code_node_RCr3plan", "R3 plan: code_node_hrComputeSoUpdates (lifted) on the fresh rows -> intent; write what is at before",
                   cc(["gdc:lift/runtime.js", "lift:revert", "gdc:code/prepare/adapter.js", "r3.js"],
                      "const res = revertR3Plan(%s, [%s][0], [%s][0], [%s][0], [%s][0]);\nconsole.log(\"commit R3 plan\", JSON.stringify({ route: res.route, intent: res.needIntent, lines: res.lineCount, headers: res.headerRows.length, result: res.result_code, message: res.result_message }));\nreturn res;" % (
                          E_, N("sql_node_RCr3part", "data"), N("sql_node_RCr3intent", "data"), N("sql_node_RCr3lines", "data"), N("sql_node_RCr3hdrs", "data"))),
                   ["route", "needIntent", "intentRows", "lineSlices", "lineCount", "headerRows", "needHeaders", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("intentRows", "lineSlices", "headerRows", "jobRows"), objects=("lineCount",)),
            end_block(ids, "r3pl", "code_node_RCr3plan", "IF the sales orders cannot be written"),
            gate(ids, "cor_RCr3intent", "Intent to record?", "code_node_RCr3plan", "needIntent", [step_add(ids, "add_node_RCr3intent", "R3 INTENT: R3|I|<nnn> (before + after of every row)", "code_node_RCr3plan", "intentRows")]),
            slice_loop(ids, "r3", "code_node_RCr3plan", "lineSlices", "R3 WRITE: SO lines (update_node_hrRestoreSoLines)", SOL, ["planned_qty", "delivered_qty", "outstanding_quantity", "line_status"]),
            gate(ids, "cor_RCr3hdr", "Sales Orders to write?", "code_node_RCr3plan", "needHeaders", [
                upd(ids, "update_node_RCr3hdr", "R3 WRITE: Sales Order status (update_node_hrRestoreSoHeaders)", SOH, "code_node_RCr3plan", "headerRows", ["so_status", "gd_status", "partially_delivered", "fully_delivered"])]),
            K.parallel("condition_all_RCr3back", "R3 read-back in parallel", [
                ("cai_RCr3intentB", "Intent", [K.sql("sql_node_RCr3intentB", "R3 read-back: the intent", intent("R3"), ["step_name", "result_ref"])]),
                ("cai_RCr3linesB", "SO lines", [K.sql("sql_node_RCr3linesB", "R3 read-back: SO lines", so_sql("sol"), ["j"])]),
                ("cai_RCr3hdrsB", "SO headers", [K.sql("sql_node_RCr3hdrsB", "R3 read-back: Sales Orders", so_sql("soh"), ["j"])]),
            ]),
            K.code("code_node_RCr3check", "R3 check: every intent row at its after-values -> DONE",
                   cc(["gdc:code/prepare/adapter.js", "r3.js"], "const res = revertR3Check(%s, [%s][0], [%s][0], [%s][0]);\nconsole.log(\"commit R3 check\", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));\nreturn res;" % (
                       E_, N("sql_node_RCr3intentB", "data"), N("sql_node_RCr3linesB", "data"), N("sql_node_RCr3hdrsB", "data"))), chk, arrays=chk_arr),
            end_block(ids, "r3", "code_node_RCr3check", "IF R3 did not complete"),
            step_done(ids, "r3", "code_node_RCr3check", "R3_SO"),
        ]),
        # ---------------------------------------------------------------- R4
        K.if_(ids, "if_RCr4", "IF R4 THE DELIVERY is due (Created: it stops being Processing here)", is_(CE, "needR4", "YES"), [
            K.sql("sql_node_RCr4part", "R4: the GD part", part("GD"), ["step_name", "result_ref"]),
            ids_node("code_node_RCr4ids", "R4: the GD's lines, its snapshot, the GD", "sql_node_RCr4part", R4G),
            sqlj("sql_node_RCr4rows", "R4: those rows now", grp_sql(R4G, "code_node_RCr4ids")),
            K.code("code_node_RCr4plan", "R4 plan: write a row only while it holds what PREPARE read; at after = done; else review",
                   rv("rvPlan(%s, [%s][0], [%s][0], %s, \"R4_GD\")" % (E_, N("sql_node_RCr4part", "data"), N("sql_node_RCr4rows", "data"), json.dumps(R4G)), "commit R4 plan"),
                   plan_head + ["gdlSlices", "snapRows", "needSnap", "gdhRows", "needGdh"], arrays=("jobRows", "gdlSlices", "snapRows", "gdhRows")),
            end_block(ids, "r4pl", "code_node_RCr4plan", "IF the delivery cannot be written"),
            slice_loop(ids, "r4", "code_node_RCr4plan", "gdlSlices", "R4 WRITE: GD lines' picking status (update_node_hrRestorePickLines)", GDL, ["picking_status"]),
            gate(ids, "cor_RCr4snap", "Snapshot to mark?", "code_node_RCr4plan", "needSnap", [
                upd(ids, "update_node_RCr4snap", "R4 WRITE: the snapshot Reverted (update_node_hrMarkSnapReverted)", SNAP, "code_node_RCr4plan", "snapRows", ["snapshot_status"])]),
            gate(ids, "cor_RCr4gdh", "The GD to write (last: the unlock)?", "code_node_RCr4plan", "needGdh", [
                upd(ids, "update_node_RCr4gdh", "R4 WRITE: the GD Created + its picking status (update_node_hrRestoreGdStatus + hrRestorePickHeader)", GD, "code_node_RCr4plan", "gdhRows",
                    ["gd_status", "picking_status"])]),
            sqlj("sql_node_RCr4back", "R4 read-back", grp_sql(R4G, "code_node_RCr4ids")),
            K.code("code_node_RCr4check", "R4 check: every row at its after-values -> DONE",
                   rv("rvCheck(%s, [%s][0], [%s][0], %s, \"R4_GD\")" % (E_, N("sql_node_RCr4part", "data"), N("sql_node_RCr4back", "data"), json.dumps(R4G)), "commit R4 check"),
                   chk, arrays=chk_arr),
            end_block(ids, "r4", "code_node_RCr4check", "IF R4 did not complete"),
            step_done(ids, "r4", "code_node_RCr4check", "R4_GD"),
        ]),
        # ---------------------------------------------------------------- finish
        K.code("code_node_RCfinish", "FINISH: the job COMPLETED",
               cc(["finish.js"], "const res = revertFinish(%s);\nconsole.log(\"commit finish\", JSON.stringify({ message: res.result_message }));\nreturn res;" % E_),
               ["jobRows", "result_message", "job_status"], arrays=("jobRows",)),
        job_update(ids, "update_node_RCdone", "Job COMPLETED (lease released)", "code_node_RCfinish", "jobRows"),
    ] + cres("done", "code_node_RCfinish", "DONE")
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a REVERT_GD job (READY_TO_COMMIT, or COMMITTING_GD to resume)")], RES_FIELDS, nodes)


# =============================================================================================== GD_REVERT_WORKER
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
    """GD Completed V2's worker (build_gdc.py build_worker, verbatim) with GD Revert's names: polls REVERT_GD only"""
    ids = K.Ids(1799700000000)
    G = "code_node_RWguard2"
    T = N(G, "data.tenantId")
    prep = ("GD_REVERT_PREPARE", wf_id("GD_REVERT_PREPARE"))
    comm = ("GD_REVERT_COMMIT", wf_id("GD_REVERT_COMMIT"))
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
                AND j.command = 'REVERT_GD'
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
  %(LOCK)s""" % {"T": T, "IDS": N("code_node_RWplan", "data.jobIdsSql"), "GDCOL": GD_ID_COL, "LOCK": GD_LOCK_JOIN}
    final = """SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.attempt_count, j.lease_owner, j.error_code, j.error_message, SUBSTRING(j.correlation_id, 4) AS gd_id
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id IN (%s)""" % (T, N("code_node_RWplan", "data.jobIdsSql"))
    JOBREF = N("code_node_RWpick", "data.jobId")

    def jobread(nid, title):
        return K.sql(nid, title, wjob_sql(T, JOBREF), WJOB_COLS)

    def gd_unlock(nid, title, src, field="unlockRows"):
        return K.update(ids, nid, title, GD, ("id", "in", N(src, "data.%s.id" % field)),
                        [("id", N(src, "data.%s.id" % field)), ("gd_status", N(src, "data.%s.gd_status" % field))], labels={"gd_status": "GD Status"})

    def wjob_update(nid, title, src, field="jobRows", props=JOB_PROPS):
        return job_update(ids, nid, title, src, field, props)

    def publish(prefix, mid_node, which, wf_title):
        resp, back, after = "code_node_RW%sResp" % prefix, "sql_node_RW%sBack" % prefix, "code_node_RW%sAfter" % prefix
        return [
            call(ids, "workflow_node_RW%s" % prefix, wf_title, comm, [("job_id", JOBREF)]),
            K.code(resp, "The %s response, normalized (evidence; the job row decides)" % which,
                   wcode("callee.js", {"__WHAT__": which, "__NODE__": "workflow_node_RW%s" % prefix, "\"__EXTRA__\"": "\"path\""}),
                   ["called", "job_id", "job_status", "result_code", "result_message", "path"]),
            jobread(back, "Read-back: the job after the %s (the truth)" % which),
            K.code(after, "After the %s: COMMIT wrote the job itself; the worker writes only when nothing was saved" % which,
                   wcode("after_publish.js", {"__WHICH__": which, "__MID__": mid_node, "__RESP__": resp, "__BACK__": back}),
                   ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "publishRoute", "result_code", "result_message", "job_status"],
                   arrays=("jobRows", "unlockRows")),
            gate(ids, "cor_RW%sJob" % prefix, "Job row to write after the %s?" % which, after, "needJobUpd", [wjob_update("update_node_RW%sJob" % prefix, "Job: FAILED (a hard code) / retry with backoff (lease released)", after)]),
            gate(ids, "cor_RW%sUnlock" % prefix, "GD lock to release after the %s?" % which, after, "needUnlock", [gd_unlock("update_node_RW%sUnlock" % prefix, "Goods Delivery back to Completed (nothing was saved)", after)]),
        ]

    plan_ref = "[%s][0]" % N("code_node_RWplan", "data")
    nodes = [
        K.code(G, "Guard: optional job_id, session tenant, this run's lease owner WRK|<nonce>", wcode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_RWreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_RWrejres", "Result (REJECTED_INPUT)", wcode("result.js", {"__PATH__": "REJECTED_INPUT", "__PLAN__": "null", "__ROWS__": "[]"}), res_fields),
            K.ret("return_node_RWrej", "Return (invalid input)", [(f, N("code_node_RWrejres", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_RWpoll", "Poll: the due REVERT_GD jobs of the tenant (at most 5, oldest first; lease expired or never set; backoff over; no live claim row) + DB clock", poll,
              ["db_now", "id", "organization_id", "gd_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
               "lease_expires_at", "dead_lease", "row_version", "error_code", "error_message", "error_details", "claim_id", "claim_started_at", "claim_owner"]),
        K.code("code_node_RWplan", "Plan: the loop's items (the due jobs with their claim facts), the run start", wcode("plan.js"),
               ["route", "dbNow", "runStart", "items", "count", "jobIdsSql", "result_code", "result_message"], arrays=("items",)),
        K.set_cache("set_cache_RWidx0", "Loop index = 0 (per run: the key carries this run's nonce)", "gdr_wrk_" + N(G, "data.nonce"), "0"),
        K.loop(ids, "loop_RWjobs", "Loop over the planned jobs (in order; a lost claim gate ends the tick, the rest wait for the next)", N("code_node_RWplan", "data.items"), [
            K.get_cache("get_cache_RWidx", "Loop index", "gdr_wrk_" + N(G, "data.nonce")),
            K.sql("sql_node_RWtick", "Tick: the FRESH read of the planned jobs (state, lease, backoff, claim row) + the lease end of a claim made now", tick,
                  ["db_now", "lease_until", "id", "organization_id", "gd_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
                   "lease_owner", "lease_expires_at", "lease_live", "dead_lease", "due_now", "row_version", "error_code", "error_message", "error_details", "claim_id",
                   "claim_started_at", "claim_owner", "claim_live"]),
            K.code("code_node_RWpick", "Pick: the item by index; SKIP after the budget / not due / live lease / live claim; the claim gate rows", wcode("pick.js"),
                   ["route", "index", "nextIndex", "dbNow", "leaseUntil", "elapsed", "jobId", "organizationId", "gdId", "item", "rvBase", "rvRows", "needRvUpd", "claimName",
                    "claimRows", "needClaimAdd", "result_message"], arrays=("rvRows", "claimRows"), objects=("item",)),
            gate(ids, "cor_RWrv", "Dead claim to move past (row_version = v + 1)?", "code_node_RWpick", "needRvUpd", [
                wjob_update("update_node_RWrv", "Job: row_version = v + 1 and the retry count (absolute)", "code_node_RWpick", "rvRows", ["id", "row_version", "attempt_count"])]),
            gate(ids, "cor_RWclaimAdd", "Claim row to insert?", "code_node_RWpick", "needClaimAdd", [
                step_add(ids, "add_node_RWclaim", "CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> (unique tenant / job / step: a twin's insert fails and its run ends)", "code_node_RWpick", "claimRows")]),
            K.code("code_node_RWclaim", "Claim: the lease / state write; a dead lease or claim = one retry; exhausted after max_retries", wcode("claim.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "gdId", "rowVersion", "attempts", "claimRows", "needClaim", "failRows", "unlockRows", "exhausted",
                    "result_code", "result_message", "job_status"], arrays=("claimRows", "failRows", "unlockRows")),
            gate(ids, "cor_RWlease", "Lease / state to write?", "code_node_RWclaim", "needClaim", [
                wjob_update("update_node_RWlease", "Lease write: WRK|<nonce> for 10 min, VALIDATING for a QUEUED job, the retry count", "code_node_RWclaim", "claimRows")]),
            jobread("sql_node_RWown", "Read-back: the job after the lease write"),
            K.code("code_node_RWown", "Own: state and lease as written -> PREPARE / PUBLISH / RESUME / EXHAUST; else LOST", wcode("own.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "gdId", "attempts", "failRows", "unlockRows", "needFail", "needUnlock", "rowVersion",
                    "result_code", "result_message", "job_status"], arrays=("failRows", "unlockRows")),
            gate(ids, "cor_RWfail", "Exhausted: job row to write?", "code_node_RWown", "needFail", [
                wjob_update("update_node_RWfail", "Job FAILED (pre-commit) / REQUIRES_REVIEW (COMMITTING_GD)", "code_node_RWown", "failRows")]),
            gate(ids, "cor_RWfailUnlock", "Exhausted pre-commit: GD lock to release?", "code_node_RWown", "needUnlock", [
                gd_unlock("update_node_RWfailUnlock", "Goods Delivery back to Completed (nothing was saved)", "code_node_RWown")]),
            K.if_(ids, "if_RWprep", "IF the job is pre-commit under this run's lease: the ONE GD_REVERT_PREPARE call", is_("code_node_RWown", "route", "PREPARE"), [
                call(ids, "workflow_node_RWprep", "GD_REVERT_PREPARE (set-based reads; writes the job + releases the lock on FAILED)", prep, [("job_id", JOBREF)]),
                K.code("code_node_RWprepResp", "The prepare response, normalized (evidence; the job row decides)",
                       wcode("callee.js", {"__WHAT__": "prepare", "__NODE__": "workflow_node_RWprep", "\"__EXTRA__\"": "\"evidence\""}),
                       ["called", "job_id", "job_status", "result_code", "result_message", "evidence"]),
                jobread("sql_node_RWprepBack", "Read-back: the job after prepare (the truth)"),
                K.code("code_node_RWafterPrep", "After prepare: READY_TO_COMMIT -> publish; FAILED -> lease released; else a hard code fails it / a counted retry", wcode("after_prepare.js"),
                       ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "prepareResult", "prepareMessage", "result_code", "result_message", "job_status"],
                       arrays=("jobRows", "unlockRows")),
                gate(ids, "cor_RWprepJob", "Job row to write after prepare?", "code_node_RWafterPrep", "needJobUpd", [
                    wjob_update("update_node_RWprepJob", "Job: lease released / FAILED / retry with backoff", "code_node_RWafterPrep")]),
                gate(ids, "cor_RWprepUnlock", "GD lock to release after prepare?", "code_node_RWafterPrep", "needUnlock", [
                    gd_unlock("update_node_RWprepUnlock", "Goods Delivery back to Completed (nothing was saved)", "code_node_RWafterPrep")]),
            ]),
            jobread("sql_node_RWmid", "The job before the publish decision"),
            K.code("code_node_RWmid", "Before publish: READY_TO_COMMIT under this run's lease, or COMMITTING_GD with no live lease -> PUBLISH", wcode("mid.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_RWpub", "IF the job is to be published / resumed: the ONE GD_REVERT_COMMIT call", is_("code_node_RWmid", "route", "PUBLISH"),
                  publish("pub", "code_node_RWmid", "publish", "GD_REVERT_COMMIT (phase A: revalidate, stock; or phase B on a resume)")),
            jobread("sql_node_RWsplit", "The job after the publish call (the split decision)"),
            K.code("code_node_RWsplit", "Second publish: COMMITTING_GD under a SPLIT| hand-over lease -> PUBLISH again", wcode("split.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_RWpub2", "IF GD_REVERT_COMMIT ended SPLIT: the second call (reservations, sales orders, the delivery)", is_("code_node_RWsplit", "route", "PUBLISH"),
                  publish("pub2", "code_node_RWsplit", "second publish", "GD_REVERT_COMMIT again after its SPLIT (phase B)")),
            K.set_cache("set_cache_RWidxN", "Next loop index", "gdr_wrk_" + N(G, "data.nonce"), N("code_node_RWpick", "data.nextIndex")),
        ]),
        K.sql("sql_node_RWfinal", "Read-back: the planned jobs (final)", final, ["id", "job_status", "attempt_count", "lease_owner", "error_code", "error_message", "gd_id"]),
        K.code("code_node_RWresult", "Result (DONE)", wcode("result.js", {"__PATH__": "DONE", "__PLAN__": plan_ref, "__ROWS__": "[%s][0]" % N("sql_node_RWfinal", "data")}), res_fields),
        K.ret("return_node_RWdone", "Return the tick's result", [(f, N("code_node_RWresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "optional: gd_async_job.id (digits) to drive this job only (the list's kick after a submit); empty: the oldest due jobs of the session tenant (at most 5 per tick)")],
                      res_fields, nodes)


# =============================================================================================== GD_REVERT_SUBMIT
SUB_RES = ["route", "code", "message", "reason", "job_id", "job_status", "gd_id", "gd_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "evidence"]


def scode(name, tail=""):
    return "\n".join([mine("submit/_common.js"), mine("submit/" + name)] + ([tail] if tail else []))


def build_submit():
    ids = K.Ids(1799800000000)
    G, E, PO = "code_node_RSguard", "code_node_RSentry", "code_node_RSpost"
    T, GDID = N(G, "data.tenantId"), N(G, "data.gdId")
    myt = "CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')"
    # an open job on the GD (GD Cancel V2's SUBMIT condition + a revert): an edit not finished; a completion / Packing / cancel /
    # revert open (REQUIRES_REVIEW counts); a GD V2 create whose Picking outbox is not done
    open_jobs = """(SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(o.id AS CHAR), 'command', o.command, 'job_status', o.job_status, 'progress_percent', o.progress_percent,
                                             'progress_message', o.progress_message, 'error_code', o.error_code, 'error_message', o.error_message)) AS CHAR)
          FROM gd_async_job o
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0
           AND ((o.correlation_id = 'GD|@G'
                 AND ((o.command = 'EDIT_GD' AND o.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED'))
                      OR (o.command IN ('COMPLETE_GD', 'CANCEL_GD', 'REVERT_GD') AND o.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'REQUIRES_REVIEW'))
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
    gd_lines = "goods_delivery_fwii8mvb_sub l WHERE l.tenant_id = '@T' AND l.goods_delivery_id = @G AND l.is_deleted = 0"
    facts = ("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(g.id AS CHAR) AS gd_id,
       g.delivery_no,
       g.gd_status,
       g.si_status,
       COALESCE(g.is_select_picking, 0) AS is_select_picking,
       g.organization_id,
       CAST(g.plant_id AS CHAR) AS plant_id,
       (SELECT COUNT(*) FROM @LINES) AS line_count,
       (SELECT COUNT(*) FROM gd_completion_snapshot s WHERE s.tenant_id = '@T' AND s.gd_id = '@G' AND s.snapshot_status = 'Active' AND s.is_deleted = 0) AS snapshots,
       (SELECT COUNT(*) FROM item i
         WHERE i.is_deleted = 0 AND i.serial_number_management = 1
           AND i.id IN (SELECT CAST(l.material_id AS UNSIGNED) FROM @LINES AND l.material_id REGEXP '^[0-9]{1,20}$')) AS serial_items,
       (SELECT COUNT(*) FROM @LINES AND l.temp_qty_data REGEXP '"handling_unit_id" *: *"?[1-9]') AS hu_lines,
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
         WHERE x.tenant_id = '@T' AND x.is_deleted = 0 AND x.command = 'REVERT_GD' AND x.correlation_id = 'GD|@G'
         ORDER BY x.id DESC LIMIT 1) AS last_job
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN goods_delivery g
    ON g.tenant_id = '@T'
   AND g.id = @G
   AND g.is_deleted = 0""".replace("@OPEN", open_jobs).replace("@PJOBS", picking_jobs).replace("@LINES", gd_lines).replace("@MYT", myt)
             .replace("@T", T).replace("@G", GDID))
    # after the queue rows: this job, the GD, its lock, and any other open job of it (one that slipped in before the Processing write)
    back = ("""SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       g.gd_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'GDC|@G' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       (SELECT COUNT(*) FROM gd_async_job o
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0 AND o.id <> COALESCE(j.id, 0) AND o.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND ((o.correlation_id = 'GD|@G' AND o.command IN ('EDIT_GD', 'COMPLETE_GD', 'CANCEL_GD', 'REVERT_GD', 'COMPLETE_PACKING'))
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
        call_ = "revertResult([%s][0], %s, [%s][0], %s, %s)" % (N(G, "data"), "null" if src == G else "[%s][0]" % N(E, "data"), N(src, "data"),
                                                              "[%s][0]" % N(back_node, "data") if back_node else "null", "[%s][0]" % N(due_node, "data") if due_node else "null")
        body = scode("result.js", "const res = %s;\nconsole.log(\"revert result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, job: res.job_id }));\nreturn res;" % call_)
        return [K.code("code_node_RS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_RS%s" % tag, "Return (%s)" % title, [(f, N("code_node_RS%sres" % tag, "data." + f)) for f in SUB_RES])]

    entry_fields = ["route", "code", "message", "reason", "tenantId", "gdId", "gdNo", "organizationId", "plantId", "lineCount", "dbNow", "lockN", "jobId", "jobStatus",
                    "progressPercent", "progressMessage", "errorCode", "errorMessage"]
    nodes = [
        K.code(G, "Guard: operation, gd_id (digits), source, session tenant + user", scode("guard.js"), ["route", "code", "message", "operation", "gdId", "tenantId", "source", "uid"]),
        K.if_(ids, "if_RSreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), sres("rej", G, "rejected input")),
        K.sql("sql_node_RSfacts", "Facts: the GD (status, invoice, Picking Plan), line count, active snapshot, serial items, handling-unit lines, its latest lock, open jobs on it, Picking V2 confirms, Pickings held on a device, Packings open on a phone, the latest REVERT_GD job, DB clock",
              facts, ["db_now", "gd_id", "delivery_no", "gd_status", "si_status", "is_select_picking", "organization_id", "plant_id", "line_count", "snapshots", "serial_items",
                      "hu_lines", "last_lock", "open_jobs", "picking_jobs", "picking_locks", "packing_leases", "last_job"]),
        K.code(E, "Entry: STATUS; SUBMIT goes on for a Completed GD nothing else holds (BUSY / STOP / NOT_ELIGIBLE otherwise)",
               scode("entry.js").replace("const revertEntry", gdc("code/_fc.js") + "\nconst revertEntry"), entry_fields, objects=("lineCount", "lockN", "progressPercent")),
        K.if_(ids, "if_RSanswer", "IF answered here (STATUS / BUSY / STOP / NOT_ELIGIBLE): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"), sres("ans", E, "entry")),
        K.code(PO, "Post: the lock, job and Processing rows", scode("post.js", "const res = revertPost([%s][0], [%s][0]);\nconsole.log(\"revert post\", JSON.stringify({ route: res.route, key: res.idemKey }));\nreturn res;" % (N(G, "data"), N(E, "data"))),
               ["route", "code", "message", "idemKey", "lockRows", "jobRows", "gdRows"], arrays=("lockRows", "jobRows", "gdRows")),
        K.add(ids, "add_node_RSlock", "LOCK: gd_publish_step GDC|<gd> / LOCK|<n> (unique tenant / job / step: a concurrent submit fails its run)", STEP,
              [(p, N(PO, "data.lockRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "result_ref"]], labels=ORG),
        K.add(ids, "add_node_RSjob", "Job insert: REVERT_GD QUEUED (idempotency_key GDC|<gd>|<n>, correlation_id GD|<gd>)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in ["organization_id", "plant_id", "command", "idempotency_key", "job_status", "progress_percent", "progress_message",
                                                      "attempt_count", "row_version", "cancel_requested", "next_attempt_at", "request_payload", "causation_id", "correlation_id", "line_count", "queued_at"]],
              labels=ORG),
        upd(ids, "update_node_RSgd", "Goods Delivery Processing (the lock every writer honours)", GD, PO, "gdRows", ["gd_status"]),
        K.sql("sql_node_RSback", "Read-back: the job, the GD's status, its latest lock, any other open job of it (a racer)", back, ["job_id", "job_status", "gd_status", "lock_ref", "racers"]),
        K.code("code_node_RSdue", "Due: Processing under this job's lock and no racer -> the job due now; a racer -> GD back to Completed, this job CANCELLED",
               scode("post.js", "const res = revertDue([%s][0], [%s][0], [%s][0]);\nconsole.log(\"revert due\", JSON.stringify({ route: res.route }));\nreturn res;" % (N(E, "data"), N(PO, "data"), N("sql_node_RSback", "data"))),
               ["route", "dueRows", "needDue", "undoJobRows", "needUndo", "unlockRows"], arrays=("dueRows", "undoJobRows", "unlockRows")),
        gate(ids, "cor_RSundo", "A racer: undo?", "code_node_RSdue", "needUndo", [
            job_update(ids, "update_node_RSundoJob", "Job CANCELLED (a Packing / Picking job of the GD started first)", "code_node_RSdue", "undoJobRows",
                       ["id", "job_status", "progress_message", "error_code", "error_message", "finished_at"]),
            unlock_update(ids, "update_node_RSundoGd", "code_node_RSdue", title="Goods Delivery back to Completed (the revert did not start)"),
        ]),
        gate(ids, "cor_RSdue", "Job to make due?", "code_node_RSdue", "needDue", [
            K.update(ids, "update_node_RSdue", "Job due now (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_RSdue", "data.dueRows.id")),
                     [("id", N("code_node_RSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_RSdue", "data.dueRows.next_attempt_at"))])]),
    ] + sres("done", PO, "queued", "sql_node_RSback", "code_node_RSdue")
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"), ("gd_id", "string", "goods_delivery.id (digits)"),
                       ("source", "string", "LIST (default) | MOBILE")], SUB_RES, nodes)


BUILDERS = [("GD_REVERT_PREPARE", build_prepare), ("GD_REVERT_COMMIT", build_commit), ("GD_REVERT_WORKER", build_worker), ("GD_REVERT_SUBMIT", build_submit)]

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
