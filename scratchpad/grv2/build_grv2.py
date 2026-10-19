"""Builds the GR Completion V2 workflows (GR_COMPLETE_PREPARE / _COMMIT / _WORKER / _SUBMIT) as FlowGram JSON into the
repo's Goods Receiving/CompleteV2/. Pattern: scratchpad/gdc/build_gdc.py (GD Completed V2). Contract: GRV2_DESIGN.md.
Published with .dbtools/wf_upload.mjs (a compile-made sql-node never runs).

usage: python3 build_grv2.py [--write] [NAME ...]
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wfkit as K  # noqa: E402
sys.path.insert(0, os.path.join(HERE, "..", "cfwipe"))
from patch_cf import patch_exact  # noqa: E402  (an edit that leaves the custom fields out keeps them)

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
OUT = R + "Goods Receiving/CompleteV2/"
WRITE = "--write" in sys.argv
JOB = "GD Async Job:Table:2104845286495150081"
STEP = "GD Publish Step:Table:2105131615547461634"
GR = "Goods Receiving:Table:1901845517592285186"
GRL = "Item Table(Goods Receiving):Table:1939901512083677186"
PO = "Purchase Order:Table:1902776039445217282"
POL = "Item Table(Purchase Order):Table:1939901372270747649"
OO = "On Order Purchase Order:Table:1902627276974047233"
BATCH = "Batch:Table:1902719754154655746"
BNC = "Batch Number Configuration:Table:2058765580973846530"
TO = "Transfer Order Putaway:Table:1937714890958053378"
IT = "In Transit Detail:Table:2080477944160923650"
ITEM = "Item:Table:1901546842240438273"
ENGINE = ("INVENTORY_BULK_APPLY", "2109916822821744641")
JOB_PROPS = ["id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "row_version", "error_code", "error_message", "error_details", "finished_at"]
STEP_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "finished_at", "inventory_operation_id", "result_ref",
              "error_code", "error_message"]
RES_FIELDS = ["job_id", "job_status", "path", "result_code", "result_message", "evidence"]
# add_node_F9KqZLfd (ADD_INVENTORY) - no parent_transaction_no: GR_REVERT_COMPLETED removes only batches without one
BATCH_COLS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3",
              "manufacturing_date", "expired_date"]
# add_node_RTuMAGp5 (GOODS_RECEIVING)
TO_COLS = ["to_status", "plant_id", "to_id", "to_id_type", "movement_type", "ref_doc_type", "gr_no", "receiving_no", "supplier_id", "assigned_to", "created_by",
           "created_at", "organization_id", "project_id", "table_putaway_item"]
# add_node_ITrows (GOODS_RECEIVING)
IT_COLS = ["doc_type", "doc_id", "doc_no", "doc_line_id", "line_no", "parent_id", "parent_no", "parent_line_id", "material_id", "item_code", "item_name", "item_desc",
           "item_uom", "batch_id", "handling_unit_id", "plant_id", "organization_id", "transit_bin", "from_plant_id", "from_bin", "from_category", "to_plant_id",
           "to_bin", "to_category", "transit_qty", "received_qty", "open_qty", "status", "transit_date", "remark", "target_doc_type", "target_doc_id",
           "target_doc_no", "target_doc_line_id", "source_transit_id"]
GR_LABELS = {"gr_status": "GR Status", "putaway_status": "Putaway Status"}


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


def job_update(ids, nid, title, src, field, props=JOB_PROPS):
    return K.update(ids, nid, title, JOB, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in props])


def step_add(ids, nid, title, src, field):
    return K.add(ids, nid, title, STEP, [(p, N(src, "data.%s.%s" % (field, p))) for p in STEP_PROPS], labels={"organization_id": "Organization"})


def gr_unlock(ids, nid, title, src, field="unlockRows"):
    return K.update(ids, nid, title, GR, ("id", "in", N(src, "data.%s.id" % field)),
                    [("id", N(src, "data.%s.id" % field)), ("gr_status", N(src, "data.%s.gr_status" % field))], labels=GR_LABELS)


def sub(text, **kw):
    # longest token first: @T must not eat the start of @TO / @TOID
    for k in sorted(kw, key=len, reverse=True):
        text = text.replace("@" + k, kw[k])
    left = re.findall(r"@[A-Z]{2,}", text)
    assert not left, left
    return text


# =============================================================================================== GR_COMPLETE_COMMIT
CG, CE = "code_node_RCguard", "code_node_RCentry"


def batchnum_parts():
    shared = os.path.join(HERE, "code", "shared", "batchnum.js")
    return (("shared/batchnum.js",) if os.path.exists(shared) else ()) + ("commit/_batchnum_adapter.js",)


def ccode(name, extra=()):
    return "\n".join([code("commit/_common.js"), code("commit/_cmp.js")] + [code(x) for x in extra] + [code("commit/" + name)])


RESULT_JS = "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\n"


def cres(tag, src, path):
    body = RESULT_JS + code("commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [K.code("code_node_RC%sres" % tag, "Result (%s)" % path, body, RES_FIELDS),
            K.ret("return_node_RC%s" % tag, "Return (%s)" % path, [(f, N("code_node_RC%sres" % tag, "data." + f)) for f in RES_FIELDS])]


def end_a(ids, tag, src, title):
    """phase A (no stock moved yet): PO locks freed, wait marker, batch rows removed, the receipt back, then the job row"""
    nodes = [
        gate(ids, "cor_RC%sfree" % tag, "PO locks to free?", src, "needFree", [step_add(ids, "add_node_RC%sfree" % tag, "PO locks: FREE|<n> (this job's holds)", src, "freeRows")]),
        gate(ids, "cor_RC%sstep" % tag, "Marker row to write?", src, "needStep", [step_add(ids, "add_node_RC%sstep" % tag, "Marker (C0_WAIT|<n>)", src, "stepRows")]),
        gate(ids, "cor_RC%sbatch" % tag, "Batch rows to remove?", src, "needBatchDel", [
            K.update(ids, "update_node_RC%sbatch" % tag, "This job's batch rows soft-deleted (no stock was moved)", BATCH, ("id", "in", N(src, "data.batchDelRows.id")),
                     [("id", N(src, "data.batchDelRows.id")), ("is_deleted", N(src, "data.batchDelRows.is_deleted"))])]),
        gate(ids, "cor_RC%sunlock" % tag, "Receipt lock to release?", src, "needUnlock", [
            gr_unlock(ids, "update_node_RC%sunlock" % tag, "Goods Receiving back to its status before the submit (no stock was moved)", src)]),
        gate(ids, "cor_RC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
            job_update(ids, "update_node_RC%sjob" % tag, "Job: wait / retry with backoff / FAILED (lease released)", src, "jobRows")]),
    ]
    return K.if_(ids, "if_RC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def end_b(ids, tag, src, title):
    """phase B (the stock moved): retry with backoff or REQUIRES_REVIEW - never back"""
    nodes = [gate(ids, "cor_RC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
        job_update(ids, "update_node_RC%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_RC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def step_done(ids, tag, src, step):
    return gate(ids, "cor_RC%sdone" % tag, "%s DONE to record?" % step, src, "needStep", [step_add(ids, "add_node_RC%sdone" % tag, "%s DONE (unique job / step)" % step, src, "stepRows")])


def slice_loop(ids, tag, src, field, title, table, props, labels=None, add=False):
    loop_id = "loop_RC%s" % tag
    sl = "code_node_RC%sslice" % tag
    body = code("commit/slice.js").replace("__LOOP__", loop_id)
    write = (K.add(ids, "add_node_RC%swrite" % tag, title + " (<= 250 per call)", table, [(p, N(sl, "data.rows." + p)) for p in props], labels) if add else
             K.update(ids, "update_node_RC%swrite" % tag, title + " (<= 250 per call)", table, ("id", "in", N(sl, "data.rows.id")),
                      [(p, N(sl, "data.rows." + p)) for p in ["id"] + props], labels))
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
    S["steps"] = sub("SELECT st.step_name, st.step_status FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' AND st.step_name LIKE 'C%' "
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
    S["batch"] = sub("""SELECT CAST(b.id AS CHAR) AS id
  FROM gd_async_job j
  JOIN goods_receiving g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  JOIN batch b ON b.tenant_id = j.tenant_id AND b.organization_id = g.organization_id AND b.transaction_no = g.gr_no AND b.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.id = @JOB AND j.correlation_id REGEXP '^GR\\\\|[0-9]{1,20}$' AND COALESCE(g.gr_no, '') NOT IN ('', 'issued', 'draft')""", **TOK)
    S["own"] = sub("SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["part"] = lambda name: sub("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                                 "AND st.step_name LIKE CONCAT('@PFX', '@NAME|%') AND st.is_deleted = 0 ORDER BY st.step_name", PFX=PFX, NAME=name, **TOK)
    S["intent"] = lambda name: sub("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                                   "AND st.step_name LIKE '@NAME|I|%' AND st.is_deleted = 0 ORDER BY st.step_name", NAME=name, **TOK)
    POIDS, GRID, GRNO, ORG = N(CE, "data.poIdsSql"), N(CE, "data.grId"), N(CE, "data.grNoSql"), N(CE, "data.organizationId")
    S["pol"] = sub("""SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'purchase_order_id', CAST(l.purchase_order_id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'item_bundle_id', CAST(l.item_bundle_id AS CHAR), 'item_id', l.item_id, 'quantity', l.quantity, 'received_qty', l.received_qty,
       'created_received_qty', l.created_received_qty, 'outstanding_quantity', l.outstanding_quantity, 'line_status', l.line_status) AS j
  FROM purchase_order_2ukyuanr_sub l
 WHERE l.tenant_id = '@T' AND l.purchase_order_id IN (@POIDS) AND l.is_deleted = 0
 ORDER BY l.id""", POIDS=POIDS, **TOK)
    S["poh"] = sub("""SELECT JSON_OBJECT('id', CAST(p.id AS CHAR), 'po_status', p.po_status, 'gr_status', p.gr_status, 'partially_received', p.partially_received,
       'fully_received', p.fully_received) AS j
  FROM purchase_order p
 WHERE p.tenant_id = '@T' AND p.id IN (@POIDS) AND p.is_deleted = 0
 ORDER BY p.id""", POIDS=POIDS, **TOK)
    S["oo"] = sub("""SELECT JSON_OBJECT('id', CAST(o.id AS CHAR), 'po_line_id', CAST(o.po_line_id AS CHAR), 'open_qty', o.open_qty, 'received_qty', o.received_qty) AS j
  FROM on_order_purchase_order o
 WHERE o.tenant_id = '@T' AND o.is_deleted = 0
   AND o.po_line_id IN (SELECT l.id FROM purchase_order_2ukyuanr_sub l WHERE l.tenant_id = '@T' AND l.purchase_order_id IN (@POIDS))
 ORDER BY o.id""", POIDS=POIDS, **TOK)
    S["ourbatch"] = sub("""SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'batch_number', b.batch_number, 'material_id', CAST(b.material_id AS CHAR),
       'plant_id', CAST(b.plant_id AS CHAR), 'transaction_no', b.transaction_no) AS j
  FROM batch b
 WHERE b.tenant_id = '@T' AND b.organization_id = '@ORG' AND b.transaction_no = '@GRNO' AND b.is_deleted = 0""", ORG=ORG, GRNO=GRNO, **TOK)
    S["bnc"] = sub("""SELECT JSON_OBJECT('id', CAST(c.id AS CHAR), 'batch_level_selection', c.batch_level_selection, 'item_id', CAST(c.item_id AS CHAR),
       'item_category_id', CAST(c.item_category_id AS CHAR), 'item_group_id', CAST(c.item_group_id AS CHAR), 'batch_format', c.batch_format,
       'running_number', c.running_number, 'reset_frequency', c.reset_frequency, 'initial_value', c.initial_value, 'last_reset_date', c.last_reset_date,
       'date_format', c.date_format, 'format_preview', c.format_preview, 'organization_id', c.organization_id) AS j
  FROM batch_number_config c
 WHERE c.tenant_id = '@T' AND c.organization_id = '@ORG' AND c.is_deleted = 0
 ORDER BY c.id""", ORG=ORG, **TOK)
    S["dup"] = sub("""SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'batch_number', b.batch_number, 'material_id', CAST(b.material_id AS CHAR),
       'plant_id', CAST(b.plant_id AS CHAR), 'transaction_no', b.transaction_no) AS j
  FROM batch b
 WHERE b.tenant_id = '@T' AND b.organization_id = '@ORG' AND b.is_deleted = 0
   AND b.batch_number IN (SELECT (t.n COLLATE utf8mb4_general_ci) FROM JSON_TABLE('@NUMS', '$[*]' COLUMNS (n VARCHAR(255) PATH '$.n')) t)
 ORDER BY b.id""", ORG=ORG, NUMS=N("code_node_RCc1plan", "data.numbersSql"), **TOK)
    S["grl"] = sub("""SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'item_batch_no', l.item_batch_no) AS j
  FROM goods_receiving_eg6l4ywi_sub l
 WHERE l.tenant_id = '@T' AND l.goods_receiving_id = @GRID AND l.is_deleted = 0""", GRID=GRID, **TOK)
    S["to"] = sub("""SELECT CAST(t.id AS CHAR) AS id, t.to_id, t.to_status,
       (SELECT COUNT(*) FROM transfer_order_putaway_jz8m9w3h_sub l WHERE l.tenant_id = t.tenant_id AND l.transfer_order_putaway_id = t.id AND l.is_deleted = 0) AS line_count
  FROM transfer_order_putaway t
 WHERE t.tenant_id = '@T' AND t.gr_no = '@GRID' AND t.is_deleted = 0
 ORDER BY t.id""", GRID=GRID, **TOK)
    S["it"] = sub("""SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'doc_line_id', i.doc_line_id, 'status', i.status) AS j
  FROM in_transit_detail i
 WHERE i.tenant_id = '@T' AND i.doc_id = '@GRID' AND i.is_deleted = 0 AND COALESCE(i.status, '') <> 'Cancelled'""", GRID=GRID, **TOK)
    S["grback"] = sub("SELECT g.gr_status, g.putaway_status FROM goods_receiving g WHERE g.tenant_id = '@T' AND g.id = @GRID AND g.is_deleted = 0", GRID=GRID, **TOK)
    return S


def build_commit():
    ids = K.Ids(1798300000000)
    S = commit_sql()
    sq = lambda nid, title, key, cols=("j",): K.sql(nid, title, S[key], list(cols))
    part = lambda nid, title, name: K.sql(nid, title, S["part"](name), ["step_name", "result_ref"])
    intent = lambda nid, title, name: K.sql(nid, title, S["intent"](name), ["step_name", "result_ref"])
    br = lambda tag, items: K.parallel("condition_all_RC%s" % tag, "Reads in parallel", [("cai_RC%s%d" % (tag, i), t, [n]) for i, (t, n) in enumerate(items)])
    entry_fields = ["route", "phase", "dbNow", "jsAt", "jobId", "organizationId", "grId", "grNo", "plantId", "prevStatus", "idempotencyKey", "jobStatus", "rowVersion", "attempts",
                    "leaseUntil", "unlockOk", "partPrefix", "manifest", "poLocks", "poIdsSql", "grNoSql", "ourBatchIds", "jitter", "c0Waits", "jobRows", "needJobUpd",
                    "unlockRows", "needUnlock", "batchDelRows", "needBatchDel", "freeRows", "needFree", "needC0", "needC1", "needC1B", "needC2", "needC3", "needC4", "needC5",
                    "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "batchDelRows", "needBatchDel", "freeRows", "needFree",
           "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows", "batchDelRows", "freeRows")
    rej_body = RESULT_JS + code("commit/result.js") + "\nreturn commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");" % (
        N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    C0, C1P, C1D, C1C, B1P, B1C = "code_node_RCc0", "code_node_RCc1plan", "code_node_RCc1decide", "code_node_RCc1check", "code_node_RCc1bplan", "code_node_RCc1bcheck"
    C2I, C2, C3P, C3C = "code_node_RCc2in", "code_node_RCc2", "code_node_RCc3plan", "code_node_RCc3check"
    C4T, C4I, C4C, C5P, C5C, FIN = "code_node_RCc4to", "code_node_RCc4it", "code_node_RCc4check", "code_node_RCc5plan", "code_node_RCc5check", "code_node_RCfinish"
    nodes = [
        K.code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_RCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            K.code("code_node_RCrejres", "Result (REJECTED_INPUT)", rej_body, RES_FIELDS),
            K.ret("return_node_RCrej", "Return (rejected input)", [(f, N("code_node_RCrejres", "data." + f)) for f in RES_FIELDS])]),
        K.parallel("condition_all_RCfacts", "Facts in parallel: the job, its step rows, its manifest, the receipt's lock, the PO locks, its batch rows", [
            ("cai_RCjob", "Job", [K.sql("sql_node_RCjob", "The job (+ DB clock, lease flag, lease_until, due, previous status)", S["job"],
                ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                 "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted", "prev_status"])]),
            ("cai_RCsteps", "Steps", [K.sql("sql_node_RCsteps", "This job's C step rows", S["steps"], ["step_name", "step_status"])]),
            ("cai_RCpayload", "Manifest", [K.sql("sql_node_RCpayload", "The prepared manifest", S["payload"], ["prepared_payload"])]),
            ("cai_RCgr", "GR + lock", [K.sql("sql_node_RCgr", "The receipt's status, its V2 job and its latest completion lock", S["gr"], ["gr_status", "gr_v2_job_id", "lock_ref"])]),
            ("cai_RCpolock", "PO locks", [K.sql("sql_node_RCpolock", "The purchase-order lock rows of its POs (+ the holders' job status)", S["polock"], ["job_id", "step_name", "result_ref", "holder_status"])]),
            ("cai_RCbatch", "Batches", [K.sql("sql_node_RCbatch", "The receipt's batch rows (transaction_no = its number): removed on a clean failure", S["batch"], ["id"])]),
        ]),
        K.code(CE, "Entry: what this run does (phase A: C0 C1 C1B C2, SPLIT; phase B: C3 C4 C5, COMPLETED), the lease claim", ccode("entry.js"),
               entry_fields, arrays=("jobRows", "unlockRows", "batchDelRows", "freeRows", "ourBatchIds"), objects=("rowVersion", "attempts", "manifest", "poLocks", "jitter", "c0Waits")),
        K.if_(ids, "if_RCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_RCentryend", "IF the manifest is unusable or the receipt lost its lock: FAILED (+ back) or REQUIRES_REVIEW", "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
            gate(ids, "cor_RCeffree", "PO locks to free?", CE, "needFree", [step_add(ids, "add_node_RCeffree", "PO locks: FREE|<n>", CE, "freeRows")]),
            gate(ids, "cor_RCefbatch", "Batch rows to remove?", CE, "needBatchDel", [
                K.update(ids, "update_node_RCefbatch", "This job's batch rows soft-deleted", BATCH, ("id", "in", N(CE, "data.batchDelRows.id")),
                         [("id", N(CE, "data.batchDelRows.id")), ("is_deleted", N(CE, "data.batchDelRows.is_deleted"))])]),
            gate(ids, "cor_RCefunlock", "Receipt lock to release?", CE, "needUnlock", [gr_unlock(ids, "update_node_RCefunlock", "Goods Receiving back to its status before the submit", CE)]),
            gate(ids, "cor_RCefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_RCefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows")]),
        ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_RCclaim", "Lease claim: job COMMITTING_GR, lease_owner = this run, lease_expires_at = now + 10 min", CE, "jobRows"),
        K.sql("sql_node_RCown", "Read-back: the job after the lease claim", S["own"], ["id", "job_status", "lease_owner", "row_version"]),
        K.code("code_node_RCown", "Own: COMMITTING_GR under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_RClost", "IF another run took the job: stop", is_("code_node_RCown", "route", "LOST"), cres("lost", "code_node_RCown", "LOST")),
        # ---------------------------------------------------------------- C0
        K.if_(ids, "if_RCc0", "IF C0 REVALIDATE is due", is_(CE, "needC0", "YES"), [
            br("c0read", [("PO part", part("sql_node_RCc0part", "C0: the PO part", "PO")),
                          ("PO lines", sq("sql_node_RCc0pol", "C0: the lines of its purchase orders now", "pol"))]),
            K.code(C0, "C0 REVALIDATE: room on every PO line (e9pINRwN on a fresh read); PO locks free -> HOLD; busy -> free mine, wait", ccode("c0.js"),
                   chk + ["lockRows", "needLock"], arrays=chk_arr + ("lockRows",)),
            end_a(ids, "c0", C0, "IF the receipt cannot go on now (wait / FAILED)"),
            gate(ids, "cor_RCc0hold", "PO locks to take?", C0, "needLock", [step_add(ids, "add_node_RCc0hold", "PO locks: GRPO|<po> / HOLD|<n+1> (unique: a concurrent taker fails its run)", C0, "lockRows")]),
            step_done(ids, "c0", C0, "C0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- C1
        K.if_(ids, "if_RCc1", "IF C1 BATCHES is due", is_(CE, "needC1", "YES"), [
            br("c1read", [("BATCH part", part("sql_node_RCc1part", "C1: the BATCH part", "BATCH")),
                          ("Intent", intent("sql_node_RCc1intent", "C1: an intent of an earlier run", "C1")),
                          ("Configs", sq("sql_node_RCc1bnc", "C1: batch_number_config of the organization now", "bnc"))]),
            K.code(C1P, "C1 plan: the auto numbers from the fresh configs (or the intent), the numbers to check", ccode("c1_plan.js", batchnum_parts()),
                   chk + ["hasIntent", "draft", "numbersSql"], arrays=chk_arr, objects=("draft",)),
            end_a(ids, "c1pl", C1P, "IF the batches cannot be planned (FAILED)"),
            sq("sql_node_RCc1dup", "C1: live batch rows of the organization with those numbers", "dup"),
            K.code(C1D, "C1 decide: duplicate generated number -> FAILED; same number + item + plant -> reused; else one row per number + item; the intent", ccode("c1_decide.js"),
                   chk + ["intentRows", "needIntent", "bncRows", "needBnc", "batchRows", "needBatch"], arrays=chk_arr + ("intentRows", "bncRows", "batchRows")),
            end_a(ids, "c1de", C1D, "IF a generated number is taken (FAILED)"),
            gate(ids, "cor_RCc1intent", "Intent to record?", C1D, "needIntent", [step_add(ids, "add_node_RCc1intent", "C1 INTENT: C1|I|<nnn> (numbers, configs before / after, reuse)", C1D, "intentRows")]),
            gate(ids, "cor_RCc1cfg", "Configurations to advance?", C1D, "needBnc", [
                K.update(ids, "update_node_RCc1cfg", "C1 WRITE: batch_number_config running_number / last_reset_date (absolute)", BNC, ("id", "in", N(C1D, "data.bncRows.id")),
                         [(p, N(C1D, "data.bncRows." + p)) for p in ["id", "running_number", "last_reset_date"]])]),
            gate(ids, "cor_RCc1add", "Batch rows to add?", C1D, "needBatch", [
                K.add(ids, "add_node_RCc1add", "C1 WRITE: batch rows (ADD_INVENTORY's add_node_F9KqZLfd columns)", BATCH, [(p, N(C1D, "data.batchRows." + p)) for p in BATCH_COLS])]),
            br("c1back", [("Intent", intent("sql_node_RCc1intentB", "C1 read-back: the intent", "C1")),
                          ("Configs", sq("sql_node_RCc1bncB", "C1 read-back: the configs", "bnc")),
                          ("Batches", sq("sql_node_RCc1back", "C1 read-back: the receipt's batch rows", "ourbatch"))]),
            K.code(C1C, "C1 check: every number has its batch row, the configs at their after-state -> DONE", ccode("c1_check.js"), chk, arrays=chk_arr),
            end_a(ids, "c1", C1C, "IF C1 did not complete (retry / FAILED)"),
            step_done(ids, "c1", C1C, "C1_BATCHES"),
        ]),
        # ---------------------------------------------------------------- C1B
        K.if_(ids, "if_RCc1b", "IF C1B LINES is due", is_(CE, "needC1B", "YES"), [
            br("c1bread", [("GR part", part("sql_node_RCc1bpart", "C1B: the GR part", "GR")),
                           ("Intent", intent("sql_node_RCc1bintent", "C1B: the batch intent", "C1")),
                           ("Lines", sq("sql_node_RCc1blines", "C1B: the receipt's lines now", "grl"))]),
            K.code(B1P, "C1B plan: the generated numbers onto their lines", ccode("c1b_plan.js"), chk + ["lineSlices", "lineCount"], arrays=chk_arr + ("lineSlices",), objects=("lineCount",)),
            end_a(ids, "c1bpl", B1P, "IF the lines cannot be numbered (FAILED)"),
            slice_loop(ids, "c1b", B1P, "lineSlices", "C1B WRITE: GR line item_batch_no", GRL, ["item_batch_no"]),
            sq("sql_node_RCc1blinesB", "C1B read-back: the receipt's lines", "grl"),
            K.code(B1C, "C1B check: every auto line holds its number -> DONE", ccode("c1b_check.js"), chk, arrays=chk_arr),
            end_a(ids, "c1b", B1C, "IF C1B did not complete (retry / FAILED)"),
            step_done(ids, "c1b", B1C, "C1B_LINES"),
        ]),
        # ---------------------------------------------------------------- C2
        K.if_(ids, "if_RCc2", "IF C2 INVENTORY is due (phase A ends here: SPLIT)", is_(CE, "needC2", "YES"), [
            br("c2read", [("ENGINE part", part("sql_node_RCc2part", "C2: the ENGINE part", "ENGINE")),
                          ("BATCH part", part("sql_node_RCc2bpart", "C2: the BATCH part", "BATCH")),
                          ("Intent", intent("sql_node_RCc2intent", "C2: the batch intent", "C1")),
                          ("Batches", sq("sql_node_RCc2batch", "C2: the receipt's batch rows", "ourbatch"))]),
            K.code(C2I, "C2: the operation key and the movements (batch references -> batch ids)", ccode("c2_in.js"), ["ok", "why", "operationKey", "movements"], arrays=("movements",)),
            call(ids, "workflow_node_RCc2", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; GRC|<job> replays on a re-run)", ENGINE, [
                ("operation_key", N(C2I, "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")),
                ("movements", N(C2I, "data.movements"))]),
            K.code(C2, "C2 check: 200 -> DONE + SPLIT; 409 -> wait; 400 -> FAILED + back; else review", ccode("c2.js"), chk + ["splitRows", "needSplit"], arrays=chk_arr + ("splitRows",)),
            end_a(ids, "c2", C2, "IF the stock did not move"),
            step_done(ids, "c2", C2, "C2_INVENTORY"),
            gate(ids, "cor_RCsplit", "SPLIT hand-over to write?", C2, "needSplit", [job_update(ids, "update_node_RCsplit", "Job: SPLIT| hand-over lease (the next run does phase B)", C2, "splitRows")]),
        ] + cres("split", C2, "SPLIT")),
        # ---------------------------------------------------------------- C3
        K.if_(ids, "if_RCc3", "IF C3 PURCHASE ORDERS is due", is_(CE, "needC3", "YES"), [
            br("c3read", [("PO part", part("sql_node_RCc3part", "C3: the PO part", "PO")),
                          ("Intent", intent("sql_node_RCc3intent", "C3: an intent of an earlier run", "C3")),
                          ("PO lines", sq("sql_node_RCc3pol", "C3: the lines of its purchase orders now", "pol")),
                          ("On order", sq("sql_node_RCc3oo", "C3: their on-order rows now", "oo")),
                          ("PO headers", sq("sql_node_RCc3poh", "C3: the purchase orders now", "poh"))]),
            K.code(C3P, "C3 plan: H4Eg0oEI / W4nXz7Yb / KAeXsqwm on the fresh rows + the receipt's deltas -> intent; write what is at before", ccode("c3_plan.js"),
                   ["route", "needIntent", "intentRows", "lineSlices", "lineCount", "ooSlices", "ooCount", "headerRows", "needHeaders", "jobRows", "needJobUpd",
                    "result_code", "result_message", "job_status"], arrays=("intentRows", "lineSlices", "ooSlices", "headerRows", "jobRows"), objects=("lineCount", "ooCount")),
            end_b(ids, "c3pl", C3P, "IF the purchase orders cannot be written"),
            gate(ids, "cor_RCc3intent", "Intent to record?", C3P, "needIntent", [step_add(ids, "add_node_RCc3intent", "C3 INTENT: C3|I|<nnn> (before + after of every row)", C3P, "intentRows")]),
            slice_loop(ids, "c3", C3P, "lineSlices", "C3 WRITE: PO lines", POL, ["received_qty", "outstanding_quantity", "line_status", "created_received_qty"]),
            slice_loop(ids, "c3oo", C3P, "ooSlices", "C3 WRITE: on-order rows", OO, ["open_qty", "received_qty"]),
            gate(ids, "cor_RCc3hdr", "Purchase orders to write?", C3P, "needHeaders", [
                K.update(ids, "update_node_RCc3hdr", "C3 WRITE: purchase order status (update_node_xESD8YP4's columns)", PO, ("id", "in", N(C3P, "data.headerRows.id")),
                         [(p, N(C3P, "data.headerRows." + p)) for p in ["id", "po_status", "gr_status", "partially_received", "fully_received"]])]),
            br("c3back", [("Intent", intent("sql_node_RCc3intentB", "C3 read-back: the intent", "C3")),
                          ("PO lines", sq("sql_node_RCc3polB", "C3 read-back: PO lines", "pol")),
                          ("On order", sq("sql_node_RCc3ooB", "C3 read-back: on-order rows", "oo")),
                          ("PO headers", sq("sql_node_RCc3pohB", "C3 read-back: purchase orders", "poh"))]),
            K.code(C3C, "C3 check: every intent row at its after-values -> PO locks freed + DONE", ccode("c3_check.js"), chk, arrays=chk_arr),
            end_b(ids, "c3", C3C, "IF C3 did not complete"),
            gate(ids, "cor_RCc3free", "PO locks to free?", C3C, "needFree", [step_add(ids, "add_node_RCc3free", "PO locks: FREE|<n> (the purchase orders are updated)", C3C, "freeRows")]),
            step_done(ids, "c3", C3C, "C3_PO"),
        ]),
        # ---------------------------------------------------------------- C4
        K.if_(ids, "if_RCc4", "IF C4 PUTAWAY is due", is_(CE, "needC4", "YES"), [
            br("c4read", [("TO part", part("sql_node_RCc4part", "C4: the TO part", "TO")),
                          ("BATCH part", part("sql_node_RCc4bpart", "C4: the BATCH part", "BATCH")),
                          ("Intent", intent("sql_node_RCc4intent", "C4: the batch intent", "C1")),
                          ("Batches", sq("sql_node_RCc4batch", "C4: the receipt's batch rows", "ourbatch")),
                          ("TO", sq("sql_node_RCc4to", "C4: a live Transfer Order Putaway of the receipt", "to", ["id", "to_id", "to_status", "line_count"]))]),
            K.code(C4T, "C4 putaway: the Transfer Order Putaway (jo9g6Ldx's row) unless already added", ccode("c4_to.js"),
                   ["route", "toRow", "needTo", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"], arrays=("jobRows",), objects=("toRow",)),
            end_b(ids, "c4to", C4T, "IF the putaway cannot be written"),
            gate(ids, "cor_RCc4to", "Transfer Order Putaway to add?", C4T, "needTo", [
                K.add(ids, "add_node_RCc4to", "C4 WRITE: Transfer Order Putaway + lines (add_node_RTuMAGp5's columns; to_id 'issued')", TO, [(p, N(C4T, "data.toRow." + p)) for p in TO_COLS])]),
            br("c4mid", [("TO", sq("sql_node_RCc4toB", "C4: the Transfer Order Putaway read back", "to", ["id", "to_id", "to_status", "line_count"])),
                         ("In transit", sq("sql_node_RCc4it", "C4: the receipt's in-transit rows now", "it"))]),
            K.code(C4I, "C4 in-transit: ITrow / ITrows rows (target = the TO) less those already added", ccode("c4_it.js"),
                   ["route", "itSlices", "itCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"], arrays=("itSlices", "jobRows"), objects=("itCount",)),
            end_b(ids, "c4it", C4I, "IF the in-transit rows cannot be written"),
            slice_loop(ids, "c4it", C4I, "itSlices", "C4 WRITE: in_transit_detail rows", IT, IT_COLS, add=True),
            sq("sql_node_RCc4itB", "C4 read-back: the receipt's in-transit rows", "it"),
            K.code(C4C, "C4 check: the TO with every line, every in-transit row -> DONE", ccode("c4_check.js"), chk, arrays=chk_arr),
            end_b(ids, "c4", C4C, "IF C4 did not complete"),
            step_done(ids, "c4", C4C, "C4_PUTAWAY"),
        ]),
        # ---------------------------------------------------------------- C5
        K.if_(ids, "if_RCc5", "IF C5 FINISH is due", is_(CE, "needC5", "YES"), [
            br("c5read", [("GR part", part("sql_node_RCc5part", "C5: the GR part", "GR")),
                          ("AFTER part", part("sql_node_RCc5after", "C5: the AFTER part", "AFTER")),
                          ("GR now", K.sql("sql_node_RCc5gr", "C5: the receipt's status columns now", S["grback"], ["gr_status", "putaway_status"]))]),
            K.code(C5P, "C5 plan: Item dates (2Cq2eMRb) in slices, the receipt's final status", ccode("c5_plan.js"),
                   ["route", "headerRows", "itemSlices", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"], arrays=("headerRows", "itemSlices", "jobRows")),
            end_b(ids, "c5pl", C5P, "IF the receipt cannot be finished"),
            slice_loop(ids, "c5", C5P, "itemSlices", "C5 WRITE: Item last_transaction_date", ITEM, ["last_transaction_date"]),
            K.update(ids, "update_node_RCc5head", "C5 WRITE: the receipt Completed / Received + putaway_status (its Processing lock ends)", GR, ("id", "in", N(C5P, "data.headerRows.id")),
                     [(p, N(C5P, "data.headerRows." + p)) for p in ["id", "gr_status", "putaway_status"]], labels=GR_LABELS),
            K.sql("sql_node_RCc5back", "C5 read-back: the receipt", S["grback"], ["gr_status", "putaway_status"]),
            K.code(C5C, "C5 check: the receipt at its final status -> DONE", ccode("c5_check.js"), chk, arrays=chk_arr),
            end_b(ids, "c5", C5C, "IF C5 did not complete"),
            step_done(ids, "c5", C5C, "C5_FINISH"),
        ]),
        # ---------------------------------------------------------------- finish
        K.sql("sql_node_RCfinlock", "FINISH: the purchase-order lock rows now (an earlier step of this run may have freed them)", S["polock"], ["job_id", "step_name", "result_ref", "holder_status"]),
        K.code(FIN, "FINISH: PO locks still held freed, the job COMPLETED", ccode("finish.js"), ["freeRows", "needFree", "jobRows", "result_message"], arrays=("freeRows", "jobRows")),
        gate(ids, "cor_RCfinfree", "PO locks to free?", FIN, "needFree", [step_add(ids, "add_node_RCfinfree", "PO locks: FREE|<n>", FIN, "freeRows")]),
        job_update(ids, "update_node_RCdone", "Job COMPLETED (lease released)", FIN, "jobRows"),
    ] + cres("done", FIN, "DONE")
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_GR job (READY_TO_COMMIT, or COMMITTING_GR to resume)")], RES_FIELDS, nodes)


# =============================================================================================== GR_COMPLETE_WORKER
# GD_COMPLETE_WORKER (scratchpad/gdc/build_gdc.py build_worker) with the receipt's names: polls COMPLETE_GR only; the lock to
# release before COMMIT is the receipt's Processing status, back to the status it had before the submit (prev_status)
IDS_FILE = os.path.join(HERE, "ids.json")
GR_IDS = json.load(open(IDS_FILE)) if os.path.exists(IDS_FILE) else {}


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


GR_LOCK_JOIN = """LEFT JOIN goods_receiving g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^GR\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GRC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
GR_ID_COL = "(CASE WHEN g.gr_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.previousStatus')), NULL) AS prev_status"


