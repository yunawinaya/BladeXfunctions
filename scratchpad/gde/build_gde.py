"""Builds GD Edit V2's workflows - GD_EDIT_PREPARE, GD_EDIT_COMMIT, GD_EDIT_WORKER, GD_EDIT_SUBMIT - as FlowGram JSON with
GD Completed V2's wfkit (scratchpad/gdc/pkv2tools/wfkit.py, imported by path, unchanged) into Goods Delivery/EditV2/.
The step code is code/{prepare,commit,submit,worker}/*.js. Prepare / commit / submit modules are functions only: each code
node = its modules + a tail that binds the node references. The worker modules carry their own tails (gdc's worker).
gdc's small builder helpers are copied here, so an edit of build_gdc.py never changes Edit V2's output.
Published with .dbtools/wf_upload.mjs (republish: true): a compile-made sql-node never runs.

usage: python3 build_gde.py [--write] [NAME ...]
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


PSQL_MOD = _load("gde_prepare_sql", os.path.join(HERE, "prepare", "sql.py"))
PSQL, jobj = PSQL_MOD.SQL, PSQL_MOD.jobj
SRC = _load("gde_lift_src", os.path.join(HERE, "lift", "src.py"))
OUT = R + "Goods Delivery/EditV2/"
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
PICKT = "Transfer Order Picking:Table:1935556443668959233"
ENGINE = ("INVENTORY_BULK_APPLY", "2109916822821744641")
REORDER = ("REORDER_SET_REDIS", "2065256261729759233")
CREDIT_LIMIT = ("CREDIT_LIMIT_CHECK", "1990247316342333442")
JOB_PROPS = ["id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "row_version", "error_code", "error_message", "error_details", "finished_at"]
STEP_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "finished_at", "inventory_operation_id", "result_ref",
              "error_code", "error_message"]
ORG = {"organization_id": "Organization"}
# the columns each write maps (an update-node writes NULL for a mapped column a record leaves out: the code sends them all)
LINE_SKIP = ["id", "create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id", "goods_delivery_id",
             "parent_id", "children"]
LINE_COLS = [c for c in KINDS["line"] if c not in LINE_SKIP]                                   # e2.js geLineCols
HEAD_COLS = [c for c in KINDS["header"] if c not in ["id", "create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted",
                                                      "sub_tenant_id", "table_gd", "table_insufficient", "table_item_balance"]]  # e6.js geHeaderCols
RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"]  # GE_E3_COLS
RES_CREATE_COLS = ["doc_type", "status", "parent_id", "parent_line_id", "parent_no", "doc_no", "doc_id", "doc_line_id", "material_id", "item_code", "item_name",
                   "item_desc", "batch_id", "bin_location", "item_uom", "reserved_qty", "delivered_qty", "open_qty", "reserved_date", "line_no", "plant_id",
                   "organization_id", "remark", "target_gd_id", "source_reserved_id", "handling_unit_id", "job_line_key"]
SO_LINE_COLS = ["delivered_qty", "planned_qty", "outstanding_quantity", "line_status"]
SO_HDR_COLS = ["so_status", "gd_status", "partially_delivered", "fully_delivered"]
SO_NODES = ["code_node_QtyCheckBatch", "code_node_aq0VGgxs", "code_node_GD92d7xU", "code_node_UMQapdjk", "code_node_lwB2FVe0"]


def col_exprs(alias, table):
    """jobj's rendering of each column of a table, one SQL expression per column (gdc's prepare/sql.py rules)"""
    g = PSQL_MOD._gdc
    out = {}
    for c, (k, _phys) in g.COLS[table].items():
        if c in g.PLACEHOLDERS.get(table, ()):
            continue
        col = "%s.`%s`" % (alias, c)
        out[c] = ("CAST(%s AS UNSIGNED)" % col if k == "num" else "DATE_FORMAT(%s, '%%Y-%%m-%%d %%H:%%i:%%s')" % col if k == "dt" else
                  "SUBSTRING(DATE_FORMAT(%s, '%%Y-%%m-%%d %%H:%%i:%%s.%%f'), 1, 23)" % col if k == "dt3" else "DATE_FORMAT(%s, '%%Y-%%m-%%d')" % col if k == "date" else col)
    return out


def dt3(col):
    """jobj's dt3 text: the Picking version everywhere (SUBMIT's read-back, PREPARE, COMMIT, the worker)"""
    return "SUBSTRING(DATE_FORMAT(%s, '%%Y-%%m-%%d %%H:%%i:%%s.%%f'), 1, 23)" % col


# ------------------------------------------------------------------------------------------------- helpers (gdc's)
def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


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


def rows_update(ids, nid, title, table, src, field, props, labels=None):
    return K.update(ids, nid, title, table, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in ["id"] + props], labels)


def job_update(ids, nid, title, src, field="jobRows", props=JOB_PROPS):
    return K.update(ids, nid, title, JOB, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in props])


def step_add(ids, nid, title, src, field):
    return K.add(ids, nid, title, STEP, [(p, N(src, "data.%s.%s" % (field, p))) for p in STEP_PROPS], ORG)


def q(text, **tokens):
    """SQL with @TOKEN placeholders (node references, SQL fragments); longest token first; single % stays literal"""
    for _ in range(3):  # a fragment token's value may hold tokens itself
        for k in sorted(tokens, key=len, reverse=True):
            text = text.replace("@" + k, tokens[k])
    assert not re.search(r"@[A-Z]", text), text[:300]
    return text


def ids_in(ref):
    return "SELECT jt.i FROM JSON_TABLE('%s', '$[*]' COLUMNS (i BIGINT PATH '$')) jt" % ref


# ------------------------------------------------------------------------------------------------- code assembly
def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read().rstrip("\n")


def lifted(only=None):
    """lift/lifted_edit.js, or only the named nodes of it; the local source paths in its comments become name.vN"""
    chunks = re.split(r"(?m)^(?=// /)", read(HERE + "/lift/lifted_edit.js") + "\n")
    out, seen = [chunks[0]], []
    for c in chunks[1:]:
        nid = re.search(r'^__N\["([^"]+)"\]', c, re.M).group(1)
        if only is None or nid in only:
            seen.append(nid)
            out.append(re.sub(r"\A// /\S*/([A-Za-z0-9_]+\.v\d+)\.json :: ", r"// \1 :: ", c))
    assert only is None or sorted(seen) == sorted(only), (seen, only)
    body = "".join(out).rstrip("\n")
    assert "{{" not in body and "/private/" not in body and "/Users/" not in body
    return body


def js(spec):
    if spec == "@s":
        return "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();"
    if spec == "@linesql":
        return "const GE_LINE_SQL = " + json.dumps(col_exprs("gl", "goods_delivery_fwii8mvb_sub"), separators=(",", ":")) + ";"
    if spec == "@kinds":
        return "const GE_KINDS = " + json.dumps(KINDS, separators=(",", ":")) + ";"
    if spec == "@lift":
        return lifted()
    if spec == "@lift_so":
        return lifted(SO_NODES)
    if spec.startswith("gdc/"):
        return read(GDC + spec[4:])
    return read(os.path.join(HERE, spec))


def cnode(nid, title, mods, tail, fields, arrays=(), objects=()):
    parts = [js(m) for m in mods]
    for m, p in zip(mods, parts):
        assert "{{" not in p, m + " holds a platform token"
    return K.code(nid, title, "\n".join(parts + [tail]), fields, arrays, objects)


def plus_field(node, key, name, bson="string"):
    """one more declared output under a fixed key (a drawn key would re-key every field built after it)"""
    node["data"]["response_json"].append({"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []})
    K._taken.add(key)
    return node


def d(nid, path="data"):
    """a node's value as a JS expression"""
    return "[%s][0]" % N(nid, path)


def pick(nid, names):
    """named fields of a node as a JS object literal (never the whole output: big outputs stay where they are)"""
    return "{ " + ", ".join("%s: %s" % (n, d(nid, "data." + n)) for n in names) + " }"


def tail(expr, label, log="{ route: res.route, result: res.result_code, message: res.result_message }", pre="", post=""):
    return ((pre.rstrip("\n") + "\n") if pre else "") + "const res = %s;\n%sconsole.log(%s, JSON.stringify(%s));\nreturn res;" % (
        expr, (post.rstrip("\n") + "\n") if post else "", json.dumps(label), log)


def ret_block(prefix, tag, title, fields, mods, body):
    nid = "code_node_%s%sres" % (prefix, tag)
    return [cnode(nid, "Result (%s)" % title, mods, body, fields), K.ret("return_node_%s%s" % (prefix, tag), "Return (%s)" % title, [(f, N(nid, "data." + f)) for f in fields])]


# =============================================================================================== GD_EDIT_PREPARE
PE = "code_node_GEentry"   # prepare/sql.py's token node
P_READS = [
    ("hdr", "The Goods Delivery (every schema field)", ["j"]), ("lines", "Its lines, top-level and bundle items", ["j"]),
    ("setup", "Picking Setup + Packing Setup of the organization", ["k", "j"]), ("link", "Internal-trading links of its Sales Orders (stored + edited)", ["j"]),
    ("items", "Items of its lines and of the edit", ["j"]), ("sohl", "Sales Order lines (stored + edited), the columns the SO nodes read", ["j"]),
    ("soh", "Its Sales Orders (status columns)", ["j"]), ("alloc", "on_reserved_gd Allocated to it (no row limit)", ["j"]),
    ("pend", "on_reserved_gd Pending for its materials and SO lines, stored + edited (no row limit)", ["j"]),
    ("pick", "The Pickings naming it (headers)", ["j"]), ("picki", "Their item rows", ["j"]), ("pickr", "Their records", ["j"]),
    ("bins", "The bins their records name (the reversal message)", ["j"]), ("pfmt", "The organization's Picking serial rule", ["j"]),
    ("lock", "Its latest lock (shared with GD Completed V2)", ["step_name", "result_ref"]),
    ("aitem", "Auto allocation: Get Item (GLOBAL_ALLOCATION's) of every material a row may need allocated for", ["j"]),
    ("abal", "Auto allocation: their item / batch balances at the plant (no row limit)", ["k", "j"]),
    ("ares", "Auto allocation: their reservations GLOBAL_ALLOCATION reads (SO Pending, HU-allocated, this GD's own)", ["k", "j"]),
    ("aref", "Auto allocation: UOMs, the plant's bins, HUs + items, batch numbers (only when a row may need allocation)", ["k", "j"]),
]
PLAN_MODS = ["gdc/lift/runtime.js", "@lift", "gdc/code/prepare/chain.js", "gdc/code/prepare/adapter.js", "code/prepare/alloc_edit.js", "code/prepare/chain_edit.js", "code/submit/delta.js",
             "code/prepare/apply_delta.js", "code/prepare/plan_edit.js", "code/commit/so_edit.js", "code/prepare/adapter_edit.js", "@kinds"]


def sql_reads(prefix, entry_node, keys):
    return [("cai_%s%s" % (prefix, k), k, [K.sql("sql_node_%s%s" % (prefix, k), title, PSQL[k].replace(PE, entry_node), cols)])
            for k, title, cols in P_READS if k in keys]


def reads_obj(prefix, keys):
    return "{ " + ", ".join("%s: %s" % (k, d("sql_node_%s%s" % (prefix, k))) for k in keys) + " }"


