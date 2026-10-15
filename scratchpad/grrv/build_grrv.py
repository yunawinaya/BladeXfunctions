"""Builds the GR Revert Completed V2 workflows (GR_REVERT_SUBMIT / _WORKER / _PREPARE / _COMMIT) as FlowGram JSON into the
repo's Goods Receiving/RevertV2/. Same machinery as GR Completion V2 (scratchpad/grv2/build_grv2.py, whose generic helpers
this imports); contract: GRRV_DESIGN.md + the plan core (prepare/sql.py, code/prepare/, code/outputs.json). Published with
.dbtools/wf_upload.mjs.

usage: python3 build_grrv.py [--write] [NAME ...]
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "grv2"))
import wfkit as K  # noqa: E402
import build_grv2 as G  # noqa: E402

N, gate, call, job_update, step_add, sub, is_ = G.N, G.gate, G.call, G.job_update, G.step_add, G.sub, G.is_
JOB, STEP, ENGINE, JOB_PROPS, RES_FIELDS = G.JOB, G.STEP, G.ENGINE, G.JOB_PROPS, G.RES_FIELDS
OUT = G.R + "Goods Receiving/RevertV2/"
GR, PO, POL, OO, TO, IT, BATCH = G.GR, G.PO, G.POL, G.OO, G.TO, G.IT, G.BATCH
QI = "Basic Inspection Lot:Table:1930547663980482561"
FIFO = "FIFO Costing History:Table:1902947165008400386"
WA = "Weighted Average Costing History:Table:1902948453171433474"
IDS_FILE = os.path.join(HERE, "ids.json")
RV_IDS = json.load(open(IDS_FILE)) if os.path.exists(IDS_FILE) else {}
OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GR", "COMMITTING_REVERT", "REQUIRES_REVIEW"]
GR_HEAD_LABELS = dict(G.GR_LABELS, previous_status="Previous Status")


def raw(path):
    with open(os.path.join(HERE, path), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def code(path):
    return raw(os.path.join("code", path))


def plan_core():
    """the plan core's SQL module (by path) and its node declarations; None until both exist"""
    sp, op = os.path.join(HERE, "prepare", "sql.py"), os.path.join(HERE, "code", "outputs.json")
    if not (os.path.exists(sp) and os.path.exists(op)):
        return None
    spec = importlib.util.spec_from_file_location("grrv_prepare_sql", sp)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, json.load(open(op))


def decl(out, node):
    d = out[node]
    return d["fields"], tuple(d.get("arrays", ())), tuple(d.get("objects", ()))


def body(out, node):
    """a plan-core node body: its files (outputs.json "files") joined in order; no platform token may be left in the lifted code"""
    files = out["files"][node]
    for f in files:
        assert os.path.exists(os.path.join(HERE, f)), f
    lifted = [raw(f) for f in files if f.startswith("lift/lifted")]
    assert all("{{" not in x for x in lifted), "a lifted body still holds a platform token"
    return "\n".join(raw(f) for f in files)


# =============================================================================================== GR_REVERT_COMMIT
CG, CE = "code_node_VCguard", "code_node_VCentry"


def ccode(name):
    return "\n".join([code("commit/_common.js"), code("commit/_cmp.js"), code("commit/" + name)])


def cres(tag, src, path):
    body = G.RESULT_JS + code("commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [K.code("code_node_VC%sres" % tag, "Result (%s)" % path, body, RES_FIELDS),
            K.ret("return_node_VC%s" % tag, "Return (%s)" % path, [(f, N("code_node_VC%sres" % tag, "data." + f)) for f in RES_FIELDS])]