def wjob_sql(tenant, job_ref):
    return sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
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
       @GRCOL,
       @PREVCOL,
       DATE_FORMAT(j.finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB
  @LOCKJOIN""", GRCOL=GR_ID_COL, PREVCOL=PREV_COL, T=tenant, JOB=job_ref, LOCKJOIN=GR_LOCK_JOIN)


WJOB_COLS = ["db_now", "id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "lease_live", "row_version", "error_code", "error_message", "error_details", "gr_id", "prev_status", "finished_at"]


def build_worker():
    ids = K.Ids(1798400000000)
    G = "code_node_RWguard"
    T = N(G, "data.tenantId")
    prep = ("GR_COMPLETE_PREPARE", GR_IDS.get("GR_COMPLETE_PREPARE", "0"))
    comm = ("GR_COMPLETE_COMMIT", GR_IDS.get("GR_COMPLETE_COMMIT", "0"))
    res_fields = ["worker_route", "processed", "jobs", "job_id", "job_status", "result_code", "result_message", "gr_id", "evidence"]
    poll = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       x.id, x.organization_id, x.gr_id, x.prev_status, x.job_status, x.progress_percent, x.progress_message, x.attempt_count, x.next_attempt_at, x.lease_owner,
       x.lease_expires_at, x.dead_lease, x.row_version, x.error_code, x.error_message, x.error_details, x.claim_id, x.claim_started_at, x.claim_owner
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN (SELECT CAST(j.id AS CHAR) AS id,
                    j.organization_id,
                    @GRCOL,
                    @PREVCOL,
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
                 ON c.tenant_id = '@T'
                AND c.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
                AND c.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)
                AND c.is_deleted = 0
               @LOCKJOIN
              WHERE j.tenant_id = '@T'
                AND j.is_deleted = 0
                AND j.command = 'COMPLETE_GR'
                AND (@JOB = 0 OR j.id = @JOB)
                AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GR')
                AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= NOW(3))
                AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW(3))
                AND (c.id IS NULL OR c.started_at <= NOW(3) - INTERVAL 10 MINUTE)
              ORDER BY j.create_time, j.id
              LIMIT 5) x
    ON 1 = 1""", GRCOL=GR_ID_COL, PREVCOL=PREV_COL, LOCKJOIN=GR_LOCK_JOIN, T=T, JOB=N(G, "data.jobId"))
    tick = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       @GRCOL,
       @PREVCOL,
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
    ON j.tenant_id = '@T'
   AND j.is_deleted = 0
   AND j.id IN (@IDS)
  LEFT JOIN gd_publish_step cw
    ON cw.tenant_id = '@T'
   AND cw.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
   AND cw.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)
   AND cw.is_deleted = 0
  @LOCKJOIN""", GRCOL=GR_ID_COL, PREVCOL=PREV_COL, LOCKJOIN=GR_LOCK_JOIN, T=T, IDS=N("code_node_RWplan", "data.jobIdsSql"))
    final = sub("""SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.attempt_count, j.lease_owner, j.error_code, j.error_message, SUBSTRING(j.correlation_id, 4) AS gr_id
  FROM gd_async_job j
 WHERE j.tenant_id = '@T'
   AND j.id IN (@IDS)""", T=T, IDS=N("code_node_RWplan", "data.jobIdsSql"))
    JOBREF = N("code_node_RWpick", "data.jobId")

    def jobread(nid, title):
        return K.sql(nid, title, wjob_sql(T, JOBREF), WJOB_COLS)

    def unlock(nid, title, src, field="unlockRows"):
        return gr_unlock(ids, nid, title, src, field)

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
            gate(ids, "cor_RW%sUnlock" % prefix, "Receipt lock to release after the %s?" % which, after, "needUnlock", [unlock("update_node_RW%sUnlock" % prefix, "Goods Receiving back to its status before the submit (nothing was saved)", after)]),
            gate(ids, "cor_RW%sJob" % prefix, "Job row to write after the %s?" % which, after, "needJobUpd", [wjob_update("update_node_RW%sJob" % prefix, "Job: FAILED (a hard code) / retry with backoff (lease released)", after)]),
        ]

    plan_ref = "[%s][0]" % N("code_node_RWplan", "data")
    nodes = [
        K.code(G, "Guard: optional job_id, session tenant, this run's lease owner WRK|<nonce>", wcode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_RWreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_RWrejres", "Result (REJECTED_INPUT)", wcode("result.js", {"__PATH__": "REJECTED_INPUT", "__PLAN__": "null", "__ROWS__": "[]"}), res_fields),
            K.ret("return_node_RWrej", "Return (invalid input)", [(f, N("code_node_RWrejres", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_RWpoll", "Poll: the due COMPLETE_GR jobs of the tenant (at most 5, oldest first; lease expired or never set; backoff over; no live claim row) + DB clock", poll,
              ["db_now", "id", "organization_id", "gr_id", "prev_status", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
               "lease_expires_at", "dead_lease", "row_version", "error_code", "error_message", "error_details", "claim_id", "claim_started_at", "claim_owner"]),
        K.code("code_node_RWplan", "Plan: the loop's items (the due jobs with their claim facts), the run start", wcode("plan.js"),
               ["route", "dbNow", "runStart", "items", "count", "jobIdsSql", "result_code", "result_message"], arrays=("items",)),
        K.set_cache("set_cache_RWidx0", "Loop index = 0 (per run: the key carries this run's nonce)", "grc_wrk_" + N(G, "data.nonce"), "0"),
        K.loop(ids, "loop_RWjobs", "Loop over the planned jobs (in order; a lost claim gate ends the tick, the rest wait for the next)", N("code_node_RWplan", "data.items"), [
            K.get_cache("get_cache_RWidx", "Loop index", "grc_wrk_" + N(G, "data.nonce")),
            K.sql("sql_node_RWtick", "Tick: the FRESH read of the planned jobs (state, lease, backoff, claim row) + the lease end of a claim made now", tick,
                  ["db_now", "lease_until", "id", "organization_id", "gr_id", "prev_status", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
                   "lease_owner", "lease_expires_at", "lease_live", "dead_lease", "due_now", "row_version", "error_code", "error_message", "error_details", "claim_id",
                   "claim_started_at", "claim_owner", "claim_live"]),
            K.code("code_node_RWpick", "Pick: the item by index; SKIP after the budget / not due / live lease / live claim; the claim gate rows", wcode("pick.js"),
                   ["route", "index", "nextIndex", "dbNow", "leaseUntil", "elapsed", "jobId", "organizationId", "grId", "item", "rvBase", "rvRows", "needRvUpd", "claimName",
                    "claimRows", "needClaimAdd", "result_message"], arrays=("rvRows", "claimRows"), objects=("item",)),
            gate(ids, "cor_RWrv", "Dead claim to move past (row_version = v + 1)?", "code_node_RWpick", "needRvUpd", [
                wjob_update("update_node_RWrv", "Job: row_version = v + 1 and the retry count (absolute)", "code_node_RWpick", "rvRows", ["id", "row_version", "attempt_count"])]),
            gate(ids, "cor_RWclaimAdd", "Claim row to insert?", "code_node_RWpick", "needClaimAdd", [
                step_add(ids, "add_node_RWclaim", "CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> (unique tenant / job / step: a twin's insert fails and its run ends)", "code_node_RWpick", "claimRows")]),
            K.code("code_node_RWclaim", "Claim: the lease / state write; a dead lease or claim = one retry; exhausted after max_retries", wcode("claim.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "grId", "prevStatus", "rowVersion", "attempts", "claimRows", "needClaim", "failRows", "unlockRows", "exhausted",
                    "result_code", "result_message", "job_status"], arrays=("claimRows", "failRows", "unlockRows")),
            gate(ids, "cor_RWlease", "Lease / state to write?", "code_node_RWclaim", "needClaim", [
                wjob_update("update_node_RWlease", "Lease write: WRK|<nonce> for 10 min, VALIDATING for a QUEUED job, the retry count", "code_node_RWclaim", "claimRows")]),
            jobread("sql_node_RWown", "Read-back: the job after the lease write"),
            K.code("code_node_RWown", "Own: state and lease as written -> PREPARE / PUBLISH / RESUME / EXHAUST; else LOST", wcode("own.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "grId", "prevStatus", "attempts", "failRows", "unlockRows", "needFail", "needUnlock", "rowVersion",
                    "result_code", "result_message", "job_status"], arrays=("failRows", "unlockRows")),
            gate(ids, "cor_RWfailUnlock", "Exhausted pre-commit: receipt lock to release?", "code_node_RWown", "needUnlock", [
                unlock("update_node_RWfailUnlock", "Goods Receiving back to its status before the submit (nothing was saved)", "code_node_RWown")]),
            gate(ids, "cor_RWfail", "Exhausted: job row to write?", "code_node_RWown", "needFail", [
                wjob_update("update_node_RWfail", "Job FAILED (pre-commit) / REQUIRES_REVIEW (COMMITTING_GR)", "code_node_RWown", "failRows")]),
            K.if_(ids, "if_RWprep", "IF the job is pre-commit under this run's lease: the ONE GR_COMPLETE_PREPARE call", is_("code_node_RWown", "route", "PREPARE"), [
                call(ids, "workflow_node_RWprep", "GR_COMPLETE_PREPARE (set-based reads; writes the job + releases the lock on FAILED)", prep, [("job_id", JOBREF)]),
                K.code("code_node_RWprepResp", "The prepare response, normalized (evidence; the job row decides)",
                       wcode("callee.js", {"__WHAT__": "prepare", "__NODE__": "workflow_node_RWprep", "\"__EXTRA__\"": "\"evidence\""}),
                       ["called", "job_id", "job_status", "result_code", "result_message", "evidence"]),
                jobread("sql_node_RWprepBack", "Read-back: the job after prepare (the truth)"),
                K.code("code_node_RWafterPrep", "After prepare: READY_TO_COMMIT -> publish; FAILED -> lease released; else a hard code fails it / a counted retry", wcode("after_prepare.js"),
                       ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "prepareResult", "prepareMessage", "result_code", "result_message", "job_status"],
                       arrays=("jobRows", "unlockRows")),
                gate(ids, "cor_RWprepUnlock", "Receipt lock to release after prepare?", "code_node_RWafterPrep", "needUnlock", [
                    unlock("update_node_RWprepUnlock", "Goods Receiving back to its status before the submit (nothing was saved)", "code_node_RWafterPrep")]),
                gate(ids, "cor_RWprepJob", "Job row to write after prepare?", "code_node_RWafterPrep", "needJobUpd", [
                    wjob_update("update_node_RWprepJob", "Job: lease released / FAILED / retry with backoff", "code_node_RWafterPrep")]),
            ]),
            jobread("sql_node_RWmid", "The job before the publish decision"),
            K.code("code_node_RWmid", "Before publish: READY_TO_COMMIT under this run's lease, or COMMITTING_GR with no live lease -> PUBLISH", wcode("mid.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_RWpub", "IF the job is to be published / resumed: the ONE GR_COMPLETE_COMMIT call", is_("code_node_RWmid", "route", "PUBLISH"),
                  publish("pub", "code_node_RWmid", "publish", "GR_COMPLETE_COMMIT (phase A: revalidate, batches, inventory; or phase B on a resume)")),
            jobread("sql_node_RWsplit", "The job after the publish call (the split decision)"),
            K.code("code_node_RWsplit", "Second publish: COMMITTING_GR under a SPLIT| hand-over lease -> PUBLISH again", wcode("split.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_RWpub2", "IF GR_COMPLETE_COMMIT ended SPLIT: the second call (purchase orders, putaway, the receipt)", is_("code_node_RWsplit", "route", "PUBLISH"),
                  publish("pub2", "code_node_RWsplit", "second publish", "GR_COMPLETE_COMMIT again after its SPLIT (phase B)")),
            K.set_cache("set_cache_RWidxN", "Next loop index", "grc_wrk_" + N(G, "data.nonce"), N("code_node_RWpick", "data.nextIndex")),
        ]),
        K.sql("sql_node_RWfinal", "Read-back: the planned jobs (final)", final, ["id", "job_status", "attempt_count", "lease_owner", "error_code", "error_message", "gr_id"]),
        K.code("code_node_RWresult", "Result (DONE)", wcode("result.js", {"__PATH__": "DONE", "__PLAN__": plan_ref, "__ROWS__": "[%s][0]" % N("sql_node_RWfinal", "data")}), res_fields),
        K.ret("return_node_RWdone", "Return the tick's result", [(f, N("code_node_RWresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "optional: gd_async_job.id (digits) to drive this job only (the form's kick after a submit); empty: the oldest due jobs of the session tenant (at most 5 per tick)")],
                      res_fields, nodes)


# =============================================================================================== PREPARE / SUBMIT
def plan_sql_module():
    """prepare/sql.py loaded by path (a module named `sql` from another builder may already be imported)"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("grv2_prepare_sql", os.path.join(HERE, "prepare", "sql.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def plan_code():
    need = ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js", "code/prepare/plan_tail.js",
            "code/shared/batchnum.js"]
    for f in need:
        if not os.path.exists(os.path.join(HERE, f)):
            raise NotImplementedError("GR_COMPLETE_PREPARE: the plan core's " + f + " is not there yet")
    lifted = raw("lift/lifted_prepare.js")
    assert "{{" not in lifted, "a lifted body still holds a platform token"
    return "\n".join([raw("lift/runtime.js"), lifted, code("shared/batchnum.js"), code("prepare/adapter.js"), code("prepare/chain.js"), code("prepare/plan.js"),
                      code("prepare/plan_tail.js")])