def build_prepare():
    ids = K.Ids(1798100000000)
    G, E, P, RD = "code_node_GEguard", PE, "code_node_GEplan", "code_node_GEready"
    TEN, JOBID = N(G, "data.tenantId"), N(G, "data.jobId")
    job = q("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
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
    ON j.tenant_id = '@TEN'
   AND j.id = @JOBID""", TEN=TEN, JOBID=JOBID)
    back = q("""SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.progress_message, j.error_code, j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = '@TEN'
   AND j.id = @JOBID""", TEN=TEN, JOBID=JOBID)
    res_fields = ["job_id", "job_status", "result_code", "result_message", "evidence"]
    keys = [k for k, _, _ in P_READS]
    entry_small = "{ route: %s, jobId: %s, rowVersion: %s, dbNow: %s, jsAt: %s, result_code: %s, result_message: %s, request: { stored_status: %s, hold: %s } }" % tuple(
        d(E, "data." + f) for f in ["route", "jobId", "rowVersion", "dbNow", "jsAt", "result_code", "result_message", "request.stored_status", "request.hold"])
    plan_tail = tail("entry.route !== \"GO\" ? { route: \"FAIL\", code: entry.result_code, message: entry.result_message, operationKey: \"\", organizationId: entry.organizationId, "
                     "movements: [], payload: \"\", partRows: [], lineCount: 0, movementCount: 0, gdId: entry.gdId, unlockOk: 0, pickUnlockId: \"\", notes: {} } : gePlan(entry, geAdapt(S), GE_KINDS)",
                     "prepare plan", "{ route: res.route, code: res.code, message: res.message, lines: res.lineCount, movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk, pickUnlock: res.pickUnlockId }",
                     pre="const entry = %s;\nconst S = Object.assign({ organizationId: entry.organizationId }, %s);" % (d(E), reads_obj("GE", keys)),
                     post="delete res.parts;\nres.needEngine = res.route === \"ENGINE\" && Number(res.movementCount) > 0 ? \"YES\" : \"NO\";")
    plan_fields = ["route", "code", "message", "operationKey", "organizationId", "movements", "payload", "partRows", "lineCount", "movementCount", "gdId", "unlockOk",
                   "pickUnlockId", "notes", "needEngine"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needHold", "holdRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "needPickUnlock",
                    "pickUnlockRows", "result_code", "result_message", "job_status"]
    ready_pre = "const e = %s;\nconst p = %s;\nconst g = %s;" % (entry_small, pick(P, ["route", "code", "message", "payload", "lineCount", "movementCount", "gdId", "unlockOk", "pickUnlockId"]),
                                                              pick("workflow_node_GEengine", ["code", "result_code", "message"]))
    rmods = ["code/prepare/result.js"]

    def answer(tag, title, ready_ref, back_ref):
        return ret_block("GE", tag, title, res_fields, rmods, tail("prepareResult(%s, %s, %s, %s)" % (d(G), pick(E, ["route", "result_code", "result_message"]), ready_ref, back_ref), "prepare result", "res"))

    nodes = [
        cnode(G, "Guard: job_id (digits), session tenant", ["code/prepare/guard.js"],
              tail("prepareGuard({ jobId: [{{workflowparams:job_id}}][0], systemTenantId: [{{system:tenantId}}][0] })", "prepare guard", "res"),
              ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_GEreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"),
              ret_block("GE", "rej", "rejected input", res_fields, rmods,
                        tail("prepareResult(%s, { route: \"REJECT\", result_code: %s, result_message: %s }, null, [])" % (d(G), d(G, "data.result_code"), d(G, "data.result_message")),
                             "prepare result", "res"))),
        K.sql("sql_node_GEjob", "The job (+ DB clock, lease flag, request)", job,
              ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key", "correlation_id",
               "request_payload", "is_deleted"]),
        plus_field(cnode(E, "Entry: a VALIDATING EDIT_GD job under a live lease; its request -> the GD and the edit's id lists", ["code/prepare/alloc_ids.js", "code/prepare/entry.js"],
              tail("prepareEntry(%s, %s, [{{system:uuid}}][0])" % (d(G), d("sql_node_GEjob")), "prepare entry",
                   "{ route: res.route, job: res.jobId, gd: res.gdId, result: res.result_code, message: res.result_message }"),
              ["route", "jobId", "tenantId", "organizationId", "gdId", "idempotencyKey", "rowVersion", "dbNow", "nonce", "request", "deltaMaterialIdsSql", "deltaSoLineIdsSql",
               "deltaSoLineIdsQuoted", "deltaSoIdsSql", "deltaAllocMaterialIdsSql", "deltaAllocLineIdsSql", "result_code", "result_message"], objects=("request", "rowVersion")), "jsatgeen", "jsAt"),
        K.if_(ids, "if_GEnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(E, "route", "NOOP"), answer("noop", "not prepared", "null", "[]")),
        K.parallel("condition_all_GEread", "Set-based reads in parallel (no row limits): the GD as stored AND the edit", sql_reads("GE", E, keys)),
        cnode(P, "Plan: stored + delta -> GOODS_DELIVERY's Edit/Created path + GD_UNUSED_FN_NEW's planner (lifted) -> movements, payload parts", PLAN_MODS, plan_tail,
              plan_fields, arrays=("movements", "partRows"), objects=("lineCount", "movementCount", "unlockOk", "notes")),
        gate(ids, "cor_GEengine", "Stock to move? INVENTORY_BULK_APPLY in PLAN mode (writes nothing)", P, "needEngine", [
            call(ids, "workflow_node_GEengine", "INVENTORY_BULK_APPLY PLAN: every movement priced, the operation checked as a whole", ENGINE, [
                ("operation_key", N(P, "data.operationKey")), ("mode", "PLAN", "value"), ("organization_id", N(P, "data.organizationId")), ("movements", N(P, "data.movements"))])]),
        cnode(RD, "Ready: READY_TO_COMMIT (+ manifest, parts), a cascade's job HELD, or FAILED (+ GD back to its stored status, our Picking unlocked)", ["code/prepare/ready.js"],
              tail("prepareReady(e, p, g)", "prepare ready", pre=ready_pre), ready_fields, arrays=("readyRows", "holdRows", "jobRows", "unlockRows", "pickUnlockRows")),
        gate(ids, "cor_GEparts", "Payload parts to write?", RD, "needParts", [
            K.add(ids, "add_node_GEparts", "Payload parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", STEP,
                  [(p, N(P, "data.partRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]], ORG)]),
        gate(ids, "cor_GEready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_GEready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept: no lease column mapped)", JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message",
                                                                  "error_details", "prepared_payload", "line_count"]])]),
        gate(ids, "cor_GEhold", "A cascade's job to hold?", RD, "needHold", [
            K.update(ids, "update_node_GEhold", "Job HELD + manifest for the Sales Order save (lease released; next_attempt_at = the hold's end)", JOB, ("id", "in", N(RD, "data.holdRows.id")),
                     [(p, N(RD, "data.holdRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message",
                                                                 "error_details", "prepared_payload", "line_count", "lease_owner", "lease_expires_at", "next_attempt_at"]])]),
        gate(ids, "cor_GEfail", "Job FAILED to write?", RD, "needJobUpd", [job_update(ids, "update_node_GEfail", "Job FAILED with the reason (lease released)", RD)]),
        gate(ids, "cor_GEunlock", "GD lock to release?", RD, "needUnlock", [
            rows_update(ids, "update_node_GEunlock", "Goods Delivery back to its stored status (nothing was written)", GD, RD, "unlockRows", ["gd_status"], {"gd_status": "GD Status"})]),
        gate(ids, "cor_GEpickUnlock", "Our Picking lock to release?", RD, "needPickUnlock", [
            rows_update(ids, "update_node_GEpickUnlock", "Picking is_processing = 0 (still at the version this job locked)", PICKT, RD, "pickUnlockRows", ["is_processing"])]),
        K.sql("sql_node_GEback", "Read-back: the job after the write (the truth)", back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
    ] + answer("done", "done", pick(RD, ["route", "result_code", "result_message"]), d("sql_node_GEback"))
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of an EDIT_GD job the worker holds (VALIDATING)")], res_fields, nodes)


# =============================================================================================== GD_EDIT_COMMIT
XG, XE = "code_node_GXguard", "code_node_GXentry"
RES_FIELDS = ["job_id", "job_status", "path", "result_code", "result_message", "evidence"]
END_F = ["jobRows", "needJobUpd", "unlockRows", "needUnlock", "pickUnlockRows", "needPickUnlock", "restoreRows", "needRestore", "result_code", "result_message", "job_status"]
END_ARR = ("jobRows", "unlockRows", "pickUnlockRows", "restoreRows")
CHK = ["route", "stepRows", "needStep"] + END_F
CHK_ARR = ("stepRows",) + END_ARR
CM = "code/commit/"
C0 = [CM + "_common.js"]
SO_RUN = C0 + ["gdc/lift/runtime.js", "@lift_so", "gdc/code/prepare/adapter.js", CM + "so_edit.js", CM + "so_fresh.js"]


def classic_node(nid, new_id, title, refs):
    """a write node of the pinned GOODS_DELIVERY v242, its references re-pointed: the classic's exact column mapping"""
    spec = [s for s in json.load(open(HERE + "/lift/nodes.json"))["sources"] if s["name"] == "GOODS_DELIVERY"][0]
    doc = json.load(open(SRC.fetch(spec)))
    found = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("id") == nid:
                found.append(o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc)
    assert len(found) == 1, nid
    text = json.dumps(found[0], ensure_ascii=False)
    for a, b in refs:
        assert a in text, (nid, a)
        text = text.replace(a, b)
    left = sorted(set(re.findall(r"\{\{node:([A-Za-z0-9_]+)", text)))
    assert all(x.startswith("code_node_GX") for x in left), (nid, left)
    n = json.loads(text)
    n["id"] = new_id
    for k in ("title", "nodeName", "name"):
        n["data"][k] = title
    return n


def build_commit():
    ids = K.Ids(1798200000000)
    TEN, JOBID, GDID, PFX, ORGID = N(XG, "data.tenantId"), N(XG, "data.jobId"), N(XE, "data.gdId"), N(XE, "data.partPrefix"), N(XE, "data.organizationId")
    ENTRY = "const entry = %s;" % d(XE)

    # ---- SQL
    job = q("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.progress_percent, j.progress_message, j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at, j.lease_owner, DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live, (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted,
       CAST(JSON_OBJECT('hold', JSON_EXTRACT(j.request_payload, '$.hold'), 'picking_id', JSON_EXTRACT(j.request_payload, '$.picking_id'),
                        'picking_version', JSON_EXTRACT(j.request_payload, '$.picking_version')) AS CHAR) AS request_payload,
       j.prepared_payload
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@TEN'
   AND j.id = @JOBID""", TEN=TEN, JOBID=JOBID)
    steps = q("""SELECT st.step_name, st.step_status, st.result_ref
  FROM gd_publish_step st
 WHERE st.tenant_id = '@TEN' AND st.job_id = '@JOBID' AND st.is_deleted = 0
   AND ((st.step_name LIKE 'E%' AND st.step_status IN ('DONE', 'STARTED')) OR st.step_name = 'RELEASE')
 ORDER BY st.step_name""", TEN=TEN, JOBID=JOBID)
    gdlock = q(r"""SELECT g.gd_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GDC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN goods_delivery g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@TEN' AND j.id = @JOBID AND j.correlation_id REGEXP '^GD\\|[0-9]{1,20}$'""", TEN=TEN, JOBID=JOBID)
    # the Picking SUBMIT locked (request.picking_id): its lock and version, as read now
    locked_pick = q("""SELECT CAST(t.id AS CHAR) AS id, t.is_processing, @VER AS update_time
  FROM gd_async_job j
  JOIN transfer_order t
    ON t.tenant_id = j.tenant_id AND t.is_deleted = 0
   AND t.id = CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.picking_id')), '') AS UNSIGNED)
 WHERE j.tenant_id = '@TEN' AND j.id = @JOBID""", VER=dt3("t.update_time"), TEN=TEN, JOBID=JOBID)
    own = q("SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@TEN' AND j.id = @JOBID", TEN=TEN, JOBID=JOBID)

    def part(name):
        return q("""SELECT st.step_name, st.result_ref
  FROM gd_publish_step st
 WHERE st.tenant_id = '@TEN' AND st.job_id = '@JOBID' AND st.step_name LIKE CONCAT('@PFX', '@NAME|%') AND st.is_deleted = 0
 ORDER BY st.step_name""", TEN=TEN, JOBID=JOBID, PFX=PFX, NAME=name)

    def intent(name):
        return q("""SELECT st.step_name, st.result_ref
  FROM gd_publish_step st
 WHERE st.tenant_id = '@TEN' AND st.job_id = '@JOBID' AND st.step_name LIKE '@NAME|I|%' AND st.is_deleted = 0
 ORDER BY st.step_name""", TEN=TEN, JOBID=JOBID, NAME=name)

    def resrows(idsref, createlike=None):
        u = q("""SELECT 'U' AS k, JSON_OBJECT('id', CAST(r.id AS CHAR), 'target_gd_id', r.target_gd_id, 'status', r.status, 'reserved_qty', r.reserved_qty,
       'open_qty', r.open_qty, 'delivered_qty', r.delivered_qty, 'doc_no', r.doc_no, 'doc_id', r.doc_id, 'doc_line_id', r.doc_line_id,
       'source_reserved_id', r.source_reserved_id, 'item_uom', CAST(r.item_uom AS CHAR), 'is_deleted', r.is_deleted) AS j
  FROM on_reserved_gd r
 WHERE r.tenant_id = '@TEN' AND r.id IN (@IDS)""", TEN=TEN, IDS=ids_in(idsref))
        if createlike:
            u += q("""
UNION ALL
SELECT 'C' AS k, JSON_OBJECT('id', CAST(r.id AS CHAR), 'job_line_key', r.job_line_key) AS j
  FROM on_reserved_gd r
 WHERE r.tenant_id = '@TEN' AND r.job_line_key LIKE '@LIKE' AND r.is_deleted = 0""", TEN=TEN, LIKE=createlike)
        return u

    def gdlines(idsref):
        """the GD's lines by id (removed ones too: E2 checks them) and the lines this job inserted (job_line_key <job>|L|n)"""
        return q("""SELECT @JOBJ AS j
  FROM goods_delivery_fwii8mvb_sub gl
 WHERE gl.tenant_id = '@TEN' AND gl.goods_delivery_id = @GDID
   AND (gl.id IN (@IDS) OR gl.job_line_key LIKE '@JOBID|L|%')
 ORDER BY gl.id""", JOBJ=jobj("gl", "goods_delivery_fwii8mvb_sub"), TEN=TEN, GDID=GDID, IDS=ids_in(idsref), JOBID=JOBID)

    def gdlines_sel(selref, idsref):
        """only what a check compares: the JSON_OBJECT the ids node built (id, is_deleted, job_line_key, the patched columns)"""
        return q("""SELECT @SEL AS j
  FROM goods_delivery_fwii8mvb_sub gl
 WHERE gl.tenant_id = '@TEN' AND gl.goods_delivery_id = @GDID
   AND (gl.id IN (@IDS) OR gl.job_line_key LIKE '@JOBID|L|%')
 ORDER BY gl.id""", SEL=selref, TEN=TEN, GDID=GDID, IDS=ids_in(idsref), JOBID=JOBID)

    def so_lines(src):
        return q("""SELECT JSON_OBJECT('id', CAST(sl.id AS CHAR), 'sales_order_id', CAST(sl.sales_order_id AS CHAR), 'parent_id', CAST(sl.parent_id AS CHAR),
       'item_bundle_id', CAST(sl.item_bundle_id AS CHAR), 'item_name', sl.item_name, 'so_quantity', sl.so_quantity, 'delivered_qty', sl.delivered_qty,
       'planned_qty', sl.planned_qty, 'outstanding_quantity', sl.outstanding_quantity, 'line_status', sl.line_status) AS j
  FROM sales_order_axszx8cj_sub sl
 WHERE sl.tenant_id = '@TEN' AND sl.is_deleted = 0
   AND (sl.id IN (@SOLINES) OR sl.sales_order_id IN (@SOIDS)
        OR sl.sales_order_id IN (SELECT x.sales_order_id FROM sales_order_axszx8cj_sub x WHERE x.tenant_id = '@TEN' AND x.id IN (@SOLINES)))
 ORDER BY sl.id""", TEN=TEN, SOLINES=ids_in(N(src, "data.soLineIdsJson")), SOIDS=ids_in(N(src, "data.soIdsJson")))

    def so_hdrs(src):
        return q("""SELECT JSON_OBJECT('id', CAST(so.id AS CHAR), 'so_status', so.so_status, 'gd_status', so.gd_status, 'partially_delivered', so.partially_delivered,
       'fully_delivered', so.fully_delivered) AS j
  FROM sales_order so
 WHERE so.tenant_id = '@TEN' AND so.is_deleted = 0
   AND (so.id IN (@SOIDS) OR so.id IN (SELECT x.sales_order_id FROM sales_order_axszx8cj_sub x WHERE x.tenant_id = '@TEN' AND x.id IN (@SOLINES)))
 ORDER BY so.id""", TEN=TEN, SOIDS=ids_in(N(src, "data.soIdsJson")), SOLINES=ids_in(N(src, "data.soLineIdsJson")))

    names_gd = "(JSON_CONTAINS(t.gd_no, JSON_QUOTE('@GDID')) OR JSON_CONTAINS(t.gd_no, '@GDID'))"
    of_picks = "SELECT t.id FROM transfer_order t WHERE t.tenant_id = '@TEN' AND t.organization_id = '@ORGID' AND t.movement_type = 'Picking' AND " + names_gd
    picks = q("SELECT @JOBJ AS j\n  FROM transfer_order t\n WHERE t.tenant_id = '@TEN' AND t.organization_id = '@ORGID' AND t.movement_type = 'Picking' AND @NAMES\n ORDER BY t.id",
              JOBJ=jobj("t", "transfer_order"), NAMES=names_gd, TEN=TEN, ORGID=ORGID, GDID=GDID)
    pick_items = q("SELECT @JOBJ AS j\n  FROM transfer_order_jz8m9w3h_sub pi\n WHERE pi.is_deleted = 0 AND pi.transfer_order_id IN (@OF)\n ORDER BY pi.id",
                   JOBJ=jobj("pi", "transfer_order_jz8m9w3h_sub"), OF=of_picks, TEN=TEN, ORGID=ORGID, GDID=GDID)
    pick_recs = q("SELECT @JOBJ AS j\n  FROM transfer_order_vrqs3cmr_sub pr\n WHERE pr.is_deleted = 0 AND pr.transfer_order_id IN (@OF)\n ORDER BY pr.id",
                  JOBJ=jobj("pr", "transfer_order_vrqs3cmr_sub"), OF=of_picks, TEN=TEN, ORGID=ORGID, GDID=GDID)
    head_full = q("SELECT @JOBJ AS j\n  FROM goods_delivery g\n WHERE g.tenant_id = '@TEN' AND g.id = @GDID", JOBJ=jobj("g", "goods_delivery"), TEN=TEN, GDID=GDID)
    head_no = q("SELECT JSON_OBJECT('id', CAST(g.id AS CHAR), 'delivery_no', g.delivery_no, 'delivery_no_type', g.delivery_no_type, 'gd_status', g.gd_status) AS j\n"
                "  FROM goods_delivery g\n WHERE g.tenant_id = '@TEN' AND g.id = @GDID", TEN=TEN, GDID=GDID)
    iba = q("SELECT COUNT(*) AS intents FROM gd_publish_step st WHERE st.tenant_id = '@TEN' AND st.job_id = 'GDE|@JOBID' AND st.step_name LIKE 'IBA|I|%' AND st.is_deleted = 0",
            TEN=TEN, JOBID=JOBID)

    # ---- node builders
    def res_(tag, src_expr, path, entry_expr=None):
        entry_expr = entry_expr or pick(XE, ["phase", "job_status", "result_message"])
        return ret_block("GX", tag, path, RES_FIELDS, ["@s", CM + "result.js"],
                         tail("commitResult(%s, %s, %s, %s)" % (d(XG), entry_expr, src_expr, json.dumps(path)), "commit result", "res"))

    def end_block(tag, src, title, unlock=False, restore=False):
        nodes = [gate(ids, "cor_GX%sjob" % tag, "Job row to write?", src, "needJobUpd", [
            job_update(ids, "update_node_GX%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW / FAILED (lease released)", src)])]
        if unlock:
            nodes += [gate(ids, "cor_GX%sunlock" % tag, "GD lock to release?", src, "needUnlock", [
                          rows_update(ids, "update_node_GX%sunlock" % tag, "Goods Delivery back to its stored status (nothing irreversible was written)", GD, src,
                                      "unlockRows", ["gd_status"], {"gd_status": "GD Status"})]),
                      gate(ids, "cor_GX%spunlock" % tag, "Our Picking lock to release?", src, "needPickUnlock", [
                          rows_update(ids, "update_node_GX%spunlock" % tag, "Picking is_processing = 0 (at the version this job holds)", PICKT, src, "pickUnlockRows", ["is_processing"])])]
        if restore:
            nodes.append(gate(ids, "cor_GX%srestore" % tag, "A Draft's number to put back?", src, "needRestore", [
                rows_update(ids, "update_node_GX%srestore" % tag, "Goods Delivery: delivery_no + rule as before E0N (the serial issued stays a gap)", GD, src, "restoreRows",
                            ["delivery_no", "delivery_no_type"])]))
        nodes += res_(tag, pick(src, ["job_status", "result_code", "result_message"]), tag.upper() + "_END")
        return K.if_(ids, "if_GX%send" % tag, title, is_(src, "route", "END"), nodes)

    def step_done(tag, src, step):
        return gate(ids, "cor_GX%sstep" % tag, "%s DONE to record?" % step, src, "needStep", [step_add(ids, "add_node_GX%sstep" % tag, "%s DONE (unique job / step)" % step, src, "stepRows")])

    def slice_loop(tag, src, field, title, table, props, labels=None):
        loop_id, sl = "loop_GX%s" % tag, "code_node_GX%sslice" % tag
        return K.loop(ids, loop_id, title, N(src, "data." + field), [
            K.code(sl, "This slice (the loop item: <= 250 rows)", read(HERE + "/code/commit/slice.js").replace("__LOOP__", loop_id), ["n", "rows"], arrays=("rows",), objects=("n",)),
            rows_update(ids, "update_node_GX%swrite" % tag, title + " (<= 250 per call)", table, sl, "rows", props, labels)])

    def parts(tag, names):
        return [("cai_GX%s%s" % (tag, n), n, [K.sql("sql_node_GX%s%s" % (tag, n), "Part %s of the prepared payload" % n, part(n), ["step_name", "result_ref"])]) for n in names]

    def part_js(tag, name):
        return "joinChunks(%s, entry.partPrefix + %s)" % (d("sql_node_GX%s%s" % (tag, name)), json.dumps(name + "|"))

    def par(nid, title, items):
        return K.parallel(nid, title, [("cai_" + sid[9:], t, [K.sql(sid, t, text, cols)]) for sid, t, text, cols in items])

    ef = ["route", "phase", "dbNow", "jobId", "organizationId", "gdId", "gdNo", "storedStatus", "idempotencyKey", "jobStatus", "rowVersion", "attempts", "leaseUntil",
          "unlockOk", "pickUnlockOk", "pickingId", "pickVersion", "number", "partPrefix", "manifest", "needE0", "needE0N", "needE1", "needE2", "needE3", "needE4",
          "needE5", "needE6", "needE7", "doneE7Reorder"] + END_F
    J = ["j"]
    SR = ["step_name", "result_ref"]

    # ------------------------------------------------------------ phase A: E0 revalidate, E0N number (a Draft), E1 inventory -> SPLIT
    ida = "code_node_GXaids"
    ida_js = ENTRY + "\n" + "\n".join("const %s = %s;" % (n, part_js("a", n)) for n in ["RES", "GDL", "SO"]) + """
const idsJson = (a) => JSON.stringify(a.length ? a : ["0"]);
const so = geSoIds(SO);
const res = { ok: RES && GDL && SO ? "YES" : "NO", resIdsJson: idsJson(((RES || {}).updates || []).map((u) => s(u.id)).filter(digits)),
  gdLineIdsJson: idsJson(((GDL || {}).patches || []).map((p) => s(p.id)).concat((GDL || {}).deletes || []).map(s).filter(digits)), soIdsJson: so.soIdsJson, soLineIdsJson: so.lineIdsJson,
  lineCheckSql: geLineCheckSql(GDL, GE_LINE_SQL) };
console.log("commit ids A", JSON.stringify({ ok: res.ok }));
return res;"""
    e0_pre = ENTRY + "\nconst parts = { %s };\nconst fresh = geSoFresh(%s, %s);" % (", ".join("%s: %s" % (n, part_js("a", n)) for n in ["RES", "GDL", "PICK", "SO"]),
                                                                                   d("sql_node_GXe0sol"), d("sql_node_GXe0soh"))
    e0n_check_pre = ENTRY + "\nconst plan = %s;" % pick("code_node_GXe0nplan", ["route", "stepRows", "needStep", "result_message"])
    NUM = "const e = Object.assign({}, entry, { number: s((%s || {}).number) || s(entry.number) });" % d("code_node_GXe0ncheck")
    phase_a = [
        K.parallel("condition_all_GXapart", "Phase A: the parts it reads, in parallel", parts("a", ["RES", "GDL", "PICK", "SO", "GDH", "ENGINE"])),
        cnode(ida, "Phase A: the reservation, line and sales-order ids to read fresh (the lines: only what E0 compares)", C0 + ["gdc/code/prepare/adapter.js", CM + "so_fresh.js", CM + "e2.js", "@linesql"],
              ida_js, ["ok", "resIdsJson", "gdLineIdsJson", "soIdsJson", "soLineIdsJson", "lineCheckSql"]),
        K.if_(ids, "if_GXe0", "IF E0 REVALIDATE is due: nothing written yet - the rows as PREPARE read them, our locks, the sales orders still accept the edit",
              is_(XE, "needE0", "YES"), [
                  par("condition_all_GXe0read", "E0: the rows now, in parallel", [
                      ("sql_node_GXe0res", "E0: the reservations the plan updates", resrows(N(ida, "data.resIdsJson")), ["k", "j"]),
                      ("sql_node_GXe0gdl", "E0: the lines the plan patches or removes (the compared columns only)", gdlines_sel(N(ida, "data.lineCheckSql"), N(ida, "data.gdLineIdsJson")), J),
                      ("sql_node_GXe0pick", "E0: the Pickings naming the delivery", picks, J),
                      ("sql_node_GXe0sol", "E0: the sales-order lines now", so_lines(ida), J),
                      ("sql_node_GXe0soh", "E0: the sales orders now", so_hdrs(ida), J)]),
                  cnode("code_node_GXe0", "E0: GD Processing under this job's lock, every planned row at its before, our Picking, QtyCheckBatch on a fresh SO read -> DONE; else FAILED + unlocks",
                        SO_RUN + [CM + "e0.js"], tail("commitE0(entry, parts, %s, %s, %s, fresh.lines, fresh.shaped)" % (d("sql_node_GXe0res"), d("sql_node_GXe0gdl"), d("sql_node_GXe0pick")),
                                                     "commit E0", pre=e0_pre), CHK, arrays=CHK_ARR),
                  end_block("e0", "code_node_GXe0", "IF the delivery changed meanwhile: FAILED, nothing written", unlock=True),
                  step_done("e0", "code_node_GXe0", "E0_REVALIDATE")]),
        K.if_(ids, "if_GXe0n", "IF E0N NUMBER is due (a Draft saved as Created): 'issued' + its rule once, under an intent", is_(XE, "needE0N", "YES"), [
            par("condition_all_GXe0nread", "E0N: the header's number and an earlier intent", [
                ("sql_node_GXe0nhead", "E0N: the number now", head_no, J), ("sql_node_GXe0nint", "E0N: an earlier run's intent", intent("E0N"), SR)]),
            cnode("code_node_GXe0nplan", "E0N plan: no number to issue / one already issued (adopt) -> DONE; else the intent and the 'issued' write", C0 + [CM + "e0n.js"],
                  tail("commitE0NPlan(entry, %s, %s, %s)" % (part_js("a", "GDH"), d("sql_node_GXe0nhead"), d("sql_node_GXe0nint")), "commit E0N plan", pre=ENTRY),
                  CHK + ["writeRows", "needWrite", "intentRows", "needIntent"], arrays=CHK_ARR + ("writeRows", "intentRows")),
            end_block("e0npl", "code_node_GXe0nplan", "IF the number cannot be planned"),
            gate(ids, "cor_GXe0nintent", "E0N intent to record?", "code_node_GXe0nplan", "needIntent", [
                step_add(ids, "add_node_GXe0nintent", "E0N INTENT: E0N|I|<nnn> (the number and rule before)", "code_node_GXe0nplan", "intentRows")]),
            gate(ids, "cor_GXe0nwrite", "Number to issue?", "code_node_GXe0nplan", "needWrite", [
                rows_update(ids, "update_node_GXe0nwrite", "E0N WRITE: delivery_no 'issued' + its rule (the platform issues the serial)", GD, "code_node_GXe0nplan", "writeRows",
                            ["delivery_no", "delivery_no_type"])]),
            par("condition_all_GXe0nback", "E0N read-back", [
                ("sql_node_GXe0nheadB", "E0N read-back: the number", head_no, J), ("sql_node_GXe0nintB", "E0N read-back: the intent", intent("E0N"), SR)]),
            cnode("code_node_GXe0ncheck", "E0N check: a new number reads back -> DONE (its number for E1's movements)", C0 + [CM + "e0n.js"],
                  tail("plan.route === \"DONE\" ? Object.assign({}, plan, { route: \"OK\" }) : commitE0NCheck(entry, %s, %s)" % (d("sql_node_GXe0nheadB"), d("sql_node_GXe0nintB")),
                       "commit E0N check", pre=e0n_check_pre, post="res.number = res.stepRows && res.stepRows[0] ? s(res.stepRows[0].result_ref) : \"\";"),
                  CHK + ["number"], arrays=CHK_ARR),
            end_block("e0n", "code_node_GXe0ncheck", "IF the number did not read back"),
            step_done("e0n", "code_node_GXe0ncheck", "E0N_NUMBER")]),
        K.if_(ids, "if_GXe1", "IF E1 INVENTORY is due (phase A ends here: SPLIT)", is_(XE, "needE1", "YES"), [
            cnode("code_node_GXe1in", "E1: the operation key and the movements (a Draft's trx_no = the issued number)", C0 + [CM + "e1.js"],
                  tail("commitE1In(e, %s)" % part_js("a", "ENGINE"), "commit E1 in", "{ ok: res.ok, call: res.needCall, movements: res.movements.length, why: res.why }",
                       pre=ENTRY + "\n" + NUM), ["ok", "needCall", "operationKey", "movements", "why"], arrays=("movements",)),
            gate(ids, "cor_GXe1call", "Stock to move?", "code_node_GXe1in", "needCall", [
                call(ids, "workflow_node_GXe1", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; GDE|<job> replays on a re-run)", ENGINE, [
                    ("operation_key", N("code_node_GXe1in", "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", ORGID),
                    ("movements", N("code_node_GXe1in", "data.movements"))])]),
            par("condition_all_GXe1read", "E1: the engine's intent rows and E0N's intent (the number to put back)", [
                ("sql_node_GXe1ops", "E1: this operation's engine intent rows (any = it may have written)", iba, ["intents"]),
                ("sql_node_GXe1int", "E1: E0N's intent (the Draft number before)", intent("E0N"), SR)]),
            cnode("code_node_GXe1", "E1 check: 200 -> DONE + SPLIT; 409 -> wait, then FAILED + unlocks (review once it has intent rows); 400 -> FAILED + unlocks + number back; else review",
                  C0 + [CM + "e1.js"],
                  tail("commitE1(e, %s, %s, eng, list(%s)[0], %s)" % (d(XG), pick("code_node_GXe1in", ["ok", "needCall", "why"]), d("sql_node_GXe1ops"), d("sql_node_GXe1int")),
                       "commit E1", pre=ENTRY + "\n" + NUM + "\nconst eng = %s;" % pick("workflow_node_GXe1", ["code", "result_code", "message"])),
                  CHK + ["splitRows", "needSplit"], arrays=CHK_ARR + ("splitRows",)),
            end_block("e1", "code_node_GXe1", "IF the stock did not move", unlock=True, restore=True),
            step_done("e1", "code_node_GXe1", "E1_INVENTORY"),
            gate(ids, "cor_GXe1split", "SPLIT hand-over to write?", "code_node_GXe1", "needSplit", [
                job_update(ids, "update_node_GXe1split", "Job: SPLIT| hand-over lease (the next call does phase B)", "code_node_GXe1", "splitRows")]),
        ] + res_("asplit", pick("code_node_GXe1", ["job_status", "result_code", "result_message"]), "SPLIT")),
    ]

    # ------------------------------------------------------------ phase B: E2 lines -> SPLIT; phase B2: E3 reservations, E4 sales orders -> SPLIT
    # (one call for the lines and one for the rest: at 2,000 changed lines the single phase B run was 32 MB of node data)
    e2ids_js = ENTRY + "\nconst GDL = %s;" % part_js("b", "GDL") + """
const ins = (GDL || {}).inserts || [];
const idsList = ((GDL || {}).patches || []).map((p) => s(p.id)).concat((GDL || {}).deletes || []).map(s).filter(digits);
const res = { ok: GDL ? "YES" : "NO", gdLineIdsJson: JSON.stringify(idsList.length ? idsList : ["0"]), twoPass: ins.some((x) => /^9\\d{18}$/.test(s(x.parent))) ? "YES" : "NO",
  lineCheckSql: geLineCheckSql(GDL, GE_LINE_SQL) };
console.log("commit E2 ids", JSON.stringify({ ok: res.ok, lines: idsList.length, inserts: ins.length, twoPass: res.twoPass }));
return res;"""
    E2F = CHK + ["insertRows", "needInsert", "patchSlices", "patchCount", "deleteRows", "needDelete", "deferred"]
    E2A = CHK_ARR + ("insertRows", "patchSlices", "deleteRows")
    gdl_ins = [("goods_delivery_id", None), ("parent_id", None)] + [(c, None) for c in LINE_COLS]

    def e2_plan(tag, lines_node):
        return cnode("code_node_GXe2%s" % tag, "E2 plan (%s): inserts not made yet (a bundle item waits for its parent's id), patches at their before (whole rows), removals" % tag,
                     C0 + [CM + "e2.js", "@kinds"], tail("commitE2Plan(entry, %s, %s, GE_KINDS)" % (part_js("b", "GDL"), d(lines_node)), "commit E2 plan " + tag, pre=ENTRY),
                     E2F, arrays=E2A, objects=("patchCount", "deferred"))

    def e2_add(tag):
        src = "code_node_GXe2%s" % tag
        return gate(ids, "cor_GXe2%sins" % tag, "Lines to insert?", src, "needInsert", [
            K.add(ids, "add_node_GXe2%sins" % tag, "E2 WRITE: new GD lines (job_line_key <job>|L|<n>; a re-run finds them)", GDL,
                  [(c, N(src, "data.insertRows." + c)) for c, _ in gdl_ins])])

    phase_b = [
        K.parallel("condition_all_GXbpart", "Phase B: the part it reads", parts("b", ["GDL"])),
        K.if_(ids, "if_GXe2", "IF E2 LINES is due", is_(XE, "needE2", "YES"), [
            cnode("code_node_GXe2ids", "E2: the lines to read (patched, removed), whether new bundle items wait for their parent, what the check reads",
                  C0 + [CM + "e2.js", "@linesql"], e2ids_js, ["ok", "gdLineIdsJson", "twoPass", "lineCheckSql"]),
            K.sql("sql_node_GXe2la", "E2: those lines now (whole rows: a patch goes out whole) + this job's inserted lines", gdlines(N("code_node_GXe2ids", "data.gdLineIdsJson")), J),
            e2_plan("a", "sql_node_GXe2la"),
            end_block("e2a", "code_node_GXe2a", "IF the lines changed after the stock moved: review"),
            e2_add("a"),
            K.if_(ids, "if_GXe2one", "IF no bundle item waited for its parent: this plan's patches and removals", is_("code_node_GXe2ids", "twoPass", "NO"), [
                slice_loop("e2pa", "code_node_GXe2a", "patchSlices", "E2 WRITE: GD lines, whole rows", GDL, LINE_COLS),
                gate(ids, "cor_GXe2dela", "Lines to remove?", "code_node_GXe2a", "needDelete", [
                    rows_update(ids, "update_node_GXe2dela", "E2 WRITE: removed lines is_deleted = 1 (as the classic save)", GDL, "code_node_GXe2a", "deleteRows", ["is_deleted"])])]),
            K.if_(ids, "if_GXe2two", "IF new bundle items waited for their parent: plan again with the parents' ids, then its patches and removals", is_("code_node_GXe2ids", "twoPass", "YES"), [
                K.sql("sql_node_GXe2lb", "E2: the lines again (the parents inserted now)", gdlines(N("code_node_GXe2ids", "data.gdLineIdsJson")), J),
                e2_plan("b", "sql_node_GXe2lb"),
                end_block("e2b", "code_node_GXe2b", "IF the lines changed meanwhile: review"),
                e2_add("b"),
                slice_loop("e2pb", "code_node_GXe2b", "patchSlices", "E2 WRITE: GD lines, whole rows", GDL, LINE_COLS),
                gate(ids, "cor_GXe2delb", "Lines to remove?", "code_node_GXe2b", "needDelete", [
                    rows_update(ids, "update_node_GXe2delb", "E2 WRITE: removed lines is_deleted = 1 (as the classic save)", GDL, "code_node_GXe2b", "deleteRows", ["is_deleted"])])]),
            K.sql("sql_node_GXe2back", "E2 read-back (the compared columns only)", gdlines_sel(N("code_node_GXe2ids", "data.lineCheckSql"), N("code_node_GXe2ids", "data.gdLineIdsJson")), J),
            cnode("code_node_GXe2check", "E2 check: every insert once, every patch and removal reads back -> DONE", C0 + [CM + "e2.js"],
                  tail("commitE2Check(entry, %s, %s)" % (part_js("b", "GDL"), d("sql_node_GXe2back")), "commit E2 check", pre=ENTRY), CHK, arrays=CHK_ARR),
            end_block("e2", "code_node_GXe2check", "IF E2 did not complete"),
            step_done("e2", "code_node_GXe2check", "E2_LINES")]),
        cnode("code_node_GXbsplit", "Phase B done: the SPLIT hand-over (the next call does the reservations and the sales orders)", C0,
              tail("commitPhaseSplit(entry, %s, 85, \"Lines saved; saving the reservations and the sales orders\")" % d(XG), "commit split B", "res", pre=ENTRY),
              ["splitRows", "needSplit"], arrays=("splitRows",)),
        job_update(ids, "update_node_GXbsplit", "Job: SPLIT| hand-over lease (the next call does phase B2)", "code_node_GXbsplit", "splitRows"),
    ] + res_("bsplit", "{ job_status: \"COMMITTING_GD\", result_code: \"\", result_message: \"phase B saved\" }", "SPLIT")

    phase_b2 = [
        K.parallel("condition_all_GXb2part", "Phase B2: the parts it reads, in parallel (E3 resolves the inserted lines through GDL)", parts("b2", ["RES", "GDL", "SO"])),
        K.if_(ids, "if_GXe3", "IF E3 RESERVATIONS is due", is_(XE, "needE3", "YES"), [
            cnode("code_node_GXe3ids", "E3: the reservation ids and the creates' key", C0,
                  ENTRY + "\nconst RES = %s;\nconst u = ((RES || {}).updates || []).map((x) => s(x.id)).filter(digits);\n" % part_js("b2", "RES") +
                  "const res = { ok: RES ? \"YES\" : \"NO\", resIdsJson: JSON.stringify(u.length ? u : [\"0\"]), createLike: entry.jobId + \"|C|%\" };\n"
                  "console.log(\"commit E3 ids\", JSON.stringify({ ok: res.ok, updates: u.length }));\nreturn res;", ["ok", "resIdsJson", "createLike"]),
            par("condition_all_GXe3read", "E3: the reservations now + this job's creates, and the inserted lines (the placeholders' ids)", [
                ("sql_node_GXe3res", "E3: those reservations now + this job's creates", resrows(N("code_node_GXe3ids", "data.resIdsJson"), N("code_node_GXe3ids", "data.createLike")), ["k", "j"]),
                ("sql_node_GXe3gdl", "E3: the lines this job inserted", gdlines('["0"]'), J)]),
            cnode("code_node_GXe3plan", "E3 plan: placeholders resolved; a row written only while it holds what PREPARE read; each create once", C0 + [CM + "e3.js"],
                  tail("commitE3Plan(entry, %s, %s, %s, %s)" % (part_js("b2", "RES"), part_js("b2", "GDL"), d("sql_node_GXe3res"), d("sql_node_GXe3gdl")), "commit E3 plan", pre=ENTRY),
                  CHK + ["slices", "writeCount", "createRows", "needCreates"], arrays=CHK_ARR + ("slices", "createRows"), objects=("writeCount",)),
            end_block("e3pl", "code_node_GXe3plan", "IF the reservations cannot be written"),
            slice_loop("e3", "code_node_GXe3plan", "slices", "E3 WRITE: on_reserved_gd", RESV, RES_COLS),
            gate(ids, "cor_GXe3add", "Reservations to create?", "code_node_GXe3plan", "needCreates", [
                K.add(ids, "add_node_GXe3add", "E3 WRITE: new on_reserved_gd rows (job_line_key <job>|C|<n>)", RESV,
                      [(p, N("code_node_GXe3plan", "data.createRows." + p)) for p in RES_CREATE_COLS])]),
            K.sql("sql_node_GXe3back", "E3 read-back", resrows(N("code_node_GXe3ids", "data.resIdsJson"), N("code_node_GXe3ids", "data.createLike")), ["k", "j"]),
            cnode("code_node_GXe3check", "E3 check: every row at its target, every create once -> DONE", C0 + [CM + "e3.js"],
                  tail("commitE3Check(entry, %s, %s, %s, %s)" % (part_js("b2", "RES"), part_js("b2", "GDL"), d("sql_node_GXe3back"), d("sql_node_GXe3gdl")), "commit E3 check", pre=ENTRY),
                  CHK, arrays=CHK_ARR),
            end_block("e3", "code_node_GXe3check", "IF E3 did not complete"),
            step_done("e3", "code_node_GXe3check", "E3_RESERVATIONS")]),
        K.if_(ids, "if_GXe4", "IF E4 SALES ORDERS is due", is_(XE, "needE4", "YES"), [
            cnode("code_node_GXe4ids", "E4: the sales orders and SO lines to read fresh", C0 + [CM + "so_fresh.js"],
                  tail("geSoIds(%s)" % part_js("b2", "SO"), "commit E4 ids", "res", pre=ENTRY, post="res.soLineIdsJson = res.lineIdsJson;"), ["soIdsJson", "soLineIdsJson"]),
            par("condition_all_GXe4read", "E4 fresh reads in parallel", [
                ("sql_node_GXe4sol", "E4: the SO lines now", so_lines("code_node_GXe4ids"), J), ("sql_node_GXe4soh", "E4: the sales orders now", so_hdrs("code_node_GXe4ids"), J),
                ("sql_node_GXe4int", "E4: an earlier run's intent", intent("E4"), SR)]),
            cnode("code_node_GXe4plan", "E4 plan: QtyCheckBatch, the removed-lines clean-up, UMQapdjk, lwB2FVe0 (lifted) on the fresh rows -> intent; write what is at before",
                  SO_RUN + [CM + "e4.js"],
                  tail("commitE4Plan(entry, %s, %s, %s, %s)" % (part_js("b2", "SO"), d("sql_node_GXe4int"), d("sql_node_GXe4sol"), d("sql_node_GXe4soh")), "commit E4 plan", pre=ENTRY),
                  CHK + ["needIntent", "intentRows", "lineSlices", "lineCount", "headerRows", "needHeaders"], arrays=CHK_ARR + ("intentRows", "lineSlices", "headerRows"), objects=("lineCount",)),
            end_block("e4pl", "code_node_GXe4plan", "IF the sales orders cannot be written"),
            gate(ids, "cor_GXe4intent", "E4 intent to record?", "code_node_GXe4plan", "needIntent", [
                step_add(ids, "add_node_GXe4intent", "E4 INTENT: E4|I|<nnn> (before + after of every row)", "code_node_GXe4plan", "intentRows")]),
            slice_loop("e4", "code_node_GXe4plan", "lineSlices", "E4 WRITE: SO lines", SOL, SO_LINE_COLS),
            gate(ids, "cor_GXe4hdr", "Sales orders to write?", "code_node_GXe4plan", "needHeaders", [
                rows_update(ids, "update_node_GXe4hdr", "E4 WRITE: Sales Order status", SOH, "code_node_GXe4plan", "headerRows", SO_HDR_COLS)]),
            par("condition_all_GXe4back", "E4 read-back in parallel", [
                ("sql_node_GXe4solB", "E4 read-back: SO lines", so_lines("code_node_GXe4ids"), J), ("sql_node_GXe4sohB", "E4 read-back: sales orders", so_hdrs("code_node_GXe4ids"), J),
                ("sql_node_GXe4intB", "E4 read-back: the intent", intent("E4"), SR)]),
            cnode("code_node_GXe4check", "E4 check: every intent row at its after-values -> DONE", C0 + [CM + "e4.js"],
                  tail("commitE4Check(entry, %s, %s, %s)" % (d("sql_node_GXe4intB"), d("sql_node_GXe4solB"), d("sql_node_GXe4sohB")), "commit E4 check", pre=ENTRY), CHK, arrays=CHK_ARR),
            end_block("e4", "code_node_GXe4check", "IF E4 did not complete"),
            step_done("e4", "code_node_GXe4check", "E4_SO")]),
        cnode("code_node_GXb2split", "Phase B2 done: the SPLIT hand-over (the next call does the Picking and the header)", C0,
              tail("commitPhaseSplit(entry, %s, 90, \"Lines, reservations and sales orders saved; saving the Picking and the delivery\")" % d(XG), "commit split B2", "res", pre=ENTRY),
              ["splitRows", "needSplit"], arrays=("splitRows",)),
        job_update(ids, "update_node_GXb2split", "Job: SPLIT| hand-over lease (the next call does phase C)", "code_node_GXb2split", "splitRows"),
    ] + res_("b2split", "{ job_status: \"COMMITTING_GD\", result_code: \"\", result_message: \"phase B2 saved\" }", "SPLIT")

    # ------------------------------------------------------------ phase C: E5 Picking + stamps, E6 header (unlock), E7 after -> COMPLETED
    C_PARTS = ["PICK", "STAMP", "GDH", "AFTER", "GDL"]
    lx = col_exprs("gl", "goods_delivery_fwii8mvb_sub")
    STAMP_SEL = "JSON_OBJECT(" + ", ".join("'%s', %s" % (c, lx[c]) for c in ["id", "is_deleted", "job_line_key", "picking_status"]) + ")"
    PARTS_C = "{ %s }" % ", ".join("%s: %s" % (n, part_js("c", n)) for n in ["PICK", "STAMP", "GDL"])
    cids_js = ENTRY + "\nconst STAMP = %s;\nconst u = ((STAMP || {}).lineIds || []).map(s).filter((x) => digits(x) && !/^9\\d{18}$/.test(x));\n" % part_js("c", "STAMP") + \
        "const res = { gdLineIdsJson: JSON.stringify(u.length ? u : [\"0\"]) };\nconsole.log(\"commit ids C\", JSON.stringify({ stamps: u.length }));\nreturn res;"
    e5_mods = C0 + ["gdc/code/prepare/adapter.js", "code/prepare/plan_edit.js", CM + "e5.js"]   # plan: geRebuildPicking
    e5_chk = C0 + ["gdc/code/prepare/adapter.js", CM + "e5.js"]
    e5_stamp = C0 + [CM + "e2.js", CM + "e5.js"]                                                  # geLineRows
    e5_steps = "list(%s).concat(list(%s))" % (d("sql_node_GXsteps"), d("sql_node_GXe5int"))
    pick_refs = lambda src: [("code_node_6L2Ozea8.data.updateData.", src + ".data.writeRow."), ("code_node_6L2Ozea8.data.existingTOId", src + ".data.writeRow.id")]
    phase_c = [
        K.parallel("condition_all_GXcpart", "Phase C: the parts it reads, in parallel", parts("c", C_PARTS)),
        cnode("code_node_GXcids", "Phase C: the lines to stamp (and this job's inserted lines, for the placeholders)", C0, cids_js, ["gdLineIdsJson"]),
        K.sql("sql_node_GXcgdl", "Phase C: those lines now + this job's inserted lines (id, is_deleted, job_line_key, picking_status)",
              gdlines_sel(STAMP_SEL, N("code_node_GXcids", "data.gdLineIdsJson")), J),
        K.if_(ids, "if_GXe5", "IF E5 PICKING is due: the Picking at the version this job locked (UPDATE) or the outbox guard (CREATE), the header sync, the line stamps",
              is_(XE, "needE5", "YES"), [
                  par("condition_all_GXe5read", "E5 reads in parallel", [
                      ("sql_node_GXe5pick", "E5: the Pickings naming the delivery", picks, J), ("sql_node_GXe5items", "E5: their item rows", pick_items, J),
                      ("sql_node_GXe5recs", "E5: their records", pick_recs, J), ("sql_node_GXe5int", "E5: an earlier run's intent (the target's signature)", intent("E5"), SR)]),
                  cnode("code_node_GXe5plan", "E5 plan: placeholders resolved; UPDATE at our version (intent first) / CREATE once (STARTED first) / header sync", e5_mods,
                        tail("commitE5Run(entry, %s, %s, %s, %s, %s, %s)" % (PARTS_C, d("sql_node_GXcgdl"), e5_steps, d("sql_node_GXe5pick"), d("sql_node_GXe5items"), d("sql_node_GXe5recs")),
                             "commit E5 plan", "{ route: res.route, mode: res.mode, write: res.needWrite, add: res.needAdd, sync: res.needSync, message: res.result_message }", pre=ENTRY),
                        CHK + ["mode", "writeRow", "needWrite", "addRow", "needAdd", "startRows", "needStart", "syncRow", "needSync", "intentRows", "needIntent", "sig"],
                        arrays=CHK_ARR + ("startRows", "intentRows"), objects=("writeRow", "addRow", "syncRow", "sig")),
                  end_block("e5pl", "code_node_GXe5plan", "IF the Picking cannot be written: review"),
                  gate(ids, "cor_GXe5intent", "E5 intent to record?", "code_node_GXe5plan", "needIntent", [
                      step_add(ids, "add_node_GXe5intent", "E5 INTENT: E5|I|<nnn> (the target's signature)", "code_node_GXe5plan", "intentRows")]),
                  gate(ids, "cor_GXe5start", "E5 add to start?", "code_node_GXe5plan", "needStart", [
                      step_add(ids, "add_node_GXe5start", "E5_PICK_ADD STARTED (the outbox guard: written before the add)", "code_node_GXe5plan", "startRows")]),
                  gate(ids, "cor_GXe5write", "Picking to write?", "code_node_GXe5plan", "needWrite", [
                      classic_node("update_node_4uzHPx7M", "update_node_GXe5write", "E5 WRITE: the Picking (update_node_4uzHPx7M's columns, both arrays)", pick_refs("code_node_GXe5plan"))]),
                  gate(ids, "cor_GXe5add", "Picking to add?", "code_node_GXe5plan", "needAdd", [
                      classic_node("add_node_rk182M1q", "add_node_GXe5add", "E5 WRITE: the new Picking (add_node_rk182M1q's columns)",
                                   [("code_node_6L2Ozea8.data.createData.", "code_node_GXe5plan.data.addRow.")])]),
                  gate(ids, "cor_GXe5sync", "Picking header to sync?", "code_node_GXe5plan", "needSync", [
                      classic_node("update_pick_hdr_sync", "update_node_GXe5sync", "E5 WRITE: the Picking header sync (update_pick_hdr_sync's columns)",
                                   [("code_pick_hdr_sync.data.headerData.", "code_node_GXe5plan.data.syncRow."), ("code_pick_hdr_sync.data.pickingId", "code_node_GXe5plan.data.syncRow.id")])]),
                  par("condition_all_GXe5back", "E5 read-back in parallel", [
                      ("sql_node_GXe5pickB", "E5 read-back: the Pickings", picks, J), ("sql_node_GXe5itemsB", "E5 read-back: item rows", pick_items, J),
                      ("sql_node_GXe5recsB", "E5 read-back: records", pick_recs, J)]),
                  cnode("code_node_GXe5check", "E5 check: the Picking reads back (header, signatures; one live Picking after an add) -> DONE (its version)", e5_chk,
                        tail("commitE5Check(entry, rz.pick, %s, %s, %s, %s)" % (pick("code_node_GXe5plan", ["sig"]), d("sql_node_GXe5pickB"), d("sql_node_GXe5itemsB"), d("sql_node_GXe5recsB")),
                             "commit E5 check", pre=ENTRY + "\nconst rz = geE5Resolve(entry, %s, %s);" % (PARTS_C, d("sql_node_GXcgdl")),
                             post="res.ref = res.stepRows && res.stepRows[0] ? s(res.stepRows[0].result_ref) : \"\";"),
                        CHK + ["ref"], arrays=CHK_ARR),
                  end_block("e5", "code_node_GXe5check", "IF the Picking did not read back"),
                  cnode("code_node_GXe5stamps", "E5 stamps: picking_status Created on the plan lines still Not Created / Cancelled / empty (update_node_StampGDLines)", e5_stamp,
                        tail("commitE5Stamps(entry, rz.stamp, %s)" % d("sql_node_GXcgdl"), "commit E5 stamps", "{ stamps: res.stampCount }",
                             pre=ENTRY + "\nconst rz = geE5Resolve(entry, %s, %s);" % (PARTS_C, d("sql_node_GXcgdl"))),
                        ["stampSlices", "stampCount"], arrays=("stampSlices",), objects=("stampCount",)),
                  slice_loop("e5s", "code_node_GXe5stamps", "stampSlices", "E5 WRITE: GD line picking_status", GDL, ["picking_status"]),
                  step_done("e5", "code_node_GXe5check", "E5_PICKING")]),
        K.if_(ids, "if_GXe6", "IF E6 HEADER is due: the changed cells + gd_status Created (the unlock), our Picking lock released at its version", is_(XE, "needE6", "YES"), [
            par("condition_all_GXe6read", "E6 reads in parallel", [
                ("sql_node_GXe6head", "E6: the Goods Delivery now", head_full, J), ("sql_node_GXe6pk", "E6: the Picking SUBMIT locked, now", locked_pick, ["id", "is_processing", "update_time"])]),
            cnode("code_node_GXe6plan", "E6 plan: the header out whole over the fresh row, gd_status Created; the Picking unlock at the version this job holds", C0 + [CM + "e6.js", "@kinds"],
                  tail("commitE6Plan(e, %s, %s, %s, %s, GE_KINDS)" % (part_js("c", "GDH"), part_js("c", "STAMP"), d("sql_node_GXe6head"), d("sql_node_GXe6pk")), "commit E6 plan",
                       pre=ENTRY + "\nconst e = Object.assign({}, entry, { pickVersion: s(%s) || s(entry.pickVersion) });" % d("code_node_GXe5check", "data.ref")),
                  CHK + ["headerRows", "needHeader"], arrays=CHK_ARR + ("headerRows",)),
            end_block("e6pl", "code_node_GXe6plan", "IF the header cannot be written: review"),
            gate(ids, "cor_GXe6head", "Header to write?", "code_node_GXe6plan", "needHeader", [
                rows_update(ids, "update_node_GXe6head", "E6 WRITE: the Goods Delivery header (whole row) + gd_status Created", GD, "code_node_GXe6plan", "headerRows", HEAD_COLS,
                            {"gd_status": "GD Status"})]),
            gate(ids, "cor_GXe6punlock", "Our Picking lock to release?", "code_node_GXe6plan", "needPickUnlock", [
                rows_update(ids, "update_node_GXe6punlock", "Picking is_processing = 0 (at the version this job holds)", PICKT, "code_node_GXe6plan", "pickUnlockRows", ["is_processing"])]),
            K.sql("sql_node_GXe6back", "E6 read-back", head_full, J),
            cnode("code_node_GXe6check", "E6 check: Created, every cell reads back -> DONE", C0 + [CM + "e6.js"],
                  tail("commitE6Check(entry, %s, %s, %s)" % (part_js("c", "GDH"), part_js("c", "STAMP"), d("sql_node_GXe6back")), "commit E6 check", pre=ENTRY), CHK, arrays=CHK_ARR),
            end_block("e6", "code_node_GXe6check", "IF the header did not read back"),
            step_done("e6", "code_node_GXe6check", "E6_HEADER")]),
        K.if_(ids, "if_GXe7", "IF E7 AFTER is due: REORDER_SET_REDIS GD_CREATED once, the items' last_transaction_date", is_(XE, "needE7", "YES"), [
            cnode("code_node_GXe7", "E7 plan: the reorder call at most once (marker first), the item dates in slices", C0 + [CM + "e7.js"],
                  tail("commitE7Plan(entry, %s, entry.doneE7Reorder)" % part_js("c", "AFTER"), "commit E7", "{ reorder: res.needReorder, items: res.itemCount }", pre=ENTRY),
                  ["needReorder", "markerRows", "previous", "latest", "itemSlices", "itemCount"], arrays=("markerRows", "itemSlices"), objects=("previous", "latest", "itemCount")),
            gate(ids, "cor_GXe7reorder", "Reorder tracking to run?", "code_node_GXe7", "needReorder", [
                step_add(ids, "add_node_GXe7marker", "E7_REORDER marker (written before the call: at most once)", "code_node_GXe7", "markerRows"),
                call(ids, "workflow_node_GXe7reorder", "REORDER_SET_REDIS GD_CREATED (as GOODS_DELIVERY's workflow_node_ReorderCreated)", REORDER, [
                    ("document_type", "GD_CREATED", "value"), ("previous_data", N("code_node_GXe7", "data.previous")), ("latest_data", N("code_node_GXe7", "data.latest"))])]),
            slice_loop("e7", "code_node_GXe7", "itemSlices", "E7 WRITE: Item last_transaction_date", ITEM, ["last_transaction_date"])]),
        cnode("code_node_GXfinish", "FINISH: E7_AFTER DONE, the job COMPLETED (the notes the form shows)", C0 + [CM + "e7.js"],
              tail("commitFinish(entry, entry.manifest)", "commit finish", "{ message: res.result_message }", pre=ENTRY), ["stepRows", "jobRows", "result_message"], arrays=("stepRows", "jobRows")),
        gate(ids, "cor_GXfinstep", "E7_AFTER DONE to record?", XE, "needE7", [step_add(ids, "add_node_GXfinstep", "E7_AFTER DONE", "code_node_GXfinish", "stepRows")]),
        job_update(ids, "update_node_GXdone", "Job COMPLETED (lease released)", "code_node_GXfinish"),
    ] + res_("done", "{ job_status: \"COMPLETED\", result_code: \"\", result_message: %s }" % d("code_node_GXfinish", "data.result_message"), "DONE")

    nodes = [
        cnode(XG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", C0 + [CM + "guard.js"],
              tail("publishGuard({ jobId: [{{workflowparams:job_id}}][0], systemTenantId: [{{system:tenantId}}][0], uuid: [{{system:uuid}}][0] })", "commit guard", "res"),
              ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_GXreject", "IF the input is invalid: answer, write nothing", is_(XG, "route", "REJECT"),
              res_("rej", "{ job_status: \"\", result_code: %s, result_message: %s }" % (d(XG, "data.result_code"), d(XG, "data.result_message")), "REJECTED_INPUT", "{}")),
        par("condition_all_GXfacts", "Facts in parallel: the job, its step markers, the GD's status and lock, the Picking SUBMIT locked", [
            ("sql_node_GXjob", "The job (+ DB clock, lease flag, lease_until, due, the request's hold / Picking, the manifest)", job,
             ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
              "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted",
              "request_payload", "prepared_payload"]),
            ("sql_node_GXsteps", "This job's E step markers (DONE / STARTED) and a RELEASE", steps, ["step_name", "step_status", "result_ref"]),
            ("sql_node_GXgd", "The GD's status and its latest lock", gdlock, ["gd_status", "lock_ref"]),
            ("sql_node_GXpick", "The Picking SUBMIT locked: its lock and version", locked_pick, ["id", "is_processing", "update_time"])]),
        plus_field(cnode(XE, "Entry: what this run does (phase A: E0 E0N E1 -> SPLIT; B: E2 -> SPLIT; B2: E3 E4 -> SPLIT; C: E5 E6 E7 -> COMPLETED), the lease claim", C0 + [CM + "entry.js"],
              tail("commitEntry(%s, %s, %s, %s, %s)" % (d(XG), d("sql_node_GXjob"), d("sql_node_GXsteps"), d("sql_node_GXgd"), d("sql_node_GXpick")), "commit entry",
                   "{ route: res.route, phase: res.phase, result: res.result_code, message: res.result_message }"),
              ef, arrays=END_ARR, objects=("rowVersion", "attempts", "manifest")), "jsatgxen", "jsAt"),
        K.if_(ids, "if_GXnowrite", "IF this run may not write: answer only", is_(XE, "route", "NO_WRITE"),
              res_("nw", pick(XE, ["job_status", "result_code", "result_message"]), "NO_WRITE")),
        K.if_(ids, "if_GXentryend", "IF the manifest is unusable: FAILED (+ unlocks) or REQUIRES_REVIEW", "%s || %s" % (is_(XE, "route", "FAIL"), is_(XE, "route", "REVIEW")), [
            gate(ids, "cor_GXefjob", "Job row to write?", XE, "needJobUpd", [job_update(ids, "update_node_GXefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", XE)]),
            gate(ids, "cor_GXefunlock", "GD lock to release?", XE, "needUnlock", [
                rows_update(ids, "update_node_GXefunlock", "Goods Delivery back to its stored status", GD, XE, "unlockRows", ["gd_status"], {"gd_status": "GD Status"})]),
            gate(ids, "cor_GXefpunlock", "Our Picking lock to release?", XE, "needPickUnlock", [
                rows_update(ids, "update_node_GXefpunlock", "Picking is_processing = 0", PICKT, XE, "pickUnlockRows", ["is_processing"])]),
        ] + res_("ef", pick(XE, ["job_status", "result_code", "result_message"]), "ENTRY_END")),
        job_update(ids, "update_node_GXclaim", "Lease claim: job COMMITTING_GD, lease_owner = this run, lease_expires_at = now + 10 min", XE),
        K.sql("sql_node_GXown", "Read-back: the job after the lease claim", own, ["id", "job_status", "lease_owner", "row_version"]),
        cnode("code_node_GXown", "Own: COMMITTING_GD under this run's lease, else LOST", C0 + [CM + "own.js"],
              tail("commitOwn(%s, %s)" % (d(XG), d("sql_node_GXown")), "commit own", "res"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_GXlost", "IF another run took the job: stop", is_("code_node_GXown", "route", "LOST"),
              res_("lost", pick("code_node_GXown", ["result_code", "result_message"]), "LOST")),
        K.if_(ids, "if_GXphaseA", "IF phase A: E0 REVALIDATE, E0N NUMBER, E1 INVENTORY -> SPLIT", is_(XE, "phase", "A"), phase_a),
        K.if_(ids, "if_GXphaseB", "IF phase B: E2 LINES -> SPLIT", is_(XE, "phase", "B"), phase_b),
        K.if_(ids, "if_GXphaseB2", "IF phase B2: E3 RESERVATIONS, E4 SALES ORDERS -> SPLIT", is_(XE, "phase", "B2"), phase_b2),
        K.if_(ids, "if_GXphaseC", "IF phase C: E5 PICKING, E6 HEADER, E7 AFTER -> COMPLETED", is_(XE, "phase", "C"), phase_c),
    ] + res_("none", pick(XE, ["job_status", "result_code", "result_message"]), "NO_PHASE")
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of an EDIT_GD job (READY_TO_COMMIT, or COMMITTING_GD to resume)")], RES_FIELDS, nodes)


# =============================================================================================== GD_EDIT_WORKER
# GD_COMPLETE_WORKER's builder with the edit's changes: polls EDIT_GD (an expired HELD job is due: it is cancelled); every
# unlock puts the GD back to its stored status (request.stored_status) and releases our Picking only while it is at the
# version this job locked (pick_id); GD_EDIT_COMMIT is called up to four times a tick (it splits three times)
GD_LOCK_JOIN = r"""LEFT JOIN goods_delivery g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^GD\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GDC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)
  LEFT JOIN transfer_order t
    ON t.tenant_id = j.tenant_id
   AND t.id = CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.picking_id')), '') AS UNSIGNED)"""
UNLOCK_COLS = ("(CASE WHEN g.gd_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gd_id,\n"
               "       JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.stored_status')) AS stored_status,\n"
               "       (CASE WHEN t.id IS NOT NULL AND t.is_processing = 1 AND " + dt3("t.update_time") +
               " = COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.picking_version')), ''), JSON_UNQUOTE(JSON_EXTRACT(j.prepared_payload, '$.picking_version')))"
               " THEN CAST(t.id AS CHAR) ELSE '0' END) AS pick_id")
WJOB_COLS = ["db_now", "id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner", "lease_expires_at", "lease_live",
             "row_version", "error_code", "error_message", "error_details", "gd_id", "stored_status", "pick_id", "finished_at"]


def wcode(path, subs=None):
    body = read(HERE + "/code/worker/" + path)
    if "//@include _common.js\n" in body:
        body = body.replace("//@include _common.js\n", read(HERE + "/code/worker/_common.js") + "\n")
    for a, b in (subs or {}).items():
        assert a in body, (path, a)
        body = body.replace(a, b)
    left = re.findall(r"__[A-Z]+__", body)
    assert not left, (path, left)
    return body


def wjob_sql(ten, job_ref):
    return q("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_percent,
       j.progress_message,
       j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live,
       j.row_version,
       j.error_code,
       j.error_message,
       j.error_details,
       @UNLOCK,
       DATE_FORMAT(j.finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@TEN'
   AND j.id = @JOBID
  @LOCKJOIN""", UNLOCK=UNLOCK_COLS, LOCKJOIN=GD_LOCK_JOIN, TEN=ten, JOBID=job_ref)


def build_worker():
    ids = K.Ids(1798300000000)
    G = "code_node_GWguard"
    TEN = N(G, "data.tenantId")
    prep = ("GD_EDIT_PREPARE", IDS.get("GD_EDIT_PREPARE", "0"))
    comm = ("GD_EDIT_COMMIT", IDS.get("GD_EDIT_COMMIT", "0"))
    res_fields = ["worker_route", "processed", "jobs", "job_id", "job_status", "result_code", "result_message", "gd_id", "evidence"]
    poll = q("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       x.id, x.organization_id, x.gd_id, x.stored_status, x.pick_id, x.job_status, x.progress_percent, x.progress_message, x.attempt_count, x.next_attempt_at,
       x.lease_owner, x.lease_expires_at, x.dead_lease, x.row_version, x.error_code, x.error_message, x.error_details, x.claim_id, x.claim_started_at, x.claim_owner
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN (SELECT CAST(j.id AS CHAR) AS id,
                    j.organization_id,
                    @UNLOCK,
                    j.job_status,
                    j.progress_percent,
                    j.progress_message,
                    j.attempt_count,
                    DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at,
                    j.lease_owner,
                    DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
                    (j.lease_owner IS NOT NULL AND j.lease_owner <> '' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= NOW(3)) AS dead_lease,
                    j.row_version,
                    j.error_code,
                    j.error_message,
                    j.error_details,
                    CAST(c.id AS CHAR) AS claim_id,
                    DATE_FORMAT(c.started_at, '%Y-%m-%d %H:%i:%s') AS claim_started_at,
                    c.result_ref AS claim_owner,
                    j.create_time AS created
               FROM gd_async_job j
               LEFT JOIN gd_publish_step c
                 ON c.tenant_id = '@TEN'
                AND c.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
                AND c.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)
                AND c.is_deleted = 0
               @LOCKJOIN
              WHERE j.tenant_id = '@TEN'
                AND j.is_deleted = 0
                AND j.command = 'EDIT_GD'
                AND (@JOBID = 0 OR j.id = @JOBID)
                AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'HELD')
                AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= NOW(3))
                AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW(3))
                AND (c.id IS NULL OR c.started_at <= NOW(3) - INTERVAL 10 MINUTE)
                AND (@JOBID <> 0 OR NOT EXISTS (SELECT 1 FROM gd_publish_step r WHERE r.tenant_id = j.tenant_id AND r.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
                                                 AND r.step_name = 'RELEASE' AND r.is_deleted = 0 AND r.started_at > NOW(3) - INTERVAL 10 SECOND))
              ORDER BY j.create_time, j.id
              LIMIT 5) x
    ON 1 = 1""", UNLOCK=UNLOCK_COLS.replace("\n       ", "\n                    "), LOCKJOIN=GD_LOCK_JOIN.replace("\n", "\n             "), TEN=TEN, JOBID=N(G, "data.jobId"))
    tick = q("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       @UNLOCK,
       j.job_status,
       j.progress_percent,
       j.progress_message,
       j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live,
       (j.lease_owner IS NOT NULL AND j.lease_owner <> '' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= n.t) AS dead_lease,
       (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due_now,
       j.row_version,
       j.error_code,
       j.error_message,
       j.error_details,
       CAST(cw.id AS CHAR) AS claim_id,
       DATE_FORMAT(cw.started_at, '%Y-%m-%d %H:%i:%s') AS claim_started_at,
       cw.result_ref AS claim_owner,
       (cw.id IS NOT NULL AND cw.started_at > n.t - INTERVAL 10 MINUTE) AS claim_live
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@TEN'
   AND j.is_deleted = 0
   AND j.id IN (@IDLIST)
  LEFT JOIN gd_publish_step cw
    ON cw.tenant_id = '@TEN'
   AND cw.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
   AND cw.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)
   AND cw.is_deleted = 0
  @LOCKJOIN""", UNLOCK=UNLOCK_COLS, LOCKJOIN=GD_LOCK_JOIN, TEN=TEN, IDLIST=N("code_node_GWplan", "data.jobIdsSql"))
    final = q("""SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.attempt_count, j.lease_owner, j.error_code, j.error_message, SUBSTRING(j.correlation_id, 4) AS gd_id
  FROM gd_async_job j
 WHERE j.tenant_id = '@TEN'
   AND j.id IN (@IDLIST)""", TEN=TEN, IDLIST=N("code_node_GWplan", "data.jobIdsSql"))
    JOBREF = N("code_node_GWpick", "data.jobId")

    def jobread(nid, title):
        return K.sql(nid, title, wjob_sql(TEN, JOBREF), WJOB_COLS)

    def unlocks(tag, src, what):
        return [gate(ids, "cor_GW%sUnlock" % tag, "GD lock to release %s?" % what, src, "needUnlock", [
                    rows_update(ids, "update_node_GW%sUnlock" % tag, "Goods Delivery back to its stored status (nothing was saved)", GD, src, "unlockRows", ["gd_status"],
                                {"gd_status": "GD Status"})]),
                gate(ids, "cor_GW%sPickUnlock" % tag, "Our Picking lock to release %s?" % what, src, "needPickUnlock", [
                    rows_update(ids, "update_node_GW%sPickUnlock" % tag, "Picking is_processing = 0 (still at the version this job locked)", PICKT, src, "pickUnlockRows",
                                ["is_processing"])])]

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
                   ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "pickUnlockRows", "needPickUnlock", "publishRoute",
                    "result_code", "result_message", "job_status"], arrays=("jobRows", "unlockRows", "pickUnlockRows")),
            gate(ids, "cor_GW%sJob" % prefix, "Job row to write after the %s?" % which, after, "needJobUpd", [
                job_update(ids, "update_node_GW%sJob" % prefix, "Job: FAILED (a hard code) / retry with backoff (lease released)", after)]),
        ] + unlocks(prefix, after, "after the " + which)

    plan_ref = d("code_node_GWplan")
    item_cols = ["db_now", "id", "organization_id", "gd_id", "stored_status", "pick_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
                 "lease_owner", "lease_expires_at", "dead_lease", "row_version", "error_code", "error_message", "error_details", "claim_id", "claim_started_at", "claim_owner"]
    nodes = [
        K.code(G, "Guard: optional job_id, session tenant, this run's lease owner WRK|<nonce>", wcode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_GWreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_GWrejres", "Result (REJECTED_INPUT)", wcode("result.js", {"__PATH__": "REJECTED_INPUT", "__PLAN__": "null", "__ROWS__": "[]"}), res_fields),
            K.ret("return_node_GWrej", "Return (invalid input)", [(f, N("code_node_GWrejres", "data." + f)) for f in res_fields])]),
        K.sql("sql_node_GWpoll", "Poll: the due EDIT_GD jobs of the tenant (at most 5, oldest first; an expired hold is due; no live lease / claim row) + DB clock", poll, item_cols),
        K.code("code_node_GWplan", "Plan: the loop's items (the due jobs with their claim facts), the run start", wcode("plan.js"),
               ["route", "dbNow", "runStart", "items", "count", "jobIdsSql", "result_code", "result_message"], arrays=("items",)),
        K.set_cache("set_cache_GWidx0", "Loop index = 0 (per run: the key carries this run's nonce)", "gde_wrk_" + N(G, "data.nonce"), "0"),
        K.loop(ids, "loop_GWjobs", "Loop over the planned jobs (in order; a lost claim gate ends the tick, the rest wait for the next)", N("code_node_GWplan", "data.items"), [
            K.get_cache("get_cache_GWidx", "Loop index", "gde_wrk_" + N(G, "data.nonce")),
            K.sql("sql_node_GWtick", "Tick: the FRESH read of the planned jobs (state, lease, backoff, claim row, unlocks) + the lease end of a claim made now", tick,
                  ["db_now", "lease_until", "id", "organization_id", "gd_id", "stored_status", "pick_id", "job_status", "progress_percent", "progress_message", "attempt_count",
                   "next_attempt_at", "lease_owner", "lease_expires_at", "lease_live", "dead_lease", "due_now", "row_version", "error_code", "error_message", "error_details",
                   "claim_id", "claim_started_at", "claim_owner", "claim_live"]),
            K.code("code_node_GWpick", "Pick: the item by index; SKIP after the budget / not due / live lease / live claim; the claim gate rows", wcode("pick.js"),
                   ["route", "index", "nextIndex", "dbNow", "leaseUntil", "elapsed", "jobId", "organizationId", "gdId", "item", "rvBase", "rvRows", "needRvUpd", "claimName",
                    "claimRows", "needClaimAdd", "result_message"], arrays=("rvRows", "claimRows"), objects=("item",)),
            gate(ids, "cor_GWrv", "Dead claim to move past (row_version = v + 1)?", "code_node_GWpick", "needRvUpd", [
                job_update(ids, "update_node_GWrv", "Job: row_version = v + 1 and the retry count (absolute)", "code_node_GWpick", "rvRows", ["id", "row_version", "attempt_count"])]),
            gate(ids, "cor_GWclaimAdd", "Claim row to insert?", "code_node_GWpick", "needClaimAdd", [
                step_add(ids, "add_node_GWclaim", "CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> (unique tenant / job / step: a twin's insert fails and its run ends)",
                         "code_node_GWpick", "claimRows")]),
            K.code("code_node_GWclaim", "Claim: the lease / state write; a dead lease or claim = one retry; exhausted after max_retries; an expired hold -> EXPIRE", wcode("claim.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "gdId", "rowVersion", "attempts", "claimRows", "needClaim", "failRows", "unlockRows", "pickUnlockRows",
                    "exhausted", "result_code", "result_message", "job_status"], arrays=("claimRows", "failRows", "unlockRows", "pickUnlockRows")),
            gate(ids, "cor_GWlease", "Lease / state to write?", "code_node_GWclaim", "needClaim", [
                job_update(ids, "update_node_GWlease", "Lease write: WRK|<nonce> for 10 min, VALIDATING for a QUEUED job, the retry count", "code_node_GWclaim", "claimRows")]),
            jobread("sql_node_GWown", "Read-back: the job after the lease write"),
            K.code("code_node_GWown", "Own: state and lease as written -> PREPARE / PUBLISH / RESUME / EXHAUST / EXPIRE; else LOST", wcode("own.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "gdId", "attempts", "failRows", "unlockRows", "pickUnlockRows", "needFail", "needUnlock", "needPickUnlock",
                    "rowVersion", "result_code", "result_message", "job_status"], arrays=("failRows", "unlockRows", "pickUnlockRows")),
            gate(ids, "cor_GWfail", "Exhausted / expired: job row to write?", "code_node_GWown", "needFail", [
                job_update(ids, "update_node_GWfail", "Job FAILED (pre-commit) / CANCELLED (an expired hold) / REQUIRES_REVIEW (COMMITTING_GD)", "code_node_GWown", "failRows")]),
        ] + unlocks("fail", "code_node_GWown", "(exhausted pre-commit / expired hold)") + [
            K.if_(ids, "if_GWprep", "IF the job is pre-commit under this run's lease: the ONE GD_EDIT_PREPARE call", is_("code_node_GWown", "route", "PREPARE"), [
                call(ids, "workflow_node_GWprep", "GD_EDIT_PREPARE (set-based reads; writes the job, unlocks on FAILED, holds a cascade's job)", prep, [("job_id", JOBREF)]),
                K.code("code_node_GWprepResp", "The prepare response, normalized (evidence; the job row decides)",
                       wcode("callee.js", {"__WHAT__": "prepare", "__NODE__": "workflow_node_GWprep", "\"__EXTRA__\"": "\"evidence\""}),
                       ["called", "job_id", "job_status", "result_code", "result_message", "evidence"]),
                jobread("sql_node_GWprepBack", "Read-back: the job after prepare (the truth)"),
                K.code("code_node_GWafterPrep", "After prepare: READY_TO_COMMIT -> publish; HELD -> nothing; FAILED -> lease released; else a hard code fails it / a counted retry",
                       wcode("after_prepare.js"),
                       ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "pickUnlockRows", "needPickUnlock", "prepareResult", "prepareMessage",
                        "result_code", "result_message", "job_status"], arrays=("jobRows", "unlockRows", "pickUnlockRows")),
                gate(ids, "cor_GWprepJob", "Job row to write after prepare?", "code_node_GWafterPrep", "needJobUpd", [
                    job_update(ids, "update_node_GWprepJob", "Job: lease released / FAILED / retry with backoff", "code_node_GWafterPrep")]),
            ] + unlocks("prep", "code_node_GWafterPrep", "after prepare")),
            jobread("sql_node_GWmid", "The job before the publish decision"),
            K.code("code_node_GWmid", "Before publish: READY_TO_COMMIT under this run's lease, or COMMITTING_GD with no live lease -> PUBLISH (a HELD job never)", wcode("mid.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_GWpub", "IF the job is to be published / resumed: GD_EDIT_COMMIT (phase A, or the phase a resume is at)", is_("code_node_GWmid", "route", "PUBLISH"),
                  publish("pub", "code_node_GWmid", "publish", "GD_EDIT_COMMIT (phase A: revalidate, a Draft's number, inventory; or the phase a resume is at)")),
            jobread("sql_node_GWsplit", "The job after the first call (the split decision)"),
            K.code("code_node_GWsplit", "Next publish: COMMITTING_GD under a SPLIT| hand-over lease -> PUBLISH again", wcode("split.js"), ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_GWpub2", "IF GD_EDIT_COMMIT ended SPLIT: the second call", is_("code_node_GWsplit", "route", "PUBLISH"),
                  publish("pub2", "code_node_GWsplit", "second publish", "GD_EDIT_COMMIT again after its SPLIT")),
            jobread("sql_node_GWsplit2", "The job after the second call (the split decision)"),
            K.code("code_node_GWsplit2", "Next publish: split again -> the third call", wcode("split.js", {"code_node_GWmid": "code_node_GWsplit", "sql_node_GWsplit.data": "sql_node_GWsplit2.data"}),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_GWpub3", "IF GD_EDIT_COMMIT ended SPLIT again: the third call", is_("code_node_GWsplit2", "route", "PUBLISH"),
                  publish("pub3", "code_node_GWsplit2", "third publish", "GD_EDIT_COMMIT again after its second SPLIT")),
            jobread("sql_node_GWsplit3", "The job after the third call (the split decision)"),
            K.code("code_node_GWsplit3", "Next publish: split a third time -> the fourth call", wcode("split.js", {"code_node_GWmid": "code_node_GWsplit2", "sql_node_GWsplit.data": "sql_node_GWsplit3.data"}),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_GWpub4", "IF GD_EDIT_COMMIT ended SPLIT a third time: the fourth call", is_("code_node_GWsplit3", "route", "PUBLISH"),
                  publish("pub4", "code_node_GWsplit3", "fourth publish", "GD_EDIT_COMMIT again after its third SPLIT")),
            K.set_cache("set_cache_GWidxN", "Next loop index", "gde_wrk_" + N(G, "data.nonce"), N("code_node_GWpick", "data.nextIndex")),
        ]),
        K.sql("sql_node_GWfinal", "Read-back: the planned jobs (final)", final, ["id", "job_status", "attempt_count", "lease_owner", "error_code", "error_message", "gd_id"]),
        K.code("code_node_GWresult", "Result (DONE)", wcode("result.js", {"__PATH__": "DONE", "__PLAN__": plan_ref, "__ROWS__": d("sql_node_GWfinal")}), res_fields),
        K.ret("return_node_GWdone", "Return the tick's result", [(f, N("code_node_GWresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "optional: gd_async_job.id (digits) to drive this job only (the form's / SO save's kick); empty: the oldest due EDIT_GD jobs "
                                            "of the session tenant (at most 5 per tick)")], res_fields, nodes)


# =============================================================================================== GD_EDIT_SUBMIT
S_READS = ["hdr", "lines", "setup", "link", "items", "sohl", "soh", "pick", "picki", "pickr", "bins", "pfmt", "lock", "aitem", "abal", "ares", "aref"]  # the gates stop before the planner: no alloc / pend
SUB_RES = ["route", "code", "message", "reason", "command", "job_id", "job_status", "gd_id", "gd_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "picking_reversal_note", "credit_limit_note", "cascade_ref", "evidence"]
GATE_MODS = ["gdc/lift/runtime.js", "@lift", "gdc/code/prepare/chain.js", "gdc/code/prepare/adapter.js", "code/prepare/alloc_edit.js", "code/prepare/chain_edit.js", "code/submit/delta.js",
             "code/prepare/apply_delta.js", "code/prepare/adapter_edit.js", "gdc/code/submit/required.js", "code/submit/_common.js", "code/submit/gate.js", "@kinds"]
SC = ["code/submit/_common.js"]


def build_submit():
    ids = K.Ids(1798400000000)
    G, E, GT, PO = "code_node_GSguard", "code_node_GSentry", "code_node_GSgate", "code_node_GSpost"
    TEN, GDID = N(G, "data.tenantId"), N(G, "data.gdId")
    # an open job on the GD: an edit not finished; a completion / Packing open (REQUIRES_REVIEW counts); a GD V2 create whose
    # Picking outbox is not done
    open_jobs = """(SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(o.id AS CHAR), 'command', o.command, 'job_status', o.job_status, 'progress_percent', o.progress_percent,
                                             'progress_message', o.progress_message, 'error_code', o.error_code, 'error_message', o.error_message)) AS CHAR)
          FROM gd_async_job o
         WHERE o.tenant_id = '@TEN' AND o.is_deleted = 0
           AND ((o.correlation_id = 'GD|@GDID'
                 AND ((o.command = 'EDIT_GD' AND o.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED'))
                      OR (o.command = 'COMPLETE_GD' AND o.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'REQUIRES_REVIEW'))
                      OR (o.command = 'COMPLETE_PACKING' AND o.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PACKING', 'REQUIRES_REVIEW'))))
                OR (o.command = 'CREATE_GD_FROM_FORM' AND o.gd_id = '@GDID'
                    AND o.job_status IN ('RECONCILING_GD', 'GD_COMMITTED', 'CREATING_PICKING', 'PICKING_RETRYING', 'PICKING_READY', 'REQUIRES_REVIEW')))) AS open_jobs"""
    facts = q("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(g.id AS CHAR) AS gd_id,
       g.delivery_no,
       g.gd_status,
       g.organization_id,
       CAST(g.plant_id AS CHAR) AS plant_id,
       (SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub l WHERE l.tenant_id = '@TEN' AND l.goods_delivery_id = @GDID AND l.is_deleted = 0) AS line_count,
       (SELECT p.step_name FROM gd_publish_step p
         WHERE p.tenant_id = '@TEN' AND p.job_id = 'GDC|@GDID' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS last_lock,
       (SELECT CAST(JSON_OBJECT('id', CAST(x.id AS CHAR), 'command', x.command, 'job_status', x.job_status, 'progress_percent', x.progress_percent,
                                'progress_message', x.progress_message, 'error_code', x.error_code, 'error_message', x.error_message,
                                'notes', IF(x.command = 'EDIT_GD', JSON_EXTRACT(x.request_payload, '$.notes'), NULL),
                                'cascade_ref', IF(x.command = 'EDIT_GD', JSON_UNQUOTE(JSON_EXTRACT(x.request_payload, '$.cascade_ref')), NULL)) AS CHAR)
          FROM gd_async_job x
         WHERE x.tenant_id = '@TEN' AND x.is_deleted = 0
           AND x.idempotency_key = (SELECT p.result_ref FROM gd_publish_step p
                                     WHERE p.tenant_id = '@TEN' AND p.job_id = 'GDC|@GDID' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1)
         ORDER BY x.id DESC LIMIT 1) AS lock_job,
       @OPEN,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(t.id AS CHAR), 'to_id', t.to_id, 'to_status', t.to_status, 'is_processing', t.is_processing,
                                             'lock_age_sec', TIMESTAMPDIFF(SECOND, t.update_time, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')))) AS CHAR)
          FROM transfer_order t
         WHERE t.tenant_id = '@TEN' AND t.is_deleted = 0 AND t.movement_type = 'Picking'
           AND (JSON_CONTAINS(t.gd_no, JSON_QUOTE('@GDID')) OR JSON_CONTAINS(t.gd_no, '@GDID'))) AS pickings,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(c.id AS CHAR), 'picking_id', c.picking_id, 'job_status', c.job_status)) AS CHAR)
          FROM gd_async_job c
         WHERE c.tenant_id = '@TEN' AND c.is_deleted = 0 AND c.command = 'CONFIRM_PICKING' AND c.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND c.picking_id IN (SELECT CAST(t2.id AS CHAR) COLLATE utf8mb4_general_ci FROM transfer_order t2
                                 WHERE t2.tenant_id = '@TEN' AND t2.is_deleted = 0 AND t2.movement_type = 'Picking'
                                   AND (JSON_CONTAINS(t2.gd_no, JSON_QUOTE('@GDID')) OR JSON_CONTAINS(t2.gd_no, '@GDID')))) AS open_pickings,
       IF(g.gd_status = 'Draft',
          (SELECT CONCAT(j.job_status, '|', CAST(j.id AS CHAR), '|', COALESCE(j.source_so_no, ''))
             FROM gd_async_job j
            WHERE j.tenant_id = '@TEN' AND j.command = 'CREATE_GD_FROM_FORM' AND j.is_deleted = 0
              AND j.job_status IN ('QUEUED', 'VALIDATING', 'CALCULATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'RECONCILING_GD', 'REQUIRES_REVIEW')
              AND EXISTS (SELECT 1 FROM JSON_TABLE(CONCAT('[', '@SOIDS', ']'), '$[*]' COLUMNS (sid BIGINT PATH '$')) s
                           WHERE j.source_so_ids LIKE CONCAT('%"', CAST(s.sid AS CHAR), '"%') COLLATE utf8mb4_general_ci)
            ORDER BY j.id
            LIMIT 1),
          NULL) AS so_job
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN goods_delivery g
    ON g.tenant_id = '@TEN'
   AND g.id = @GDID
   AND g.is_deleted = 0""", OPEN=open_jobs, TEN=TEN, GDID=GDID, SOIDS=N(G, "data.soIdsSql"))
    held = q("""SELECT CAST(x.id AS CHAR) AS job_id, (x.next_attempt_at IS NOT NULL AND x.next_attempt_at <= NOW(3)) AS expired
  FROM gd_async_job x
 WHERE x.tenant_id = '@TEN' AND x.is_deleted = 0 AND x.command = 'EDIT_GD' AND x.job_status = 'HELD' AND x.correlation_id = 'GD|@GDID'
 ORDER BY x.next_attempt_at, x.id
 LIMIT 1""", TEN=TEN, GDID=GDID)
    back = q("""SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       g.gd_status,
       DATE_FORMAT(j.queued_at, '%Y-%m-%d %H:%i:%s') AS queued_at,
       j.request_payload,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '@TEN' AND p.job_id = 'GDC|@GDID' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       CAST(t.id AS CHAR) AS pick_id,
       t.is_processing AS pick_processing,
       @VER AS pick_update_time
  FROM (SELECT 1 AS one) x
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@TEN'
   AND j.organization_id = '@ORGID'
   AND j.idempotency_key = '@KEY'
   AND j.is_deleted = 0
  LEFT JOIN goods_delivery g
    ON g.tenant_id = '@TEN'
   AND g.id = @GDID
   AND g.is_deleted = 0
  LEFT JOIN transfer_order t
    ON t.tenant_id = '@TEN'
   AND t.id = CAST(NULLIF('@PICKID', '') AS UNSIGNED)
   AND t.is_deleted = 0""", VER=dt3("t.update_time"), TEN=TEN, GDID=GDID, ORGID=N(E, "data.organizationId"), KEY=N(PO, "data.idemKey"), PICKID=N(GT, "data.pickingId"))

    OPS = "code_node_GSops"
    REF = N(G, "data.cascadeRef")
    ops_facts = q("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS job_id,
       j.organization_id,
       j.job_status,
       j.row_version,
       JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.cascade_ref')) AS cascade_ref,
       (SELECT COUNT(*) FROM gd_publish_step c
         WHERE c.tenant_id = '@TEN' AND c.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
           AND c.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci) AND c.is_deleted = 0) AS gate_taken
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@TEN'
   AND j.is_deleted = 0
   AND j.command = 'EDIT_GD'
   AND j.correlation_id = 'GD|@GDID'
   AND j.job_status = 'HELD'
   AND JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.cascade_ref')) = '@REF'""", TEN=TEN, GDID=GDID, REF=REF)
    ops_back = q("""SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       j.row_version,
       (j.next_attempt_at IS NOT NULL AND j.next_attempt_at <= NOW(3)) AS ended,
       (SELECT COUNT(*) FROM gd_publish_step p
         WHERE p.tenant_id = '@TEN' AND p.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci) AND p.step_name = 'RELEASE' AND p.is_deleted = 0) AS released
  FROM gd_async_job j
 WHERE j.tenant_id = '@TEN'
   AND j.id = @JOBID
   AND j.is_deleted = 0""", TEN=TEN, JOBID=N(OPS, "data.jobId"))
    ops_nodes = [
        K.sql("sql_node_GSops", "Ops: this GD's job HELD by this cascade_ref, its row_version, and whether the worker's claim gate for it is taken", ops_facts,
              ["db_now", "job_id", "organization_id", "job_status", "row_version", "cascade_ref", "gate_taken"]),
        cnode(OPS, "Ops: RELEASE -> READY_TO_COMMIT due now + a RELEASE step; CANCEL_HELD -> the hold ends now (the caller runs the worker); nothing held / the worker on it -> answer",
              SC + ["code/submit/ops.js"], tail("submitOps(%s, %s)" % (d(G), d("sql_node_GSops")), "submit ops", "{ route: res.route, job: res.jobId, message: res.message }"),
              ["route", "code", "message", "jobId", "jobStatus", "rowVersion", "claimRows", "jobRows", "stepRows", "needStep"], arrays=("claimRows", "jobRows", "stepRows")),
        K.if_(ids, "if_GSopsWrite", "IF there is something to write (a held job of this Sales Order save, the worker not on it)", is_(OPS, "route", "WRITE"), [
            step_add(ids, "add_node_GSopsClaim", "CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> (unique: a worker claiming the same job fails one of the two inserts)",
                     OPS, "claimRows"),
            job_update(ids, "update_node_GSopsJob", "Job: RELEASE -> READY_TO_COMMIT due now; CANCEL_HELD -> the hold ends now (row_version + 1)", OPS,
                       props=["id", "job_status", "progress_message", "next_attempt_at", "lease_owner", "lease_expires_at", "row_version"]),
            gate(ids, "cor_GSopsStep", "RELEASE step row?", OPS, "needStep", [
                step_add(ids, "add_node_GSopsStep", "RELEASE step row (GD_EDIT_COMMIT commits a held job only after it)", OPS, "stepRows")])]),
        K.sql("sql_node_GSopsBack", "Ops read-back: the job's status and row_version, whether its hold ended, its RELEASE row", ops_back,
              ["job_id", "job_status", "row_version", "ended", "released"]),
    ] + ret_block("GS", "ops", "RELEASE / CANCEL_HELD", SUB_RES, SC + ["code/submit/ops.js"],
                  tail("submitOpsBack(%s, %s, %s)" % (d(G), d(OPS), d("sql_node_GSopsBack")), "submit ops result", "{ route: res.route, code: res.code, job: res.job_id }"))

    def sres(tag, title, src, entry_ref="null", back_ref="null"):
        return ret_block("GS", tag, title, SUB_RES, SC + ["code/submit/result.js"],
                         tail("submitResult(%s, %s, %s, %s)" % (d(G), entry_ref, src, back_ref), "submit result", "{ route: res.route, code: res.code, message: res.message, job: res.job_id }"))

    param = lambda name: "(() => { const v = [{{workflowparams:%s}}][0]; if (typeof v !== \"string\") return v; try { return JSON.parse(v); } catch (e) { return null; } })()" % name
    E_FIELDS = ["route", "code", "message", "reason", "tenantId", "gdId", "gdNo", "organizationId", "plantId", "lineCount", "dbNow", "lockN", "storedStatus", "command", "jobId",
                "jobStatus", "progressPercent", "progressMessage", "errorCode", "errorMessage", "notes", "cascadeRef", "deltaMaterialIdsSql", "deltaSoLineIdsSql", "deltaSoLineIdsQuoted",
                "deltaSoIdsSql", "deltaAllocMaterialIdsSql", "deltaAllocLineIdsSql"]
    E_SMALL = pick(E, ["route", "code", "message", "reason", "gdNo", "lineCount", "command", "jobId", "jobStatus", "progressPercent", "progressMessage", "errorCode",
                       "errorMessage", "notes", "cascadeRef"])
    gate_pre = ("const guard = %s;\nconst entry = %s;\nconst S = Object.assign({ organizationId: entry.organizationId }, %s);\n"
                "const g = Object.assign({}, guard, { delta: guard.source === \"CASCADE\" ? %s : null });\nconst form = %s;") % (
        d(G), d(E), reads_obj("GS", S_READS), param("delta"), param("form"))
    nodes = [
        cnode(G, "Guard: operation, gd_id (digits), source (FORM: the form; CASCADE: SO_CASCADE's delta + cascade_ref), answers, session tenant + user", SC + ["code/prepare/alloc_ids.js", "code/submit/guard.js"],
              tail("submitGuard({ operation: [{{workflowparams:operation}}][0], gdId: [{{workflowparams:gd_id}}][0], source: [{{workflowparams:source}}][0], "
                   "answers: [{{workflowparams:answers}}][0], form: [{{workflowparams:form}}][0], delta: [{{workflowparams:delta}}][0], cascadeRef: [{{workflowparams:cascade_ref}}][0], "
                   "tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] })", "submit guard", "{ route: res.route, op: res.operation, gd: res.gdId, source: res.source, message: res.message }"),
              ["route", "code", "message", "operation", "gdId", "tenantId", "source", "cascadeRef", "uid", "answers", "idLists", "soIdsSql"], objects=("answers", "idLists")),
        K.if_(ids, "if_GSreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), sres("rej", "rejected input", pick(G, ["route", "code", "message"]))),
        K.if_(ids, "if_GSops", "IF RELEASE / CANCEL_HELD (a Sales Order save's own held job on this GD): claim-gated writes, then answer",
              "%s || %s" % (is_(G, "operation", "RELEASE"), is_(G, "operation", "CANCEL_HELD")), ops_nodes),
        K.sql("sql_node_GSheld", "A cascade's EDIT_GD job HELD on this GD whose hold has ended (next_attempt_at reached)", held, ["job_id", "expired"]),
        cnode("code_node_GSheld", "Held: an ended hold -> kick GD_EDIT_WORKER with it first (no Quartz: nothing else would cancel it)", SC + ["code/submit/held.js"],
              tail("submitHeld(%s, %s)" % (d(G), d("sql_node_GSheld")), "submit held", "res"), ["needKick", "jobId"]),
        gate(ids, "cor_GSkick", "An ended hold to cancel first?", "code_node_GSheld", "needKick", [
            call(ids, "workflow_node_GSkick", "GD_EDIT_WORKER for that job (its EXPIRE path: CANCELLED, the GD and our Picking unlocked; claim-gated)",
                 ("GD_EDIT_WORKER", IDS.get("GD_EDIT_WORKER", "0")), [("job_id", N("code_node_GSheld", "data.jobId"))])]),
        K.sql("sql_node_GSfacts", "Facts: the GD, its line count, its latest lock and that lock's job, the open jobs on it, its Pickings (lock age) and their open confirms, DB clock",
              facts, ["db_now", "gd_id", "delivery_no", "gd_status", "organization_id", "plant_id", "line_count", "last_lock", "lock_job", "open_jobs", "pickings", "open_pickings", "so_job"]),
        plus_field(cnode(E, "Entry: STATUS (the latest lock's job); SUBMIT goes on for a Created or Draft GD with nothing open on it (BUSY / STOP otherwise)", SC + ["code/submit/entry.js"],
              tail("submitEntry(%s, %s)" % (d(G), d("sql_node_GSfacts")), "submit entry", "{ route: res.route, code: res.code, message: res.message, lockN: res.lockN }"),
              E_FIELDS, objects=("lineCount", "lockN", "progressPercent", "notes")), "stalesub", "staleLocks", "array"),
        K.if_(ids, "if_GSanswer", "IF answered here (STATUS / BUSY / STOP): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"), sres("ans", "entry", E_SMALL, E_SMALL)),
        K.parallel("condition_all_GSread", "PREPARE's reads to the gates, in parallel (no row limits): the GD as stored AND the edit", sql_reads("GS", E, S_READS)),
        cnode(GT, "Gate: the edit as a delta, what the background save does not take (classic; refused above 500 lines), GOODS_DELIVERY's gates in its order (lifted)", GATE_MODS,
              tail("submitGate(g, entry, S, form, GE_KINDS)", "submit gate", "{ route: res.route, code: res.code, message: res.message, needCL: res.needCL, picking: res.pickingId }", pre=gate_pre),
              ["route", "code", "message", "reason", "needCL", "clAutoOverride", "customer", "total", "qtyStop", "delta", "pickingId", "pickingReversalNote"],
              objects=("customer", "total", "delta")),
        K.if_(ids, "if_GSgateEnd", "IF the gate answered (NOT_ELIGIBLE / a GOODS_DELIVERY stop): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"),
              sres("gate", "gate", pick(GT, ["route", "code", "message", "reason"]), E_SMALL)),
        K.if_(ids, "if_GScl", "IF the credit limit is to be checked (GOODS_DELIVERY's Need CL?)", is_(GT, "needCL", "required"), [
            call(ids, "workflow_node_GScl", "CREDIT_LIMIT_CHECK (as GOODS_DELIVERY's workflow_node_sUYtl9dZ calls it)", CREDIT_LIMIT, [
                ("customer_id", N(GT, "data.customer")), ("total", N(GT, "data.total")), ("document_type", "Goods Delivery", "value")])]),
        cnode(PO, "Post: 402 / 403, the quantity 400s; else the lock, job, Processing and Picking-lock rows", SC + ["code/submit/post.js"],
              tail("submitPost(%s, %s, %s, %s)" % (d(G), d(E), d(GT), d("workflow_node_GScl")), "submit post", "{ route: res.route, code: res.code, message: res.message }"),
              ["route", "code", "message", "idemKey", "notes", "lockRows", "jobRows", "gdRows", "pickLockRows", "needPickLock"], arrays=("lockRows", "jobRows", "gdRows", "pickLockRows"),
              objects=("notes",)),
        K.if_(ids, "if_GSpostEnd", "IF a gate answered: answer, write nothing", "'%s' != 'QUEUE'" % N(PO, "data.route"), sres("post", "post", pick(PO, ["route", "code", "message"]), E_SMALL)),
        K.add(ids, "add_node_GSlock", "LOCK: gd_publish_step GDC|<gd> / LOCK|<n> (unique tenant / job / step: a concurrent submit fails its run)", STEP,
              [(p, N(PO, "data.lockRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "result_ref"]], ORG),
        K.add(ids, "add_node_GSjob", "Job insert: EDIT_GD QUEUED (idempotency_key GDE|<gd>|<n>, correlation_id GD|<gd>), due in 2 minutes until the GD reads back Processing", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in ["organization_id", "plant_id", "command", "idempotency_key", "job_status", "progress_percent", "progress_message",
                                                      "attempt_count", "row_version", "cancel_requested", "next_attempt_at", "request_payload", "causation_id", "correlation_id",
                                                      "line_count", "queued_at"]], ORG),
        rows_update(ids, "update_node_GSgd", "Goods Delivery Processing (the lock every writer honours)", GD, PO, "gdRows", ["gd_status"], {"gd_status": "GD Status"}),
        gate(ids, "cor_GSpick", "Picking to lock?", PO, "needPickLock", [
            rows_update(ids, "update_node_GSpick", "Picking is_processing = 1 (its version is read back next)", PICKT, PO, "pickLockRows", ["is_processing"])]),
        K.sql("sql_node_GSback", "Read-back: the job, the GD's status, its latest lock, the Picking's lock and version", back,
              ["job_id", "job_status", "gd_status", "queued_at", "request_payload", "lock_ref", "pick_id", "pick_processing", "pick_update_time"]),
        cnode("code_node_GSdue", "Due: the GD is Processing under this job's lock -> the job due now, the Picking's version in its request", SC + ["code/submit/due.js"],
              tail("submitDue(%s, %s, %s)" % (pick(E, ["gdId"]), pick(PO, ["idemKey"]), d("sql_node_GSback")), "submit due", "{ due: res.needDue }"),
              ["dueRows", "needDue"], arrays=("dueRows",)),
        gate(ids, "cor_GSdue", "Job to make due?", "code_node_GSdue", "needDue", [
            rows_update(ids, "update_node_GSdue", "Job due now (+ the Picking's version as locked)", JOB, "code_node_GSdue", "dueRows", ["next_attempt_at", "request_payload"])]),
    ] + sres("done", "queued", pick(PO, ["route", "code", "message", "idemKey", "notes"]), E_SMALL, d("sql_node_GSback"))
    return K.workflow([("operation", "string", "SUBMIT (default), STATUS, or (a Sales Order save) RELEASE / CANCEL_HELD of its held job"), ("gd_id", "string", "goods_delivery.id (digits)"),
                       ("source", "string", "FORM (default) | CASCADE"),
                       ("answers", "any", "{ needCL, continueZero, confirmPickReversal } as GOODS_DELIVERY's prompts take them"),
                       ("form", "any", "FORM: the form's data (allData); CASCADE: its payload (diffed as the form's)"), ("delta", "any", "CASCADE: SO_CASCADE's edit as a delta (geDelta's shape)"),
                       ("cascade_ref", "string", "CASCADE / RELEASE / CANCEL_HELD: the Sales Order save that holds the job (released / cancelled by it)")], SUB_RES, nodes)


BUILDERS = [("GD_EDIT_PREPARE", build_prepare), ("GD_EDIT_COMMIT", build_commit), ("GD_EDIT_WORKER", build_worker), ("GD_EDIT_SUBMIT", build_submit)]

SQL_WIDTH = 160
SQL_BREAK = ",\n\t\t"


def wrap_sql(text):
    """a long SQL line breaks after ", " outside quotes (the platform's addDraft failed on a 5,681-char SQL line, 2026-10-14)"""
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
        # each workflow's field keys depend on its own content only: a change to one never re-keys the others
        K._rng.seed("gde:" + name)
        K._taken.clear()
        doc = wrap_doc_sql(fn())
        K.check_ids(doc)
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        path = os.path.join(OUT, name + ".json")
        print(f"{name}: {len(text)} chars, {len(K.check_ids(doc))} nodes" + (f" -> {path}" if WRITE else " (dry; --write to save)"))
        if WRITE:
            os.makedirs(OUT, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text + "\n")