def end_a(ids, tag, src, title):
    """phase A (no stock moved yet): PO locks freed, wait marker, the receipt back, then the job row"""
    nodes = [
        gate(ids, "cor_VC%sfree" % tag, "PO locks to free?", src, "needFree", [step_add(ids, "add_node_VC%sfree" % tag, "PO locks: FREE|<n> (this job's holds)", src, "freeRows")]),
        gate(ids, "cor_VC%sstep" % tag, "Marker row to write?", src, "needStep", [step_add(ids, "add_node_VC%sstep" % tag, "Marker (R0_WAIT|<n>)", src, "stepRows")]),
        gate(ids, "cor_VC%sunlock" % tag, "Receipt lock to release?", src, "needUnlock", [
            G.gr_unlock(ids, "update_node_VC%sunlock" % tag, "Goods Receiving back to its status before the submit (no stock was moved)", src)]),
        gate(ids, "cor_VC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
            job_update(ids, "update_node_VC%sjob" % tag, "Job: wait / retry with backoff / FAILED (lease released)", src, "jobRows")]),
    ]
    return K.if_(ids, "if_VC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def end_b(ids, tag, src, title):
    """phase B (the stock moved): retry with backoff or REQUIRES_REVIEW - never back"""
    nodes = [gate(ids, "cor_VC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
        job_update(ids, "update_node_VC%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_VC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def step_done(ids, tag, src, step):
    return gate(ids, "cor_VC%sdone" % tag, "%s DONE to record?" % step, src, "needStep", [step_add(ids, "add_node_VC%sdone" % tag, "%s DONE (unique job / step)" % step, src, "stepRows")])


def slice_loop(ids, tag, src, field, title, table, props, labels=None):
    loop_id = "loop_VC%s" % tag
    sl = "code_node_VC%sslice" % tag
    body = code("commit/slice.js").replace("__LOOP__", loop_id)
    write = K.update(ids, "update_node_VC%swrite" % tag, title + " (<= 250 per call)", table, ("id", "in", N(sl, "data.rows.id")),
                     [(p, N(sl, "data.rows." + p)) for p in ["id"] + props], labels)
    return K.loop(ids, loop_id, title, N(src, "data." + field), [
        K.code(sl, "This slice (the loop item: <= 250 rows)", body, ["n", "rows"], arrays=("rows",), objects=("n",)), write])


def commit_sql():
    T, JOBID, PFX = N(CG, "data.tenantId"), N(CG, "data.jobId"), N(CE, "data.partPrefix")
    TOK = dict(T=T, JOB=JOBID)
    dt = lambda c: "DATE_FORMAT(%s, '%%Y-%%m-%%d %%H:%%i:%%s')" % c
    S = {}
    S["job"] = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.progress_percent, j.progress_message, j.attempt_count,
       @NEXT AS next_attempt_at, j.lease_owner, @LEASE AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live, (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted,
       IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.previousStatus')), NULL) AS prev_status
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB""", NEXT=dt("j.next_attempt_at"), LEASE=dt("j.lease_expires_at"), **TOK)
    S["steps"] = sub("SELECT st.step_name, st.step_status FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' AND st.step_name LIKE 'R%' "
                     "AND st.is_deleted = 0", **TOK)
    S["payload"] = sub("SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["gr"] = sub("""SELECT g.gr_status, CAST(g.gr_v2_job_id AS CHAR) AS gr_v2_job_id,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GRC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN goods_receiving g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.id = @JOB AND j.correlation_id REGEXP '^GR\\\\|[0-9]{1,20}$'""", **TOK)
    S["polock"] = sub("""SELECT p.job_id, p.step_name, p.result_ref, hj.job_status AS holder_status
  FROM gd_async_job j
  JOIN JSON_TABLE(IF(JSON_VALID(j.prepared_payload), j.prepared_payload, '{}'), '$.po_ids[*]' COLUMNS (po VARCHAR(20) PATH '$')) t
  JOIN gd_publish_step p
    ON p.tenant_id = j.tenant_id AND p.job_id = (CONCAT('GRPO|', t.po) COLLATE utf8mb4_general_ci) AND p.is_deleted = 0
  LEFT JOIN gd_async_job hj
    ON hj.tenant_id = p.tenant_id AND p.step_name LIKE 'HOLD|%' AND p.result_ref REGEXP '^[0-9]{1,20}$' AND hj.id = CAST(p.result_ref AS UNSIGNED)
 WHERE j.tenant_id = '@T' AND j.id = @JOB""", **TOK)
    S["own"] = sub("SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["part"] = lambda name: sub("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                                 "AND st.step_name LIKE CONCAT('@PFX', '@NAME|%') AND st.is_deleted = 0 ORDER BY st.step_name", PFX=PFX, NAME=name, **TOK)
    S["intent"] = lambda name: sub("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                                   "AND st.step_name LIKE '@NAME|I|%' AND st.is_deleted = 0 ORDER BY st.step_name", NAME=name, **TOK)
    R0 = "code_node_VCr0in"
    # sql_node_grRvLater (GR_REVERT_COMPLETED dev v8), the tenant added
    S["later"] = sub("""SELECT CAST(m.item_id AS CHAR) AS item_id,
       CAST(m.batch_number_id AS CHAR) AS batch_id,
       CAST(MAX(m.id) AS CHAR) AS max_id,
       SUBSTRING_INDEX(GROUP_CONCAT(CONCAT(m.transaction_type, ' ', COALESCE(m.trx_no, '')) ORDER BY m.id DESC SEPARATOR '|'), '|', 1) AS latest
  FROM inventory_movement m
 WHERE m.tenant_id = '@T'
   AND m.id > CAST('@MIN' AS UNSIGNED)
   AND m.organization_id = '@ORG'
   AND m.plant_id = CAST('@PLANT' AS UNSIGNED)
   AND m.item_id IN (@ITEMS)
   AND NOT (m.transaction_type IN ('GRN', 'GRN-R') AND m.trx_no = '@GRNO')
   AND NOT (m.transaction_type IN ('HU', 'HU-R') AND COALESCE(m.parent_trx_no, '') = '@GRNO')
   AND NOT (m.transaction_type = 'TO - PA' AND COALESCE(m.parent_trx_no, '') = '@GRNO')
   AND m.is_deleted = 0
 GROUP BY m.item_id, m.batch_number_id""", MIN=N(R0, "data.minLiveIdSql"), ORG=N(CE, "data.organizationId"), PLANT=N(R0, "data.plantIdSql"),
                     ITEMS=N(R0, "data.itemIdsCsv"), GRNO=N(CE, "data.grNoSql"), T=T)
    S["fifo"] = lambda src: sub("""SELECT JSON_OBJECT('id', CAST(f.id AS CHAR), 'material_id', CAST(f.material_id AS CHAR), 'fifo_initial_quantity', f.fifo_initial_quantity,
       'fifo_available_quantity', f.fifo_available_quantity, 'is_deleted', f.is_deleted) AS j
  FROM fifo_costing_history f
 WHERE f.tenant_id = '@T' AND f.id IN (@IDS)""", IDS=N(src, "data.fifoIdsSql"), T=T)
    S["wa"] = lambda src: sub("""SELECT JSON_OBJECT('id', CAST(w.id AS CHAR), 'material_id', CAST(w.material_id AS CHAR), 'batch_id', CAST(w.batch_id AS CHAR),
       'wa_quantity', w.wa_quantity, 'wa_cost_price', w.wa_cost_price, 'is_deleted', w.is_deleted) AS j
  FROM wa_costing_method w
 WHERE w.tenant_id = '@T' AND w.id IN (@IDS)""", IDS=N(src, "data.waIdsSql"), T=T)
    R3 = "code_node_VCr3in"
    S["to"] = sub("""SELECT JSON_OBJECT('id', CAST(t.id AS CHAR), 'to_id', t.to_id, 'to_status', t.to_status, 'is_processing', t.is_processing, 'is_deleted', t.is_deleted) AS j
  FROM transfer_order_putaway t
 WHERE t.tenant_id = '@T' AND t.id IN (@IDS)""", IDS=N(R3, "data.toIdsSql"), T=T)
    S["it"] = sub("""SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'status', i.status, 'open_qty', i.open_qty, 'is_deleted', i.is_deleted) AS j
  FROM in_transit_detail i
 WHERE i.tenant_id = '@T' AND i.id IN (@IDS)""", IDS=N(R3, "data.itIdsSql"), T=T)
    S["qi"] = sub("""SELECT JSON_OBJECT('id', CAST(q.id AS CHAR), 'is_deleted', q.is_deleted) AS j
  FROM basic_inspection_lot q
 WHERE q.tenant_id = '@T' AND q.id IN (@IDS)""", IDS=N(R3, "data.qiIdsSql"), T=T)
    S["batch"] = sub("""SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'is_deleted', b.is_deleted) AS j
  FROM batch b
 WHERE b.tenant_id = '@T' AND b.id IN (@IDS)""", IDS=N(R3, "data.batchIdsSql"), T=T)
    POIDS, GRID = N(CE, "data.poIdsSql"), N(CE, "data.grId")
    S["pol"] = sub("""SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'purchase_order_id', CAST(l.purchase_order_id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'item_bundle_id', CAST(l.item_bundle_id AS CHAR), 'item_id', l.item_id, 'quantity', l.quantity, 'received_qty', l.received_qty,
       'created_received_qty', l.created_received_qty, 'outstanding_quantity', l.outstanding_quantity, 'line_status', l.line_status) AS j
  FROM purchase_order_2ukyuanr_sub l
 WHERE l.tenant_id = '@T' AND l.purchase_order_id IN (@POIDS) AND l.is_deleted = 0
 ORDER BY l.id""", POIDS=POIDS, T=T)
    S["poh"] = sub("""SELECT JSON_OBJECT('id', CAST(p.id AS CHAR), 'po_status', p.po_status, 'gr_status', p.gr_status, 'partially_received', p.partially_received,
       'fully_received', p.fully_received) AS j
  FROM purchase_order p
 WHERE p.tenant_id = '@T' AND p.id IN (@POIDS) AND p.is_deleted = 0
 ORDER BY p.id""", POIDS=POIDS, T=T)
    S["oo"] = sub("""SELECT JSON_OBJECT('id', CAST(o.id AS CHAR), 'po_line_id', CAST(o.po_line_id AS CHAR), 'open_qty', o.open_qty, 'received_qty', o.received_qty,
       'scheduled_qty', o.scheduled_qty) AS j
  FROM on_order_purchase_order o
 WHERE o.tenant_id = '@T' AND o.is_deleted = 0
   AND o.po_line_id IN (SELECT l.id FROM purchase_order_2ukyuanr_sub l WHERE l.tenant_id = '@T' AND l.purchase_order_id IN (@POIDS))
 ORDER BY o.id""", POIDS=POIDS, T=T)
    S["grnow"] = sub("SELECT g.gr_status FROM goods_receiving g WHERE g.tenant_id = '@T' AND g.id = @GRID AND g.is_deleted = 0", GRID=GRID, T=T)
    return S


def build_commit():
    ids = K.Ids(1799100000000)
    S = commit_sql()
    sq = lambda nid, title, text, cols=("j",): K.sql(nid, title, text, list(cols))
    part = lambda nid, title, name: K.sql(nid, title, S["part"](name), ["step_name", "result_ref"])
    intent = lambda nid, title, name: K.sql(nid, title, S["intent"](name), ["step_name", "result_ref"])
    br = lambda tag, items: K.parallel("condition_all_VC%s" % tag, "Reads in parallel", [("cai_VC%s%d" % (tag, i), t, [n]) for i, (t, n) in enumerate(items)])
    entry_fields = ["route", "phase", "dbNow", "jobId", "organizationId", "grId", "grNo", "plantId", "prevStatus", "idempotencyKey", "jobStatus", "rowVersion", "attempts",
                    "leaseUntil", "unlockOk", "partPrefix", "manifest", "poLocks", "poIdsSql", "grNoSql", "jitter", "r0Waits", "jobRows", "needJobUpd",
                    "unlockRows", "needUnlock", "freeRows", "needFree", "needR0", "needR1", "needR2", "needR3", "needR4", "needR5", "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "freeRows", "needFree", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows", "freeRows")
    plan_end = ["jobRows", "needJobUpd", "result_code", "result_message", "job_status"]
    rej_body = G.RESULT_JS + code("commit/result.js") + "\nreturn commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");" % (
        N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    R0I, R0, R1I, R1 = "code_node_VCr0in", "code_node_VCr0", "code_node_VCr1in", "code_node_VCr1"
    R2I, R2P, R2C, R3I, R3P, R3C = "code_node_VCr2in", "code_node_VCr2plan", "code_node_VCr2check", "code_node_VCr3in", "code_node_VCr3plan", "code_node_VCr3check"
    R4P, R4C, R5P, R5C, FIN = "code_node_VCr4plan", "code_node_VCr4check", "code_node_VCr5plan", "code_node_VCr5check", "code_node_VCfinish"
    nodes = [
        K.code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_VCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            K.code("code_node_VCrejres", "Result (REJECTED_INPUT)", rej_body, RES_FIELDS),
            K.ret("return_node_VCrej", "Return (rejected input)", [(f, N("code_node_VCrejres", "data." + f)) for f in RES_FIELDS])]),
        K.parallel("condition_all_VCfacts", "Facts in parallel: the job, its step rows, its manifest, the receipt's lock, the PO locks", [
            ("cai_VCjob", "Job", [K.sql("sql_node_VCjob", "The job (+ DB clock, lease flag, lease_until, due, previous status)", S["job"],
                ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                 "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted", "prev_status"])]),
            ("cai_VCsteps", "Steps", [K.sql("sql_node_VCsteps", "This job's R step rows", S["steps"], ["step_name", "step_status"])]),
            ("cai_VCpayload", "Manifest", [K.sql("sql_node_VCpayload", "The prepared manifest", S["payload"], ["prepared_payload"])]),
            ("cai_VCgr", "GR + lock", [K.sql("sql_node_VCgr", "The receipt's status, its V2 job and its latest lock", S["gr"], ["gr_status", "gr_v2_job_id", "lock_ref"])]),
            ("cai_VCpolock", "PO locks", [K.sql("sql_node_VCpolock", "The purchase-order lock rows of its POs (+ the holders' job status)", S["polock"], ["job_id", "step_name", "result_ref", "holder_status"])]),
        ]),
        K.code(CE, "Entry: what this run does (phase A: R0 R1, SPLIT; phase B: R2 R3 R4 R5, COMPLETED), the lease claim", ccode("entry.js"),
               entry_fields, arrays=("jobRows", "unlockRows", "freeRows"), objects=("rowVersion", "attempts", "manifest", "poLocks", "jitter", "r0Waits")),
        K.if_(ids, "if_VCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_VCentryend", "IF the manifest is unusable or the receipt lost its lock: FAILED (+ back) or REQUIRES_REVIEW", "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
            gate(ids, "cor_VCeffree", "PO locks to free?", CE, "needFree", [step_add(ids, "add_node_VCeffree", "PO locks: FREE|<n>", CE, "freeRows")]),
            gate(ids, "cor_VCefunlock", "Receipt lock to release?", CE, "needUnlock", [G.gr_unlock(ids, "update_node_VCefunlock", "Goods Receiving back to its status before the submit", CE)]),
            gate(ids, "cor_VCefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_VCefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows")]),
        ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_VCclaim", "Lease claim: job COMMITTING_REVERT, lease_owner = this run, lease_expires_at = now + 10 min", CE, "jobRows"),
        K.sql("sql_node_VCown", "Read-back: the job after the lease claim", S["own"], ["id", "job_status", "lease_owner", "row_version"]),
        K.code("code_node_VCown", "Own: COMMITTING_REVERT under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_VClost", "IF another run took the job: stop", is_("code_node_VCown", "route", "LOST"), cres("lost", "code_node_VCown", "LOST")),
        # ---------------------------------------------------------------- R0
        K.if_(ids, "if_VCr0", "IF R0 REVALIDATE is due", is_(CE, "needR0", "YES"), [
            br("r0read", [("CHECK part", part("sql_node_VCr0check", "R0: the CHECK part", "CHECK")), ("COST part", part("sql_node_VCr0cost", "R0: the COST part", "COST"))]),
            K.code(R0I, "R0 input: the keys of the fresh reads (digits only) and what they must show", ccode("r0_in.js"),
                   ["ok", "why", "minLiveIdSql", "itemIdsCsv", "plantIdSql", "fifoIdsSql", "waIdsSql", "anchors", "names", "fifo", "waDelete"],
                   arrays=("fifo", "waDelete"), objects=("anchors", "names")),
            br("r0fresh", [("Later movements", sq("sql_node_VCr0later", "R0: movements on the receipt's items since its stock came in (sql_node_grRvLater)", S["later"],
                                                   ["item_id", "batch_id", "max_id", "latest"])),
                           ("FIFO", sq("sql_node_VCr0fifo", "R0: the receipt's FIFO layers now", S["fifo"](R0I))),
                           ("WA", sq("sql_node_VCr0wa", "R0: the receipt's weighted-average batch rows now", S["wa"](R0I)))]),
            K.code(R0, "R0 REVALIDATE: nothing touched the stock since PREPARE (grRvBuild's rules on fresh reads); PO locks free -> HOLD; busy -> free mine, wait", ccode("r0.js"),
                   chk + ["lockRows", "needLock"], arrays=chk_arr + ("lockRows",)),
            end_a(ids, "r0", R0, "IF the receipt cannot be reverted now (wait / FAILED)"),
            gate(ids, "cor_VCr0hold", "PO locks to take?", R0, "needLock", [step_add(ids, "add_node_VCr0hold", "PO locks: GRPO|<po> / HOLD|<n+1> (unique: a concurrent taker fails its run)", R0, "lockRows")]),
            step_done(ids, "r0", R0, "R0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- R1
        K.if_(ids, "if_VCr1", "IF R1 INVENTORY is due (phase A ends here: SPLIT)", is_(CE, "needR1", "YES"), [
            part("sql_node_VCr1part", "R1: the ENGINE part", "ENGINE"),
            K.code(R1I, "R1: the operation key and the GRN-R movements (none -> no call)", ccode("r1_in.js"), ["ok", "why", "call", "operationKey", "movements"], arrays=("movements",)),
            K.if_(ids, "if_VCr1call", "IF there is stock to take back: the engine call", is_(R1I, "call", "YES"), [
                call(ids, "workflow_node_VCr1", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; GRV|<job> replays on a re-run)", ENGINE, [
                    ("operation_key", N(R1I, "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")),
                    ("movements", N(R1I, "data.movements"))])]),
            K.code(R1, "R1 check: 200 -> DONE + SPLIT; 409 -> wait; 400 -> FAILED + back; else review", ccode("r1.js"), chk + ["splitRows", "needSplit"], arrays=chk_arr + ("splitRows",)),
            end_a(ids, "r1", R1, "IF the stock did not move"),
            step_done(ids, "r1", R1, "R1_INVENTORY"),
            gate(ids, "cor_VCsplit", "SPLIT hand-over to write?", R1, "needSplit", [job_update(ids, "update_node_VCsplit", "Job: SPLIT| hand-over lease (the next run does phase B)", R1, "splitRows")]),
        ] + cres("split", R1, "SPLIT")),
        # ---------------------------------------------------------------- R2
        K.if_(ids, "if_VCr2", "IF R2 COSTING is due", is_(CE, "needR2", "YES"), [
            br("r2read", [("COST part", part("sql_node_VCr2part", "R2: the COST part", "COST")), ("Intent", intent("sql_node_VCr2intent", "R2: an intent of an earlier run", "R2"))]),
            K.code(R2I, "R2 input: the ids of the costing rows to read fresh", ccode("r2_in.js"), ["ok", "why", "fifoIdsSql", "waIdsSql", "fifo", "waDelete", "waRestate"],
                   arrays=("fifo", "waDelete", "waRestate")),
            br("r2fresh", [("FIFO", sq("sql_node_VCr2fifo", "R2: the receipt's FIFO layers now", S["fifo"](R2I))),
                           ("WA", sq("sql_node_VCr2wa", "R2: the weighted-average rows now", S["wa"](R2I)))]),
            K.code(R2P, "R2 plan: layers / batch rows soft-deleted as read; weighted averages restated on the fresh rows -> intent; write what is at before", ccode("r2_plan.js"),
                   ["route", "needIntent", "intentRows", "fifoSlices", "fifoCount", "waDelSlices", "waDelCount", "waSetSlices", "waSetCount"] + plan_end,
                   arrays=("intentRows", "fifoSlices", "waDelSlices", "waSetSlices", "jobRows"), objects=("fifoCount", "waDelCount", "waSetCount")),
            end_b(ids, "r2pl", R2P, "IF the costing cannot be restored"),
            gate(ids, "cor_VCr2intent", "Intent to record?", R2P, "needIntent", [step_add(ids, "add_node_VCr2intent", "R2 INTENT: R2|I|<nnn> (each weighted average's before + after)", R2P, "intentRows")]),
            slice_loop(ids, "r2f", R2P, "fifoSlices", "R2 WRITE: FIFO layers removed (update_node_grRvFifoDel's write)", FIFO, ["is_deleted"]),
            slice_loop(ids, "r2d", R2P, "waDelSlices", "R2 WRITE: weighted-average batch rows removed (update_node_grRvWaDel's write)", WA, ["is_deleted"]),
            slice_loop(ids, "r2s", R2P, "waSetSlices", "R2 WRITE: weighted averages restated (update_node_grRvWaUpd's columns)", WA, ["wa_quantity", "wa_cost_price"]),
            br("r2back", [("Intent", intent("sql_node_VCr2intentB", "R2 read-back: the intent", "R2")),
                          ("FIFO", sq("sql_node_VCr2fifoB", "R2 read-back: the FIFO layers", S["fifo"](R2I))),
                          ("WA", sq("sql_node_VCr2waB", "R2 read-back: the weighted-average rows", S["wa"](R2I)))]),
            K.code(R2C, "R2 check: every layer / batch row removed, every weighted average at its after-values -> DONE", ccode("r2_check.js"), chk, arrays=chk_arr),
            end_b(ids, "r2", R2C, "IF R2 did not complete"),
            step_done(ids, "r2", R2C, "R2_COSTING"),
        ]),
        # ---------------------------------------------------------------- R3
        K.if_(ids, "if_VCr3", "IF R3 DOCUMENTS is due", is_(CE, "needR3", "YES"), [
            part("sql_node_VCr3part", "R3: the DOCS part", "DOCS"),
            K.code(R3I, "R3 input: the ids of the documents to read fresh", ccode("r3_in.js"), ["ok", "why", "toIdsSql", "itIdsSql", "qiIdsSql", "batchIdsSql", "docs"], objects=("docs",)),
            br("r3fresh", [("Putaway", sq("sql_node_VCr3to", "R3: the receipt's putaways now", S["to"])), ("In transit", sq("sql_node_VCr3it", "R3: its in-transit rows now", S["it"])),
                           ("QI", sq("sql_node_VCr3qi", "R3: its inspection lots now", S["qi"])), ("Batches", sq("sql_node_VCr3batch", "R3: its split batches now", S["batch"]))]),
            K.code(R3P, "R3 plan: putaway / inspection lots / split batches is_deleted 1, in-transit rows Cancelled (absolute; what is not yet so)", ccode("r3_plan.js"),
                   ["route", "toSlices", "toCount", "itSlices", "itCount", "qiSlices", "qiCount", "batchSlices", "batchCount"] + plan_end,
                   arrays=("toSlices", "itSlices", "qiSlices", "batchSlices", "jobRows"), objects=("toCount", "itCount", "qiCount", "batchCount")),
            end_b(ids, "r3pl", R3P, "IF the documents cannot be removed"),
            slice_loop(ids, "r3t", R3P, "toSlices", "R3 WRITE: putaways removed (update_node_grRvPutawayDel's write)", TO, ["is_deleted"]),
            slice_loop(ids, "r3i", R3P, "itSlices", "R3 WRITE: in-transit rows cancelled (update_node_grRvTransit's columns)", IT, ["status", "open_qty"]),
            slice_loop(ids, "r3q", R3P, "qiSlices", "R3 WRITE: inspection lots removed (update_node_grRvQiDel's write)", QI, ["is_deleted"]),
            slice_loop(ids, "r3b", R3P, "batchSlices", "R3 WRITE: split batches removed (update_node_grRvBatchDel's write)", BATCH, ["is_deleted"]),
            br("r3back", [("Putaway", sq("sql_node_VCr3toB", "R3 read-back: putaways", S["to"])), ("In transit", sq("sql_node_VCr3itB", "R3 read-back: in-transit rows", S["it"])),
                          ("QI", sq("sql_node_VCr3qiB", "R3 read-back: inspection lots", S["qi"])), ("Batches", sq("sql_node_VCr3batchB", "R3 read-back: split batches", S["batch"]))]),
            K.code(R3C, "R3 check: every document removed / cancelled -> DONE", ccode("r3_check.js"), chk, arrays=chk_arr),
            end_b(ids, "r3", R3C, "IF R3 did not complete"),
            step_done(ids, "r3", R3C, "R3_DOCS"),
        ]),
        # ---------------------------------------------------------------- R4
        K.if_(ids, "if_VCr4", "IF R4 PURCHASE ORDERS is due", is_(CE, "needR4", "YES"), [
            br("r4read", [("PO part", part("sql_node_VCr4part", "R4: the PO part", "PO")), ("Intent", intent("sql_node_VCr4intent", "R4: an intent of an earlier run", "R4")),
                          ("PO lines", sq("sql_node_VCr4pol", "R4: the lines of its purchase orders now", S["pol"])),
                          ("On order", sq("sql_node_VCr4oo", "R4: their on-order rows now", S["oo"])),
                          ("PO headers", sq("sql_node_VCr4poh", "R4: the purchase orders now", S["poh"]))]),
            K.code(R4P, "R4 plan: grRvBuild section 9 on the fresh rows -> intent; write what is at before", ccode("r4_plan.js"),
                   ["route", "needIntent", "intentRows", "lineSlices", "lineCount", "ooSlices", "ooCount", "headerRows", "needHeaders"] + plan_end,
                   arrays=("intentRows", "lineSlices", "ooSlices", "headerRows", "jobRows"), objects=("lineCount", "ooCount")),
            end_b(ids, "r4pl", R4P, "IF the purchase orders cannot be written"),
            gate(ids, "cor_VCr4intent", "Intent to record?", R4P, "needIntent", [step_add(ids, "add_node_VCr4intent", "R4 INTENT: R4|I|<nnn> (before + after of every row)", R4P, "intentRows")]),
            slice_loop(ids, "r4", R4P, "lineSlices", "R4 WRITE: PO lines (update_node_grRvPoLines's columns)", POL, ["received_qty", "outstanding_quantity", "line_status", "created_received_qty"]),
            slice_loop(ids, "r4oo", R4P, "ooSlices", "R4 WRITE: on-order rows (update_node_grRvOnOrder's columns)", OO, ["open_qty", "received_qty"]),
            gate(ids, "cor_VCr4hdr", "Purchase orders to write?", R4P, "needHeaders", [
                K.update(ids, "update_node_VCr4hdr", "R4 WRITE: purchase orders (update_node_grRvPoHdr's columns)", PO, ("id", "in", N(R4P, "data.headerRows.id")),
                         [(p, N(R4P, "data.headerRows." + p)) for p in ["id", "po_status", "gr_status", "partially_received", "fully_received"]])]),
            br("r4back", [("Intent", intent("sql_node_VCr4intentB", "R4 read-back: the intent", "R4")),
                          ("PO lines", sq("sql_node_VCr4polB", "R4 read-back: PO lines", S["pol"])),
                          ("On order", sq("sql_node_VCr4ooB", "R4 read-back: on-order rows", S["oo"])),
                          ("PO headers", sq("sql_node_VCr4pohB", "R4 read-back: purchase orders", S["poh"]))]),
            K.code(R4C, "R4 check: every intent row at its after-values -> PO locks freed + DONE", ccode("r4_check.js"), chk, arrays=chk_arr),
            end_b(ids, "r4", R4C, "IF R4 did not complete"),
            gate(ids, "cor_VCr4free", "PO locks to free?", R4C, "needFree", [step_add(ids, "add_node_VCr4free", "PO locks: FREE|<n> (the purchase orders are restored)", R4C, "freeRows")]),
            step_done(ids, "r4", R4C, "R4_PO"),
        ]),
        # ---------------------------------------------------------------- R5
        K.if_(ids, "if_VCr5", "IF R5 THE RECEIPT is due", is_(CE, "needR5", "YES"), [
            K.sql("sql_node_VCr5gr", "R5: the receipt's status now", S["grnow"], ["gr_status"]),
            K.code(R5P, "R5 plan: the receipt back to Created (update_node_grRvGr's columns)", ccode("r5_plan.js"), ["route", "headerRows", "needHeader"] + plan_end,
                   arrays=("headerRows", "jobRows")),
            end_b(ids, "r5pl", R5P, "IF the receipt cannot be written"),
            gate(ids, "cor_VCr5head", "Receipt to write?", R5P, "needHeader", [
                K.update(ids, "update_node_VCr5head", "R5 WRITE: the receipt Created, previous_status Created, putaway_status blank (its Processing lock ends)", GR,
                         ("id", "in", N(R5P, "data.headerRows.id")), [(p, N(R5P, "data.headerRows." + p)) for p in ["id", "gr_status", "previous_status", "putaway_status"]],
                         labels=GR_HEAD_LABELS)]),
            K.sql("sql_node_VCr5back", "R5 read-back: the receipt", S["grnow"], ["gr_status"]),
            K.code(R5C, "R5 check: the receipt is Created -> DONE", ccode("r5_check.js"), chk, arrays=chk_arr),
            end_b(ids, "r5", R5C, "IF R5 did not complete"),
            step_done(ids, "r5", R5C, "R5_FINISH"),
        ]),
        # ---------------------------------------------------------------- finish
        K.sql("sql_node_VCfinlock", "FINISH: the purchase-order lock rows now (an earlier step of this run may have freed them)", S["polock"], ["job_id", "step_name", "result_ref", "holder_status"]),
        K.code(FIN, "FINISH: PO locks still held freed, the job COMPLETED", ccode("finish.js"), ["freeRows", "needFree", "jobRows", "result_message"], arrays=("freeRows", "jobRows")),
        gate(ids, "cor_VCfinfree", "PO locks to free?", FIN, "needFree", [step_add(ids, "add_node_VCfinfree", "PO locks: FREE|<n>", FIN, "freeRows")]),
        job_update(ids, "update_node_VCdone", "Job COMPLETED (lease released)", FIN, "jobRows"),
    ] + cres("done", FIN, "DONE")
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a REVERT_GR job (READY_TO_COMMIT, or COMMITTING_REVERT to resume)")], RES_FIELDS, nodes)


# =============================================================================================== GR_REVERT_WORKER
def build_worker():
    # GR_COMPLETE_WORKER (same receipt lock, same previous-status unlock) polling REVERT_GR: built by swapping its callees, then
    # renaming the command, the committing state, the codes and the node ids in the generated document
    saved = G.GR_IDS
    try:
        G.GR_IDS = {"GR_COMPLETE_PREPARE": RV_IDS.get("GR_REVERT_PREPARE", "0"), "GR_COMPLETE_COMMIT": RV_IDS.get("GR_REVERT_COMMIT", "0")}
        doc = G.build_worker()
    finally:
        G.GR_IDS = saved
    text = json.dumps(doc, ensure_ascii=False)
    for a, b in (("GR_COMPLETE_PREPARE", "GR_REVERT_PREPARE"), ("GR_COMPLETE_COMMIT", "GR_REVERT_COMMIT"), ("GR_COMPLETE_WORKER", "GR_REVERT_WORKER"),
                 ("COMPLETE_GR", "REVERT_GR"), ("COMMITTING_GR", "COMMITTING_REVERT"), ("GRC_", "GRV_"), ("grc_wrk_", "grv_wrk_"),
                 ("the completion stopped half-way", "the revert stopped half-way"), ("Not completed:", "Not reverted:"),
                 ("code_node_RW", "code_node_VW"), ("sql_node_RW", "sql_node_VW"), ("get_cache_RW", "get_cache_VW"), ("set_cache_RW", "set_cache_VW"),
                 ("update_node_RW", "update_node_VW"), ("add_node_RW", "add_node_VW"), ("workflow_node_RW", "workflow_node_VW"), ("cor_RW", "cor_VW"),
                 ("cori_YRW", "cori_YVW"), ("cori_NRW", "cori_NVW"), ("if_RW", "if_VW"), ("ifBlock_TRW", "ifBlock_TVW"), ("ifBlock_FRW", "ifBlock_FVW"),
                 ("loop_RW", "loop_VW"), ("return_node_RW", "return_node_VW")):
        text = text.replace(a, b)
    left = [w for w in ("COMPLETE_GR", "_RW", "GR_COMPLETE", "GRC_", "COMMITTING_GR") if w in text]
    assert not left, left
    return json.loads(text)


# =============================================================================================== GR_REVERT_PREPARE
def build_prepare():
    core = plan_core()
    if core is None:
        return None
    sqlmod, out = core
    ids = K.Ids(1799000000000)
    Gd, E, PP, P = "code_node_VPguard", "code_node_VPentry", "code_node_VPprep", "code_node_VPplan"
    T = N(Gd, "data.tenantId")
    job = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.lease_owner, (j.lease_expires_at > n.t) AS lease_live, j.row_version, j.attempt_count,
       j.idempotency_key, j.correlation_id, j.request_payload, j.is_deleted
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB""", T=T, JOB=N(Gd, "data.jobId"))
    back = sub("SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.progress_message, j.error_code, j.error_message FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB",
               T=T, JOB=N(Gd, "data.jobId"))
    res_fields = ["job_id", "job_status", "result_code", "result_message", "evidence"]
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], "
                "evidence: JSON.stringify({ v: 1, workflow: \"GR_REVERT_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(Gd, "data.result_code"), N(Gd, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"GR_REVERT_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    rounds = {1: [], 2: []}
    for key, spec in out["sql"].items():
        rounds[int(spec["round"])].append(("cai_VP" + key, key, [K.sql("sql_node_VP" + key, spec["title"], sqlmod.SQL[key], spec["cols"])]))
    pf, pa, po = decl(out, "VPprep")
    lf, la, lo = decl(out, "VPplan")
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message", "job_status"]
    ready_arr = ("readyRows", "jobRows", "unlockRows")

    def ready_tail(tag, src):
        rd = "code_node_VPready" + tag
        body = code("prepare/ready.js").replace("__PLAN__", N(src, "data"))
        rbody = code("prepare/result.js").replace("__READY__", N(rd, "data"))
        parts = [] if tag == "P" else [gate(ids, "cor_VPparts", "Payload parts to write?", rd, "needParts", [
            K.add(ids, "add_node_VPparts", "Payload parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", STEP,
                  [(p, N(P, "data.partRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]], labels={"organization_id": "Organization"})]),
            gate(ids, "cor_VPready", "Job READY_TO_COMMIT to write?", rd, "needReady", [
                K.update(ids, "update_node_VPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", JOB, ("id", "in", N(rd, "data.readyRows.id")),
                         [(p, N(rd, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message",
                                                                     "error_details", "prepared_payload", "line_count"]])])]
        return [
            K.code(rd, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ the receipt back when this job holds its lock)", body, ready_fields, arrays=ready_arr),
        ] + parts + [
            gate(ids, "cor_VPunlock" + tag, "Receipt to put back?", rd, "needUnlock", [
                G.gr_unlock(ids, "update_node_VPunlock" + tag, "Goods Receiving back to its status before the submit (nothing was written)", rd)]),
            gate(ids, "cor_VPfail" + tag, "Job FAILED to write?", rd, "needJobUpd", [job_update(ids, "update_node_VPfail" + tag, "Job FAILED with the reason (lease released)", rd, "jobRows")]),
            K.sql("sql_node_VPback" + tag, "Read-back: the job after the write (the truth)", back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
            K.code("code_node_VPresult" + tag, "Result", rbody.replace("sql_node_VPback.", "sql_node_VPback%s." % tag), res_fields),
            K.ret("return_node_VPdone" + tag, "Return", [(f, N("code_node_VPresult" + tag, "data." + f)) for f in res_fields]),
        ]

    nodes = [
        K.code(Gd, "Guard: job_id (digits), session tenant", code("prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_VPreject", "IF the input is invalid: answer, write nothing", is_(Gd, "route", "REJECT"), [
            K.code("code_node_VPrej", "Answer (rejected input)", rej_body, res_fields),
            K.ret("return_node_VPrej", "Return (rejected input)", [(f, N("code_node_VPrej", "data." + f)) for f in res_fields])]),
        K.sql("sql_node_VPjob", "The job (+ DB clock, lease flag, request)", job,
              ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key", "correlation_id",
               "request_payload", "is_deleted"]),
        K.code(E, "Entry: a VALIDATING REVERT_GR job under a live lease; its correlation -> the receipt; its request", code("prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "grId", "idempotencyKey", "rowVersion", "dbNow", "nonce", "request", "result_code", "result_message"],
               objects=("request", "rowVersion")),
        K.if_(ids, "if_VPnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(E, "route", "NOOP"), [
            K.code("code_node_VPnoop", "Answer (not prepared)", noop_body, res_fields),
            K.ret("return_node_VPnoop", "Return (not prepared)", [(f, N("code_node_VPnoop", "data." + f)) for f in res_fields])]),
        K.parallel("condition_all_VPread1", "Round 1 reads in parallel (no row limits): the receipt, its stock movements, its documents, its lock", rounds[1]),
        K.code(PP, "Prep: the classic's reads rebuilt -> grRvPrep (lifted): header refusals, the ledger replay, the ids round 2 reads (digits only)", body(out, "VPprep"),
               pf, arrays=pa, objects=po),
        K.if_(ids, "if_VPprepEnd", "IF the receipt is refused (or not locked under this job): FAILED, read nothing more", "'%s' == 'FAIL'" % N(PP, "data.route"), ready_tail("P", PP)),
        K.parallel("condition_all_VPread2", "Round 2 reads in parallel (no row limits): later movements, costing rows, invoices, balances, purchase orders, items", rounds[2]),
        K.code(P, "Plan: grRvBuild (lifted): conflicts -> FAILED with the classic's list; else the manifest (GRN-R movements, costing, documents, purchase orders) and its parts",
               body(out, "VPplan"), lf, arrays=la, objects=lo),
    ] + ready_tail("", P)
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a REVERT_GR job the worker holds")], res_fields, nodes)


# =============================================================================================== GR_REVERT_SUBMIT
SUB_RES = ["route", "code", "message", "reason", "job_id", "job_status", "gr_id", "gr_no", "line_count", "progress_percent", "progress_message", "error_code", "error_message", "evidence"]


def scode(name):
    return "\n".join([code("submit/_common.js"), code("submit/" + name)])


def build_submit():
    core = plan_core()
    if core is None:
        return None
    sqlmod, out = core
    ids = K.Ids(1799200000000)
    Gd, E, GT, PO_, GW = "code_node_VSguard", "code_node_VSentry", "code_node_VSgate", "code_node_VSpost", "code_node_VSgrrow"
    T, GRID, KEY = N(Gd, "data.tenantId"), N(Gd, "data.grId"), N(Gd, "data.key")
    jobobj = ("JSON_OBJECT('id', CAST(@A.id AS CHAR), 'job_status', @A.job_status, 'correlation_id', @A.correlation_id, 'progress_percent', @A.progress_percent, "
              "'progress_message', @A.progress_message, 'error_code', @A.error_code, 'error_message', @A.error_message)")
    facts = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       (SELECT CAST(@KJ AS CHAR) FROM gd_async_job k
         WHERE k.tenant_id = '@T' AND k.idempotency_key = '@KEY' AND k.is_deleted = 0 ORDER BY k.id DESC LIMIT 1) AS key_job,
       CAST(g.id AS CHAR) AS gr_id, g.gr_no, g.gr_status, g.organization_id, CAST(g.plant_id AS CHAR) AS plant_id,
       (SELECT COUNT(*) FROM goods_receiving_eg6l4ywi_sub l WHERE l.tenant_id = '@T' AND l.goods_receiving_id = @G AND l.is_deleted = 0) AS line_count,
       (SELECT p.step_name FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'GRC|@G' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS last_lock,
       (SELECT CAST(JSON_ARRAYAGG(@OJ) AS CHAR) FROM gd_async_job o
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0 AND o.command IN ('COMPLETE_GR', 'REVERT_GR') AND o.correlation_id = 'GR|@G' AND o.job_status IN (@OPEN)) AS open_jobs,
       (SELECT CAST(@XJ AS CHAR) FROM gd_async_job x
         WHERE x.tenant_id = '@T' AND x.is_deleted = 0 AND x.command = 'REVERT_GR' AND x.correlation_id = 'GR|@G' ORDER BY x.id DESC LIMIT 1) AS last_job
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN goods_receiving g
    ON g.tenant_id = '@T'
   AND g.id = @G
   AND g.is_deleted = 0""", KJ=jobobj.replace("@A", "k"), OJ=jobobj.replace("@A", "o"), XJ=jobobj.replace("@A", "x"), OPEN="'" + "', '".join(OPEN) + "'", T=T, G=GRID, KEY=KEY)
    back = sub("""SELECT CAST(j.id AS CHAR) AS job_id, j.job_status, j.correlation_id,
       g.gr_status, g.gr_no, CAST(g.gr_v2_job_id AS CHAR) AS gr_v2_job_id,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GRC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  LEFT JOIN goods_receiving g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.idempotency_key = '@KEY' AND j.is_deleted = 0
 ORDER BY j.id DESC LIMIT 1""", T=T, KEY=KEY)

    def sres(tag, src, title, back_node=None):
        call_ = "submitResult([%s][0], %s, [%s][0], %s)" % (N(Gd, "data"), "null" if src == Gd else "[%s][0]" % N(E, "data"), N(src, "data"),
                                                          "[%s][0]" % N(back_node, "data") if back_node else "null")
        body = scode("result.js") + "\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, job: res.job_id }));\nreturn res;" % call_
        return [K.code("code_node_VS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_VS%s" % tag, "Return (%s)" % title, [(f, N("code_node_VS%sres" % tag, "data." + f)) for f in SUB_RES])]

    read_nodes = [("cai_VS" + k, k, [K.sql("sql_node_VS" + k, spec["title"], sqlmod.SUBMIT_SQL[k], spec["cols"])]) for k, spec in out["submit_sql"].items()]
    gf, ga, go = decl(out, "VSgate")
    entry_fields = ["route", "code", "message", "reason", "tenantId", "grId", "grNo", "grNoSql", "grStatus", "organizationId", "plantId", "lineCount", "dbNow", "lockN", "jobId",
                    "jobStatus", "progressPercent", "progressMessage", "errorCode", "errorMessage"]
    nodes = [
        K.code(Gd, "Guard: operation, gr_id, idempotency key, source, session tenant + user", scode("guard.js"),
               ["route", "code", "message", "operation", "grId", "key", "tenantId", "uid", "source"]),
        K.if_(ids, "if_VSreject", "IF the input is invalid: answer, write nothing", is_(Gd, "route", "REJECT"), sres("rej", Gd, "rejected input")),
        K.sql("sql_node_VSfacts", "Facts: the job of this key, the receipt, its line count, latest lock, open jobs of any kind, its latest REVERT_GR job, DB clock", facts,
              ["db_now", "key_job", "gr_id", "gr_no", "gr_status", "organization_id", "plant_id", "line_count", "last_lock", "open_jobs", "last_job"]),
        K.code(E, "Entry: STATUS / this key's job; SUBMIT goes on for a Completed / Received receipt with no open job (BUSY / STOP otherwise)", scode("entry.js"), entry_fields,
               objects=("lineCount", "lockN", "progressPercent")),
        K.if_(ids, "if_VSanswer", "IF answered here (STATUS / BUSY / STOP): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"), sres("ans", E, "entry")),
        K.parallel("condition_all_VSread", "The gate's reads in parallel (no row limits)", read_nodes),
        K.code(GT, "Gate: grRvPrep (lifted) - the classic's refusals, the handling-unit receipts the background revert does not take (-> classic / STOP)", body(out, "VSgate"),
               gf, arrays=ga, objects=go),
        K.if_(ids, "if_VSgateEnd", "IF the gate answered (NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"), sres("gate", GT, "gate")),
        K.code(PO_, "Post: the queue rows (the receipt's lock, the job QUEUED 2 minutes ahead)", scode("post.js"), ["route", "code", "message", "lockRows", "jobRows"], arrays=("lockRows", "jobRows")),
        K.if_(ids, "if_VSpostEnd", "IF nothing to queue: answer, write nothing", "'%s' != 'QUEUE'" % N(PO_, "data.route"), sres("post", PO_, "post")),
        step_add(ids, "add_node_VSlock", "LOCK: gd_publish_step GRC|<gr> / LOCK|<n> (unique tenant / job / step: a concurrent submit fails its run)", PO_, "lockRows"),
        K.add(ids, "add_node_VSjob", "Job insert: REVERT_GR QUEUED, due in 2 minutes (unique idempotency key: a twin click fails its run)", JOB,
              [(p, N(PO_, "data.jobRows." + p)) for p in G.JOB_ADD_COLS], labels={"organization_id": "Organization"}),
        K.code(GW, "Receipt row: Processing under the new job", scode("grrow.js"), ["ok", "jobId", "grRows"], arrays=("grRows",)),
        gate(ids, "cor_VSgr", "Receipt to lock?", GW, "ok", [
            K.update(ids, "update_node_VSgr", "Goods Receiving Processing + gr_v2_job_id (the lock every writer honours)", GR, ("id", "in", N(GW, "data.grRows.id")),
                     [(p, N(GW, "data.grRows." + p)) for p in ["id", "gr_status", "gr_v2_job_id"]], labels=G.GR_LABELS)]),
        K.sql("sql_node_VSback", "Read-back: the job of this key, its receipt's status / job link, its latest lock", back,
              ["job_id", "job_status", "correlation_id", "gr_status", "gr_no", "gr_v2_job_id", "lock_ref"]),
        K.code("code_node_VSdue", "Due: the receipt is Processing under this job's lock -> the job due now", scode("due.js"), ["dueRows", "needDue"], arrays=("dueRows",)),
        gate(ids, "cor_VSdue", "Job to make due?", "code_node_VSdue", "needDue", [
            K.update(ids, "update_node_VSdue", "Job due now (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_VSdue", "data.dueRows.id")),
                     [("id", N("code_node_VSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_VSdue", "data.dueRows.next_attempt_at"))])]),
    ] + sres("done", PO_, "queued", "sql_node_VSback")
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"), ("gr_id", "string", "goods_receiving.id (digits)"),
                       ("idempotency_key", "string", "one per click and receipt (8-128 chars A-Z a-z 0-9 | : _ . -)"),
                       ("source", "string", "LIST (default)")], SUB_RES, nodes)


BUILDERS = [("GR_REVERT_PREPARE", build_prepare), ("GR_REVERT_COMMIT", build_commit), ("GR_REVERT_WORKER", build_worker), ("GR_REVERT_SUBMIT", build_submit)]

if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, fn in BUILDERS:
        if want and name not in want:
            continue
        doc = fn()
        if doc is None:
            print(f"{name}: waiting for the plan core (prepare/sql.py + code/outputs.json)")
            continue
        doc = G.wrap_doc_sql(doc)
        K.check_ids(doc)
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        path = os.path.join(OUT, name + ".json")
        print(f"{name}: {len(text)} chars, {len(K.check_ids(doc))} nodes" + (f" -> {path}" if "--write" in sys.argv else " (dry; --write to save)"))
        if "--write" in sys.argv:
            os.makedirs(OUT, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text + "\n")