def build_prepare():
    ids = K.Ids(1798500000000)
    G, E, P, RD = "code_node_RPguard", "code_node_RPentry", "code_node_RPplan", "code_node_RPready"
    T = N(G, "data.tenantId")
    PSQL = plan_sql_module().SQL
    body = plan_code()
    job = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       CAST(j.plant_id AS CHAR) AS plant_id,
       j.command,
       j.job_status,
       j.lease_owner,
       (j.lease_expires_at > n.t) AS lease_live,
       j.row_version,
       j.attempt_count,
       j.idempotency_key,
       j.correlation_id,
       j.request_payload,
       j.is_deleted,
       (SELECT CAST(g.id AS CHAR) FROM goods_receiving g WHERE g.tenant_id = j.tenant_id AND g.gr_v2_job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci) AND g.is_deleted = 0 ORDER BY g.id LIMIT 1) AS linked_gr,
       (SELECT g.gr_status FROM goods_receiving g WHERE g.tenant_id = j.tenant_id AND g.gr_v2_job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci) AND g.is_deleted = 0 ORDER BY g.id LIMIT 1) AS linked_status
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB""", T=T, JOB=N(G, "data.jobId"))
    back = sub("SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.progress_message, j.error_code, j.error_message FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB",
               T=T, JOB=N(G, "data.jobId"))
    res_fields = ["job_id", "job_status", "result_code", "result_message", "evidence"]
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], "
                "evidence: JSON.stringify({ v: 1, workflow: \"GR_COMPLETE_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(G, "data.result_code"), N(G, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"GR_COMPLETE_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    reads = [("hdr", "The receipt (every schema field, one JSON object)"), ("lines", "Its lines, in id order"), ("pol", "PO lines of its purchase orders"),
             ("poh", "Its purchase orders"), ("oo", "On-order rows of its PO lines"), ("items", "Items of its lines (flags, costing, UOM conversions + tolerance, batch numbering)"),
             ("setup", "putaway_setup, the loading bay's default bin, the Putaway numbering rule"), ("bnc", "batch_number_config of the organization"),
             ("batches", "Existing batches with its manual numbers"), ("lock", "Its latest completion lock")]
    sql_nodes = []
    for k, title in reads:
        cols = ["k", "j"] if k == "setup" else ["step_name", "result_ref"] if k == "lock" else ["j"]
        sql_nodes.append(("cai_RP" + k, k, [K.sql("sql_node_RP" + k, title, PSQL[k], cols)]))
    plan_fields = ["route", "code", "message", "operationKey", "organizationId", "grId", "grNo", "previousStatus", "payload", "partRows", "movements", "lineCount",
                   "movementCount", "unlockOk"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message", "job_status"]
    nodes = [
        K.code(G, "Guard: job_id (digits), session tenant", code("prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_RPreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_RPrej", "Answer (rejected input)", rej_body, res_fields),
            K.ret("return_node_RPrej", "Return (rejected input)", [(f, N("code_node_RPrej", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_RPjob", "The job (+ DB clock, lease flag, request, a receipt linked by gr_v2_job_id)", job,
              ["db_now", "id", "organization_id", "plant_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key",
               "correlation_id", "request_payload", "is_deleted", "linked_gr", "linked_status"]),
        K.code(E, "Entry: a VALIDATING COMPLETE_GR job under a live lease; its correlation -> the receipt (unlinked -> FAILED + back)", code("prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "plantId", "grId", "idempotencyKey", "rowVersion", "dbNow", "jsAt", "nonce", "request", "previousStatus", "unlockRows",
                "result_code", "result_message"], arrays=("unlockRows",), objects=("request", "rowVersion")),
        K.if_(ids, "if_RPnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(E, "route", "NOOP"), [
            K.code("code_node_RPnoop", "Answer (not prepared)", noop_body, res_fields),
            K.ret("return_node_RPnoop", "Return (not prepared)", [(f, N("code_node_RPnoop", "data." + f)) for f in res_fields]),
        ]),
        K.parallel("condition_all_RPread", "Set-based reads in parallel (no row limits)", sql_nodes),
        K.code(P, "Plan: the stored receipt -> GOODS_RECEIVING's Completed path (lifted) -> the manifest and its parts", body, plan_fields,
               arrays=("partRows", "movements"), objects=("lineCount", "movementCount", "unlockOk")),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ the receipt back when this job holds its lock)", code("prepare/ready.js"),
               ready_fields, arrays=("readyRows", "jobRows", "unlockRows")),
        gate(ids, "cor_RPparts", "Payload parts to write?", RD, "needParts", [
            K.add(ids, "add_node_RPparts", "Payload parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", STEP,
                  [(p, N(P, "data.partRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]],
                  labels={"organization_id": "Organization"}),
        ]),
        gate(ids, "cor_RPready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_RPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code",
                                                                  "error_message", "error_details", "prepared_payload", "line_count"]]),
        ]),
        gate(ids, "cor_RPunlock", "Receipt lock to release?", RD, "needUnlock", [
            gr_unlock(ids, "update_node_RPunlock", "Goods Receiving back to its status before the submit (nothing was written)", RD)]),
        gate(ids, "cor_RPfail", "Job FAILED to write?", RD, "needJobUpd", [job_update(ids, "update_node_RPfail", "Job FAILED with the reason (lease released)", RD, "jobRows")]),
        K.sql("sql_node_RPback", "Read-back: the job after the write (the truth)", back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
        K.code("code_node_RPresult", "Result", code("prepare/result.js"), res_fields),
        K.ret("return_node_RPdone", "Return", [(f, N("code_node_RPresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_GR job the worker holds")], res_fields, nodes)


SUB_RES = ["route", "code", "message", "reason", "job_id", "job_status", "gr_id", "gr_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "evidence"]
# add_node_nGMSu41b's header columns (update_node_a31whzYI writes the same minus billing / shipping fax) + the V2 job link
GR_ADD_COLS = ["gr_status", "putaway_status", "plant_id", "purchase_order_number", "po_id", "supplier_name", "currency_code", "gr_billing_address",
               "gr_shipping_address", "supplier_contact_person", "supplier_contact_number", "supplier_email", "organization_id", "reference_type", "acc_integration_type",
               "project_id", "previous_status", "batch_index", "reference_doc", "ref_no_1", "ref_no_2", "gr_no", "gr_no_type", "gr_received_by", "gr_date", "assigned_to",
               "table_gr", "table_sn_records", "gr_remark1", "gr_remark2", "gr_remark3", "gr_remark4", "gr_remark5", "billing_address_name", "billing_address_phone",
               "billing_address_line_1", "billing_address_line_2", "billing_address_line_3", "billing_address_line_4", "billing_address_city", "billing_postal_code",
               "billing_address_state", "billing_address_country", "billing_attention", "billing_address_fax", "shipping_address_fax", "shipping_address_name",
               "shipping_address_phone", "shipping_address_line_1", "shipping_address_line_2", "shipping_address_line_3", "shipping_address_line_4",
               "shipping_address_city", "shipping_postal_code", "shipping_address_state", "shipping_address_country", "shipping_attention", "gr_v2_job_id",
               "custom_fields_e9609s2l"]
GR_UPD_COLS = ["id"] + [c for c in GR_ADD_COLS if c not in ("billing_address_fax", "shipping_address_fax")]
JOB_ADD_COLS = ["organization_id", "plant_id", "command", "idempotency_key", "job_status", "progress_percent", "progress_message", "attempt_count", "row_version",
                "cancel_requested", "next_attempt_at", "request_payload", "causation_id", "correlation_id", "line_count", "queued_at"]


def scode(name, extra=()):
    return "\n".join([code("submit/_common.js")] + [raw(x) if x.startswith("lift/") else code(x) for x in extra] + [code("submit/" + name)])


def submit_reads():
    """the gate's reads keyed on the FORM (prepare/sql.py SUBMIT_SQL, the plan core's JSON_OBJECT shapes)"""
    mod = plan_sql_module()
    if not hasattr(mod, "SUBMIT_SQL"):
        raise NotImplementedError("GR_COMPLETE_SUBMIT: prepare/sql.py has no SUBMIT_SQL yet")
    return mod.SUBMIT_SQL


def gate_code():
    for f in ("lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js"):
        if not os.path.exists(os.path.join(HERE, f)):
            raise NotImplementedError("GR_COMPLETE_SUBMIT: the plan core's " + f + " is not there yet")
    lifted = raw("lift/lifted_prepare.js")
    assert "{{" not in lifted, "a lifted body still holds a platform token"
    return "\n".join([raw("lift/runtime.js"), lifted, code("prepare/adapter.js"), code("prepare/chain.js"), code("submit/_common.js"), raw("pobusy/msg.js"),
                      code("submit/gate.js"), code("submit/gate_tail.js")])


def build_submit():
    ids = K.Ids(1798600000000)
    G, E, KY, GT, PO, GW, LK = ("code_node_RSguard", "code_node_RSentry", "code_node_RSkeys", "code_node_RSgate", "code_node_RSpost", "code_node_RSgrrow",
                                "code_node_RSlink")
    T, GRID, KEY = N(G, "data.tenantId"), N(G, "data.grId"), N(G, "data.key")
    SQ = submit_reads()
    gate_body = gate_code()
    open_list = "'" + "', '".join(["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GR", "REQUIRES_REVIEW"]) + "'"
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
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0 AND o.command = 'COMPLETE_GR' AND o.correlation_id = 'GR|@G' AND o.job_status IN (@OPEN)) AS open_jobs,
       (SELECT CAST(@XJ AS CHAR) FROM gd_async_job x
         WHERE x.tenant_id = '@T' AND x.is_deleted = 0 AND x.command = 'COMPLETE_GR' AND x.correlation_id = 'GR|@G' ORDER BY x.id DESC LIMIT 1) AS last_job
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN goods_receiving g
    ON g.tenant_id = '@T'
   AND g.id = @G
   AND g.is_deleted = 0""", KJ=jobobj.replace("@A", "k"), OJ=jobobj.replace("@A", "o"), XJ=jobobj.replace("@A", "x"), OPEN=open_list, T=T, G=GRID, KEY=KEY)
    stored = sub("""SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'po_line_item_id', CAST(l.po_line_item_id AS CHAR), 'received_qty', l.received_qty, 'is_split', l.is_split,
       'parent_or_child', l.parent_or_child) AS j
  FROM goods_receiving_eg6l4ywi_sub l
 WHERE l.tenant_id = '@T' AND l.goods_receiving_id = @G AND l.is_deleted = 0""", T=T, G=GRID)
    new = sub("SELECT CAST(g.id AS CHAR) AS id, g.gr_no FROM goods_receiving g WHERE g.tenant_id = '@T' AND g.gr_v2_job_id = '@JOB' AND g.is_deleted = 0",
              T=T, JOB=N(GW, "data.jobId"))
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
        call_ = "submitResult([%s][0], %s, [%s][0], %s)" % (N(G, "data"), "null" if src == G else "[%s][0]" % N(E, "data"), N(src, "data"),
                                                          "[%s][0]" % N(back_node, "data") if back_node else "null")
        body = scode("result.js") + "\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, job: res.job_id }));\nreturn res;" % call_
        return [K.code("code_node_RS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_RS%s" % tag, "Return (%s)" % title, [(f, N("code_node_RS%sres" % tag, "data." + f)) for f in SUB_RES])]

    reads = [("items", "Items of the form's lines (flags, costing, serial / inspection, UOM conversions + over_receive_tolerance)"),
             ("pol", "PO lines of the form's purchase orders"), ("poh", "The form's purchase orders"), ("setup", "putaway_setup + loading bay of the organization / plant")]
    read_nodes = [("cai_RS" + k, k, [K.sql("sql_node_RS" + k, title, SQ[k], ["k", "j"] if k == "setup" else ["j"])]) for k, title in reads]
    read_nodes.append(("cai_RSstored", "stored", [K.sql("sql_node_RSstored", "The stored lines (Edit): a Created receipt's reservation per PO line", stored, ["j"])]))
    entry_fields = ["route", "code", "message", "reason", "tenantId", "grId", "grNo", "grStatus", "organizationId", "plantId", "lineCount", "dbNow", "lockN", "jobId",
                    "jobStatus", "progressPercent", "progressMessage", "errorCode", "errorMessage"]
    nodes = [
        K.code(G, "Guard: operation, page_status + gr_id, idempotency key, answers, session tenant + user", scode("guard.js"),
               ["route", "code", "message", "operation", "pageStatus", "grId", "key", "tenantId", "uid", "answers"], objects=("answers",)),
        K.if_(ids, "if_RSreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), sres("rej", G, "rejected input")),
        K.sql("sql_node_RSfacts", "Facts: the job of this key, the receipt (Edit), its line count, latest lock, open / latest COMPLETE_GR jobs, DB clock", facts,
              ["db_now", "key_job", "gr_id", "gr_no", "gr_status", "organization_id", "plant_id", "line_count", "last_lock", "open_jobs", "last_job"]),
        K.code(E, "Entry: STATUS / this key's job; SUBMIT goes on for Add, or a Draft / Created receipt with no open job (BUSY / STOP otherwise)", scode("entry.js"), entry_fields,
               objects=("lineCount", "lockN", "progressPercent")),
        K.if_(ids, "if_RSanswer", "IF answered here (STATUS / BUSY / STOP): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"), sres("ans", E, "entry")),
        K.code(KY, "Keys: the form's items, purchase orders, organization, plant, line count (digits only; else STOP)", scode("keys.js"),
               ["ok", "why", "route", "code", "message", "tenantId", "itemIdsSql", "poIdsSql", "organizationId", "plantId", "lineCount"], objects=("lineCount",)),
        K.if_(ids, "if_RSkeysEnd", "IF the keys are not all digits: answer, read nothing, write nothing", "'%s' != 'YES'" % N(KY, "data.ok"), sres("keys", KY, "keys")),
        K.parallel("condition_all_RSread", "The gates' reads in parallel (no row limits)", read_nodes),
        K.code(GT, "Gate: not taken in the background (-> classic / STOP), then GOODS_RECEIVING's gates up to its first write (lifted) -> the filled-back receipt", gate_body,
               ["route", "code", "message", "reason", "allData", "grStatus"], objects=("allData",)),
        K.if_(ids, "if_RSgateEnd", "IF the gate answered (NOT_ELIGIBLE / 400 / 401): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"), sres("gate", GT, "gate")),
        K.code(PO, "Post: the queue rows (lock for Edit, the job QUEUED 2 minutes ahead, a Created receipt's reservations)", scode("post.js"),
               ["route", "code", "message", "previousStatus", "lockRows", "needLock", "jobRows"], arrays=("lockRows", "jobRows")),
        K.if_(ids, "if_RSpostEnd", "IF nothing to queue: answer, write nothing", "'%s' != 'QUEUE'" % N(PO, "data.route"), sres("post", PO, "post")),
        gate(ids, "cor_RSlock", "Edit: receipt lock to take?", PO, "needLock", [
            step_add(ids, "add_node_RSlock", "LOCK: gd_publish_step GRC|<gr> / LOCK|<n> (unique tenant / job / step: a concurrent submit fails its run)", PO, "lockRows")]),
        K.add(ids, "add_node_RSjob", "Job insert: COMPLETE_GR QUEUED, due in 2 minutes (unique idempotency key: a twin click fails its run)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in JOB_ADD_COLS], labels={"organization_id": "Organization"}),
        K.code(GW, "Receipt row: the filled-back receipt Processing under the new job", scode("grrow.js"), ["ok", "jobId", "grRow"], objects=("grRow",)),
        K.if_(ids, "if_RSadd", "IF Add: insert the receipt, read it back, lock it, link the job", "'%s' == 'Add'" % N(G, "data.pageStatus"), [
            K.add(ids, "add_node_RSgr", "Goods Receiving + lines (add_node_nGMSu41b's columns; Processing; gr_v2_job_id)", GR, [(p, N(GW, "data.grRow." + p)) for p in GR_ADD_COLS], labels=GR_LABELS),
            K.sql("sql_node_RSnew", "Read-back: the new receipt by gr_v2_job_id", new, ["id", "gr_no"]),
            K.code(LK, "Link: the lock and the job's correlation / request", scode("link.js"), ["ok", "why", "grId", "grNo", "lockRows", "jobRows"], arrays=("lockRows", "jobRows")),
            K.if_(ids, "if_RSlinked", "IF the receipt read back: lock it and link the job", "'%s' == 'YES'" % N(LK, "data.ok"), [
                step_add(ids, "add_node_RSnewlock", "LOCK: gd_publish_step GRC|<gr> / LOCK|1", LK, "lockRows"),
                job_update(ids, "update_node_RSlink", "Job: correlation GR|<gr>, causation, request (grId, grNo)", LK, "jobRows", ["id", "correlation_id", "causation_id", "request_payload"]),
            ]),
        ], [
            K.update(ids, "update_node_RSgr", "Goods Receiving + lines (update_node_a31whzYI's columns; Processing; gr_v2_job_id)", GR, ("id", "in", N(GW, "data.grRow.id")),
                     [(p, N(GW, "data.grRow." + p)) for p in GR_UPD_COLS], labels=GR_LABELS),
        ]),
        K.sql("sql_node_RSback", "Read-back: the job of this key, its receipt's status / job link, its latest lock", back,
              ["job_id", "job_status", "correlation_id", "gr_status", "gr_no", "gr_v2_job_id", "lock_ref"]),
        K.code("code_node_RSrelink", "Relink (Edit): the receipt's number after the write (a Draft's is issued there) into the job's request",
               scode("relink.js"), ["relinkRows", "needRelink"], arrays=("relinkRows",)),
        gate(ids, "cor_RSrelink", "Edit: the job's request to relink?", "code_node_RSrelink", "needRelink", [
            job_update(ids, "update_node_RSrelink", "Job: request grNo = the receipt's number (before it falls due)", "code_node_RSrelink", "relinkRows",
                       ["id", "request_payload"])]),
        K.code("code_node_RSdue", "Due: the receipt is Processing under this job's lock -> the job due now", scode("due.js"), ["dueRows", "needDue"], arrays=("dueRows",)),
        gate(ids, "cor_RSdue", "Job to make due?", "code_node_RSdue", "needDue", [
            K.update(ids, "update_node_RSdue", "Job due now (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_RSdue", "data.dueRows.id")),
                     [("id", N("code_node_RSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_RSdue", "data.dueRows.next_attempt_at"))])]),
    ] + sres("done", PO, "queued", "sql_node_RSback")
    # PO busy (2026-10-19): other receipts of its purchase orders still Processing; made last so the nodes above keep their keys
    busy = sub("""SELECT CAST(g.id AS CHAR) AS id, g.gr_no, t.p AS po_id, po.purchase_order_no AS po_no
  FROM goods_receiving g
  JOIN JSON_TABLE(g.po_id, '$[*]' COLUMNS (p VARCHAR(32) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) t
  LEFT JOIN purchase_order po ON po.tenant_id = g.tenant_id AND po.id = CAST(t.p AS UNSIGNED) AND po.is_deleted = 0
 WHERE g.tenant_id = '@T'
   AND g.gr_status = 'Processing'
   AND g.is_deleted = 0
   AND g.id <> @G
   AND CAST(t.p AS UNSIGNED) IN (@POS)""", T=T, G=GRID, POS=N(KY, "data.poIdsSql"))
    par = [n for n in nodes if n["id"] == "condition_all_RSread"][0]
    par["blocks"].append(K.parallel("tmp", "", [("cai_RSbusy", "busy", [
        K.sql("sql_node_RSbusy", "Other receipts of the form's purchase orders still Processing (received in the background)", busy,
              ["id", "gr_no", "po_id", "po_no"])])])["blocks"][0])
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"), ("page_status", "string", "Add | Edit"),
                       ("gr_id", "string", "goods_receiving.id (digits) for Edit; empty for Add"),
                       ("idempotency_key", "string", "one per click: page token + payload hash + generation (8-128 chars A-Z a-z 0-9 | : _ . -)"),
                       ("answers", "any", "{ continueZero } as GOODS_RECEIVING takes it"),
                       ("form", "any", "the GR form's data (allData: header + table_gr)")], SUB_RES, nodes)


BUILDERS = [("GR_COMPLETE_PREPARE", build_prepare), ("GR_COMPLETE_COMMIT", build_commit), ("GR_COMPLETE_WORKER", build_worker),
            ("GR_COMPLETE_SUBMIT", build_submit)]

SQL_WIDTH = 160
SQL_BREAK = ",\n\t\t"


def wrap_sql(text):
    """A long SQL line breaks after ", " outside quotes (the platform's addDraft failed on a 5,681-char SQL line, 2026-10-14)"""
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
        try:
            doc = wrap_doc_sql(fn())
            if name == "GR_COMPLETE_SUBMIT":
                doc = patch_exact(name, doc)
        except NotImplementedError as e:
            print(f"{name}: skipped ({e})")
            continue
        K.check_ids(doc)
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        path = os.path.join(OUT, name + ".json")
        print(f"{name}: {len(text)} chars, {len(K.check_ids(doc))} nodes" + (f" -> {path}" if WRITE else " (dry; --write to save)"))
        if WRITE:
            os.makedirs(OUT, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text + "\n")
