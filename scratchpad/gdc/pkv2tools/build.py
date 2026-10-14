"""Builds Picking/AsyncV2/PICKING_ASYNC_SUBMIT / _WORKER / PICKING_BULK_PREPARE / _COMMIT from code/ (stage 1a).

usage: python3 build.py [--write]      (workflow ids of the callee shells come from ids.json)
"""
import json, os, sys, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import wfkit as K
from fmt import render

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
OUT = os.environ.get("PK_OUT", R + "Picking/AsyncV2/")
WRITE = "--write" in sys.argv
IDS = json.load(open(os.path.join(HERE, "ids.json")))

JOB = "GD Async Job:Table:2104845286495150081"
STEP = "GD Publish Step:Table:2105131615547461634"
PICK = "Transfer Order Picking:Table:1935556443668959233"
GDL = "goods_delivery_fwii8mvb_sub:Table:1939904186426433537"
GD = "Goods Delivery:Table:1902054888473481218"
PACK = "Packing:Table:1993515601863524353"
HU = "Handling Unit:Table:2036736671686529026"
SO = "Sales Order:Table:1902773735979597826"

JOB_PROPS = ["id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "row_version", "error_code", "error_message", "error_details", "finished_at"]
STEP_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "finished_at",
              "inventory_operation_id", "result_ref", "error_code", "error_message"]
PICK_HEADER = ["ref_doc", "remarks", "remarks_2", "remarks_3", "delivery_method", "delivery_method_text", "area_id", "driver_name", "ic_no",
               "driver_contact_no", "sp_vehicle_no", "pickup_date", "validity_of_collection", "courier_company", "shipping_date",
               "tracking_number", "est_arrival_date", "freight_charges", "ct_driver_name", "ct_driver_contact_no", "ct_ic_no", "vehicle_no",
               "est_delivery_date", "delivery_cost", "shipping_company", "ss_shipping_date", "ss_freight_charges", "shipping_method",
               "ss_est_arrival_date", "ss_tracking_number", "tpt_vehicle_number", "tpt_transport_name", "tpt_ic_no", "tpt_driver_contact_no",
               "tpt_driver_name", "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no", "di_shipping_company",
               "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date",
               "di_validity_of_collection", "di_tracking_number", "di_freight_charges", "project_id"]
DI = ["di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no", "di_shipping_company", "di_transport_name", "di_vehicle_number",
      "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection", "di_tracking_number", "di_freight_charges"]


def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def code_file(path, subs=None):
    body = K.js(path)
    if "//@include _common.js\n" in body:
        body = body.replace("//@include _common.js\n", K.js(os.path.join(os.path.dirname(path), "_common.js")) + "\n")
    for a, b in (subs or {}).items():
        assert a in body, (path, a)
        body = body.replace(a, b)
    left = re.findall(r"__[A-Z]+__", body)
    assert not left, (path, left)
    return body


def is_(node, field, value):
    return "'%s' == '%s'" % (N(node, "data." + field), value)


def job_update(ids, nid, title, src, field="jobRows", props=JOB_PROPS):
    return K.update(ids, nid, title, JOB, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in props])


def unlock_update(ids, nid, title, src, field="unlockRows"):
    return K.update(ids, nid, title, PICK, ("id", "in", N(src, "data.%s.id" % field)),
                    [("id", N(src, "data.%s.id" % field)), ("is_processing", N(src, "data.%s.is_processing" % field))],
                    labels={"is_processing": "Is Processing"})


def step_add(ids, nid, title, src, field="stepRows"):
    return K.add(ids, nid, title, STEP, [(p, N(src, "data.%s.%s" % (field, p))) for p in STEP_PROPS], labels={"organization_id": "Organization"})


def gate(ids, nid, title, src, flag, nodes):
    return K.when_yes(ids, nid, title, "node.%s.data.%s" % (src, flag), flag, nodes)


def search_in(ids, nid, title, source, prop, ref, limit):
    n = K.search_node(ids, nid, title, source, (prop, "equalAny", ref), limit)
    leaf = n["data"]["table_id"]["rules"]["list"][0]
    leaf["operatorLabel"] = "Equal Any"
    return n


def job_sql(tenant, job_ref):
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
       j.picking_id,
       DATE_FORMAT(j.finished_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS finished_at
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '%s'
   AND j.id = %s""" % (tenant, job_ref)


JOB_SQL_COLS = ["db_now", "id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                "lease_expires_at", "lease_live", "row_version", "error_code", "error_message", "error_details", "picking_id", "finished_at"]


# =============================================================================================== PICKING_ASYNC_SUBMIT
def build_submit():
    ids = K.Ids(1796100000000)
    G, D = "code_node_PSguard", "code_node_PSdecide"
    T = N(G, "data.tenantId")
    PID, ORG, KEY = N(G, "data.pickingId"), N(G, "data.organizationId"), N(G, "data.idempotencyKey")
    facts = """SELECT DATE_FORMAT(NOW(3), '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       CAST(t.id AS CHAR) AS id,
       t.to_id,
       t.to_status,
       t.is_deleted,
       t.organization_id,
       CAST(t.plant_id AS CHAR) AS plant_id,
       COALESCE(t.is_processing, 0) AS is_processing,
       COALESCE(t.is_loading_bay, 0) AS is_loading_bay,
       TIMESTAMPDIFF(SECOND, t.update_time, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS lock_age_sec,
       ps.picking_after,
       CAST(ps.allow_full_picking AS CHAR) AS allow_full_picking,
       CAST(ps.auto_completed_gd AS CHAR) AS auto_completed_gd,
       CAST(ps.is_loading_bay AS CHAR) AS setup_loading_bay,
       (SELECT CONCAT(CAST(j.id AS CHAR), '|', j.job_status)
          FROM gd_async_job j
         WHERE j.tenant_id = '%(T)s'
           AND j.organization_id = '%(ORG)s'
           AND j.idempotency_key = '%(KEY)s'
         LIMIT 1) AS key_job,
       (SELECT CONCAT(CAST(j.id AS CHAR), '|', j.job_status)
          FROM gd_async_job j
         WHERE j.tenant_id = '%(T)s'
           AND j.command = 'CONFIRM_PICKING'
           AND j.picking_id = '%(PID)s'
           AND j.is_deleted = 0
           AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING', 'REQUIRES_REVIEW')
         ORDER BY j.id DESC
         LIMIT 1) AS open_job,
       (SELECT COUNT(*)
          FROM transfer_order_jz8m9w3h_sub l
         WHERE l.tenant_id = '%(T)s'
           AND l.transfer_order_id = %(PID)s
           AND l.is_deleted = 0
           AND COALESCE(l.line_status, '') <> 'Cancelled'
           AND l.pending_process_qty > 0
           AND ((l.target_location IS NOT NULL AND l.target_location <> COALESCE(l.source_bin, 0))
             OR (l.target_batch IS NOT NULL AND l.target_batch <> COALESCE(l.batch_no, 0)))) AS moved_rows
  FROM (SELECT 1 AS one) o
  LEFT JOIN transfer_order t
    ON t.tenant_id = '%(T)s'
   AND t.id = %(PID)s
  LEFT JOIN (SELECT p.picking_after, p.allow_full_picking, p.auto_completed_gd, p.is_loading_bay
               FROM picking_setup p
              WHERE p.tenant_id = '%(T)s'
                AND p.organization_id = '%(ORG)s'
                AND p.is_deleted = 0
              ORDER BY p.id
              LIMIT 1) ps
    ON 1 = 1""" % {"T": T, "PID": PID, "ORG": ORG, "KEY": KEY}
    back = """SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_message,
       j.error_code,
       j.error_message,
       j.picking_no
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.organization_id = '%s'
   AND j.idempotency_key = '%s'
 LIMIT 1""" % (T, ORG, KEY)
    ret_fields = lambda src: [(f, N(src, "data." + f)) for f in ["route", "result_code", "result_message", "job_id", "job_status"]]
    nodes = [
        K.code(G, "Guard: picking / organization / idempotency key / the request's shape (<= 2,000 lines), session tenant", code_file("submit/guard.js"),
               ["route", "tenantId", "pickingId", "organizationId", "operation", "idempotencyKey", "request", "lineCount", "result_code", "result_message"]),
        K.if_(ids, "if_PSreject", "IF the input is invalid: answer 400, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_PSrej", "Answer (rejected input)", "return { route: \"REJECT\", result_code: \"400\", result_message: [%s][0], job_id: \"\", job_status: \"\" };" % N(G, "data.result_message"),
                   ["route", "result_code", "result_message", "job_id", "job_status"]),
            K.ret("return_node_PSrej", "Return (rejected, nothing written)", ret_fields("code_node_PSrej")),
        ]),
        K.if_(ids, "if_PSstatus", "IF STATUS: the latest job of the Picking (read only)", is_(G, "route", "STATUS"), [
            K.sql("sql_node_PSstatus", "Status: the Picking's latest CONFIRM_PICKING job", """SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_message,
       j.error_code,
       j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.organization_id = '%s'
   AND j.command = 'CONFIRM_PICKING'
   AND j.picking_id = '%s'
   AND j.is_deleted = 0
 ORDER BY j.id DESC
 LIMIT 1""" % (T, ORG, PID), ["id", "job_status", "progress_message", "error_code", "error_message"]),
            K.code("code_node_PSstatusRes", "Status answer", code_file("submit/status.js"), ["route", "result_code", "result_message", "job_id", "job_status"]),
            K.ret("return_node_PSstatus", "Return the status", ret_fields("code_node_PSstatusRes")),
        ]),
        K.sql("sql_node_PSfacts", "Facts: the Picking, the organization's Picking Setup (first row, as PICKING), the job of this key, an open job of this Picking, stored bin moves", facts,
              ["db_now", "id", "to_id", "to_status", "is_deleted", "organization_id", "plant_id", "is_processing", "is_loading_bay", "lock_age_sec", "picking_after",
               "allow_full_picking", "auto_completed_gd", "setup_loading_bay", "key_job", "open_job", "moved_rows"]),
        K.code(D, "Decide: CREATE the job / RETURN this key's job / NOT_ELIGIBLE (the old save) / REJECT", code_file("submit/decide.js"),
               ["route", "jobRows", "needJob", "lockRows", "needLock", "result_code", "result_message", "job_id", "job_status"], arrays=("jobRows", "lockRows")),
        K.if_(ids, "if_PSstop", "IF rejected or not eligible: answer, write nothing", "%s || %s" % (is_(D, "route", "REJECT"), is_(D, "route", "NOT_ELIGIBLE")), [
            K.ret("return_node_PSstop", "Return (rejected / not eligible: the form runs the old save)", ret_fields(D)),
        ]),
        gate(ids, "cor_PSjob", "Job to create?", D, "needJob", [
            K.add(ids, "add_node_PSjob", "Job insert: CONFIRM_PICKING, QUEUED (unique tenant / organization / idempotency_key: a twin's insert fails)", JOB,
                  [(p, N(D, "data.jobRows." + p)) for p in ["organization_id", "plant_id", "command", "idempotency_key", "job_status", "progress_percent",
                                                             "progress_message", "attempt_count", "row_version", "cancel_requested", "request_payload",
                                                             "picking_id", "picking_no", "line_count", "queued_at"]], labels={"organization_id": "Organization"}),
        ]),
        gate(ids, "cor_PSlock", "Picking lock to take?", D, "needLock", [
            unlock_update(ids, "update_node_PSlock", "Picking is_processing = 1 (the old save and a second submit wait until the job ends)", D, "lockRows"),
        ]),
        K.sql("sql_node_PSback", "Read-back: the job by its key", back, ["id", "job_status", "progress_message", "error_code", "error_message", "picking_no"]),
        K.code("code_node_PSresult", "Result: QUEUED / EXISTING from the job row", code_file("submit/result.js"),
               ["route", "result_code", "result_message", "job_id", "job_status", "picking_id"]),
        K.ret("return_node_PSdone", "Return the job", ret_fields("code_node_PSresult")),
    ]
    req = [("picking_id", "string", "transfer_order.id (digits)"),
           ("organization_id", "string", "the Picking's organization (digits)"),
           ("operation", "string", "CONFIRM (the lines the picker entered), PICK_ALL_REMAINING (every open line in full) or STATUS (read only: the latest job)"),
           ("idempotency_key", "string", "16-128 of A-Z a-z 0-9 : _ | -, one per click (a retry of the same click reuses it)"),
           ("payload", "any", "JSON text or object: { lines: [ { row_id, qty, pick_uom, target_location_id, target_batch_id, remark, remark_2, remark_3, attachment } ], header_patch: { remarks, di_*, ... } }"),
           ("confirmed_by", "string", "the picker's name, stored on the records")]
    return K.workflow(req, ["route", "result_code", "result_message", "job_id", "job_status"], nodes)


# =============================================================================================== PICKING_BULK_PREPARE
def build_prepare():
    ids = K.Ids(1796300000000)
    G, E, P = "code_node_PPguard", "code_node_PPentry", "code_node_PPplan"
    T = N(G, "data.tenantId")
    PID, ORG = N(E, "data.pickingId"), N(E, "data.organizationId")
    job = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       j.command,
       j.job_status,
       j.lease_owner,
       (j.lease_expires_at > n.t) AS lease_live,
       j.row_version,
       j.attempt_count,
       j.picking_id,
       j.picking_no,
       j.request_payload,
       j.is_deleted
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '%s'
   AND j.id = %s""" % (T, N(G, "data.jobId"))
    hdr = """SELECT CAST(t.id AS CHAR) AS id,
       t.to_id,
       t.to_status,
       t.is_deleted,
       t.organization_id,
       CAST(t.plant_id AS CHAR) AS plant_id,
       COALESCE(t.is_loading_bay, 0) AS is_loading_bay,
       CAST(t.gd_no AS CHAR) AS gd_no_json,
       t.delivery_no,
       t.so_no,
       ps.picking_after,
       CAST(ps.allow_full_picking AS CHAR) AS allow_full_picking,
       CAST(ps.auto_completed_gd AS CHAR) AS auto_completed_gd,
       CAST(ps.is_loading_bay AS CHAR) AS setup_loading_bay,
       CAST(pk.packing_required AS CHAR) AS packing_required,
       CAST(pk.auto_trigger_pkg AS CHAR) AS auto_trigger_pkg,
       pk.packing_mode
  FROM (SELECT 1 AS one) o
  LEFT JOIN transfer_order t
    ON t.tenant_id = '%(T)s'
   AND t.id = %(PID)s
  LEFT JOIN (SELECT p.picking_after, p.allow_full_picking, p.auto_completed_gd, p.is_loading_bay
               FROM picking_setup p
              WHERE p.tenant_id = '%(T)s'
                AND p.organization_id = '%(ORG)s'
                AND p.is_deleted = 0
              ORDER BY p.id
              LIMIT 1) ps
    ON 1 = 1
  LEFT JOIN (SELECT k.packing_required, k.auto_trigger_pkg, k.packing_mode
               FROM packing_setup k
              WHERE k.tenant_id = '%(T)s'
                AND k.organization_id = '%(ORG)s'
                AND k.is_deleted = 0
              ORDER BY k.id
              LIMIT 1) pk
    ON 1 = 1""" % {"T": T, "PID": PID, "ORG": ORG}
    lines = """SELECT CAST(l.id AS CHAR) AS id,
       CAST(l.parent_id AS CHAR) AS parent_id,
       CAST(l.item_code AS CHAR) AS item_code,
       l.item_name,
       l.item_desc,
       l.more_desc,
       CAST(l.item_uom AS CHAR) AS item_uom,
       CAST(l.qty_to_pick AS CHAR) AS qty_to_pick,
       CAST(l.pending_process_qty AS CHAR) AS pending_process_qty,
       l.line_status,
       CAST(l.gd_id AS CHAR) AS gd_id,
       l.gd_no,
       CAST(l.gd_line_id AS CHAR) AS gd_line_id,
       CAST(l.so_id AS CHAR) AS so_id,
       l.so_no,
       CAST(l.so_line_id AS CHAR) AS so_line_id,
       CAST(l.source_bin AS CHAR) AS source_bin,
       CAST(l.target_location AS CHAR) AS target_location,
       CAST(l.batch_no AS CHAR) AS batch_no,
       CAST(l.target_batch AS CHAR) AS target_batch,
       CAST(l.handling_unit_id AS CHAR) AS handling_unit_id,
       CAST(l.item_bundle_id AS CHAR) AS item_bundle_id,
       l.row_type,
       l.remark,
       l.remark_2,
       l.remark_3,
       CAST(l.attachment AS CHAR) AS attachment
  FROM transfer_order_jz8m9w3h_sub l
 WHERE l.tenant_id = '%s'
   AND l.transfer_order_id = %s
   AND l.is_deleted = 0""" % (T, PID)
    gd = """SELECT CAST(l.id AS CHAR) AS id,
       CAST(l.goods_delivery_id AS CHAR) AS goods_delivery_id,
       l.picking_status,
       g.gd_status,
       CAST(l.gd_qty AS CHAR) AS gd_qty,
       l.material_name
  FROM goods_delivery_fwii8mvb_sub l
  JOIN goods_delivery g
    ON g.id = l.goods_delivery_id
   AND g.tenant_id = '%(T)s'
 WHERE l.tenant_id = '%(T)s'
   AND l.is_deleted = 0
   AND l.goods_delivery_id IN (SELECT p.gd_id
                                 FROM transfer_order_jz8m9w3h_sub p
                                WHERE p.tenant_id = '%(T)s'
                                  AND p.transfer_order_id = %(PID)s
                                  AND p.is_deleted = 0
                                  AND p.gd_id IS NOT NULL)""" % {"T": T, "PID": PID}
    uom = """SELECT CAST(i.id AS CHAR) AS item_id,
       CAST(i.based_uom AS CHAR) AS based_uom,
       CAST(c.alt_uom_id AS CHAR) AS alt_uom_id,
       CAST(c.base_qty AS CHAR) AS base_qty
  FROM item i
  LEFT JOIN item_mji552rc_sub c
    ON c.tenant_id = '%(T)s'
   AND c.Item_id = i.id
   AND c.is_deleted = 0
 WHERE i.tenant_id = '%(T)s'
   AND i.id IN (SELECT l.item_code
                  FROM transfer_order_jz8m9w3h_sub l
                 WHERE l.tenant_id = '%(T)s'
                   AND l.transfer_order_id = %(PID)s
                   AND l.id IN (%(UOM)s))""" % {"T": T, "PID": PID, "UOM": N(E, "data.uomRowIdsSql")}
    # Full Picking only (the org's first Picking Setup row, as PICKING reads it): what every Picking has picked of this one's GD lines
    picked = """SELECT CAST(r.gd_line_id AS CHAR) AS gd_line_id,
       CAST(SUM(r.store_out_qty) AS CHAR) AS picked_qty
  FROM transfer_order_vrqs3cmr_sub r
  JOIN transfer_order t
    ON t.id = r.transfer_order_id
   AND t.tenant_id = r.tenant_id
   AND t.is_deleted = 0
 WHERE r.tenant_id = '%(T)s'
   AND r.is_deleted = 0
   AND r.gd_line_id IN (SELECT p.gd_line_id
                          FROM transfer_order_jz8m9w3h_sub p
                         WHERE p.tenant_id = '%(T)s'
                           AND p.transfer_order_id = %(PID)s
                           AND p.is_deleted = 0
                           AND p.gd_line_id IS NOT NULL)
   AND (SELECT s.allow_full_picking
          FROM picking_setup s
         WHERE s.tenant_id = '%(T)s'
           AND s.organization_id = '%(ORG)s'
           AND s.is_deleted = 0
         ORDER BY s.id
         LIMIT 1) = 1
 GROUP BY r.gd_line_id""" % {"T": T, "PID": PID, "ORG": ORG}
    back = """SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_message,
       j.error_code,
       j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id = %s""" % (T, N(G, "data.jobId"))
    res_fields = ["job_id", "job_status", "result_code", "result_message", "line_count", "evidence"]
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], line_count: \"0\", "
                "evidence: JSON.stringify({ v: 1, workflow: \"PICKING_BULK_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(G, "data.result_code"), N(G, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", line_count: \"0\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"PICKING_BULK_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    nodes = [
        K.code(G, "Guard: job_id (digits), session tenant", code_file("prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_PPreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_PPrej", "Answer (rejected input)", rej_body, res_fields),
            K.ret("return_node_PPrej", "Return (rejected input)", [(f, N("code_node_PPrej", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_PPjob", "The job (+ DB clock, lease flag, request)", job,
              ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "picking_id", "picking_no", "request_payload", "is_deleted"]),
        K.code(E, "Entry: a VALIDATING CONFIRM_PICKING job under a live lease; its request -> the ids of the reads", code_file("prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "pickingId", "rowVersion", "dbNow", "confirmedAt", "request", "uomRowIdsSql", "result_code", "result_message"],
               objects=("request",)),
        K.if_(ids, "if_PPnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(E, "route", "NOOP"), [
            K.code("code_node_PPnoop", "Answer (not prepared)", noop_body, res_fields),
            K.ret("return_node_PPnoop", "Return (not prepared)", [(f, N("code_node_PPnoop", "data." + f)) for f in res_fields]),
        ]),
        K.parallel("condition_all_PPread", "Set-based reads in parallel: the Picking + setups, its lines, its GD lines, the item units, the picked totals", [
            ("cai_PPhdr", "Picking + setups", [K.sql("sql_node_PPhdr", "The Picking, Picking Setup and Packing Setup (each the organization's first row, as PICKING reads them)", hdr,
                                                     ["id", "to_id", "to_status", "is_deleted", "organization_id", "plant_id", "is_loading_bay", "gd_no_json", "delivery_no", "so_no",
                                                      "picking_after", "allow_full_picking", "auto_completed_gd", "setup_loading_bay", "packing_required", "auto_trigger_pkg", "packing_mode"])]),
            ("cai_PPlines", "Picking lines", [K.sql("sql_node_PPlines", "Every line of the Picking (flat; a bundle's items carry parent_id)", lines,
                                                    ["id", "parent_id", "item_code", "item_name", "item_desc", "more_desc", "item_uom", "qty_to_pick", "pending_process_qty",
                                                     "line_status", "gd_id", "gd_no", "gd_line_id", "so_id", "so_no", "so_line_id", "source_bin", "target_location", "batch_no",
                                                     "target_batch", "handling_unit_id", "item_bundle_id", "row_type", "remark", "remark_2", "remark_3", "attachment"])]),
            ("cai_PPgd", "GD lines", [K.sql("sql_node_PPgd", "The lines of every Goods Delivery on the Picking, with the delivery's status", gd,
                                            ["id", "goods_delivery_id", "picking_status", "gd_status", "gd_qty", "material_name"])]),
            ("cai_PPpicked", "Picked so far", [K.sql("sql_node_PPpicked", "Full Picking: the quantity every Picking has picked of this Picking's GD lines", picked,
                                                     ["gd_line_id", "picked_qty"])]),
            ("cai_PPuom", "Item units", [K.sql("sql_node_PPuom", "The item units of the lines picked in another unit (based_uom + table_uom_conversion)", uom,
                                               ["item_id", "based_uom", "alt_uom_id", "base_qty"])]),
        ]),
        K.code(P, "Plan: records, line status, GD line status, the bundle rule, the Full Picking over-pick check -> READY_TO_COMMIT (+ prepared payload) or FAILED (+ lock released)", code_file("prepare/plan.js"),
               ["route", "jobRows", "needJobUpd", "readyRows", "needReady", "unlockRows", "needUnlock", "result_code", "result_message", "job_status", "recordCount", "touchedRows", "gdLineCount"],
               arrays=("jobRows", "readyRows", "unlockRows")),
        gate(ids, "cor_PPready", "Job READY_TO_COMMIT to write?", P, "needReady", [
            K.update(ids, "update_node_PPready", "Job READY_TO_COMMIT + prepared_payload (the worker's lease is kept)", JOB, ("id", "in", N(P, "data.readyRows.id")),
                     [(p, N(P, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message",
                                                                  "error_details", "prepared_payload", "line_count", "picking_no"]]),
        ]),
        gate(ids, "cor_PPfail", "Job FAILED to write?", P, "needJobUpd", [job_update(ids, "update_node_PPfail", "Job FAILED with the reason (lease released)", P)]),
        gate(ids, "cor_PPunlock", "Picking lock to release?", P, "needUnlock", [unlock_update(ids, "update_node_PPunlock", "Picking is_processing = 0 (nothing was saved)", P)]),
        K.sql("sql_node_PPback", "Read-back: the job after the write (the truth)", back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
        K.code("code_node_PPresult", "Result", code_file("prepare/result.js"), res_fields),
        K.ret("return_node_PPdone", "Return", [(f, N("code_node_PPresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a CONFIRM_PICKING job the worker holds")], res_fields, nodes)


# =============================================================================================== PICKING_BULK_COMMIT
def build_commit():
    ids = K.Ids(1796400000000)
    G, E, O = "code_node_PCguard", "code_node_PCentry", "code_node_PCown"
    T = N(G, "data.tenantId")
    JOBID = N(G, "data.jobId")
    PID = N(E, "data.pickingId")
    res_fields = ["publish_route", "job_id", "job_status", "result_code", "result_message", "evidence"]

    def result(nid, path, decider, steps, message_from=None):
        """a Result code node for one ending: the decider's answer + the routes of the steps on this path (evidence)"""
        body = "// PICKING_BULK_COMMIT - Result (%s)\n" % path
        body += "const T = (v) => String(v === undefined || v === null ? \"\" : v).replace(/^\\\"([\\s\\S]*)\\\"$/, \"$1\").trim();\n"
        body += "const steps = {};\n"
        for st in steps:
            body += "steps.%s = T([%s][0]);\n" % (st.replace("code_node_PC", ""), N(st, "data.route"))
        body += "const d0 = [%s][0];\n" % N(decider, "data")
        body += "const d = (Array.isArray(d0) ? d0[0] : d0) || {};\n"
        msg = "T(d.result_message)"
        if message_from:
            body += "const m = [%s][0] || {};\n" % N(message_from, "data")
            msg = "T(m.result_message) || T(d.progress_message)"
        body += ("return { publish_route: \"%s\", job_id: [%s][0], job_status: T(d.job_status), result_code: T(d.result_code) || T(d.error_code), result_message: %s, "
                 "evidence: JSON.stringify({ v: 1, workflow: \"PICKING_BULK_COMMIT\", path: \"%s\", steps: steps }) };") % (path, N(G, "data.jobId"), msg, path)
        return K.code(nid, "Result (%s)" % path, body, res_fields)

    def ret(nid, src, title):
        return K.ret(nid, title, [(f, N(src, "data." + f)) for f in res_fields])

    def end_block(prefix, decider, steps, path, unlock=False):
        nodes = [gate(ids, "cor_%sjob" % prefix, "Job row to write?", decider, "needJobUpd", [job_update(ids, "update_node_%sjob" % prefix, "Job: retry with backoff / REQUIRES_REVIEW / FAILED (lease released)", decider)])]
        if unlock:
            nodes.append(gate(ids, "cor_%sunlock" % prefix, "Picking lock to release?", decider, "needUnlock", [unlock_update(ids, "update_node_%sunlock" % prefix, "Picking is_processing = 0", decider)]))
        nodes += [result("code_node_%sres" % prefix, path, decider, steps), ret("return_node_%s" % prefix, "code_node_%sres" % prefix, "Return (%s)" % path)]
        return nodes

    sql_job = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%%Y-%%m-%%d %%H:%%i:%%s') AS lease_until,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       j.command,
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
       j.picking_id,
       DATE_FORMAT(j.started_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS started_at,
       (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.is_deleted
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '%s'
   AND j.id = %s""" % (T, JOBID)
    sql_steps = """SELECT CAST(st.id AS CHAR) AS id,
       st.step_name,
       st.step_status
  FROM gd_publish_step st
 WHERE st.tenant_id = '%s'
   AND st.job_id = '%s'
   AND st.is_deleted = 0""" % (T, JOBID)
    sql_payload = """SELECT j.prepared_payload
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id = %s""" % (T, JOBID)
    sql_own = """SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.lease_owner,
       j.row_version
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id = %s""" % (T, JOBID)
    sql_p0 = """SELECT CAST('ROW' AS CHAR) AS kind,
       CAST(l.id AS CHAR) AS id,
       CAST(l.pending_process_qty AS CHAR) AS v1,
       CAST(l.line_status AS CHAR) AS v2
  FROM transfer_order_jz8m9w3h_sub l
 WHERE l.tenant_id = '%(T)s'
   AND l.transfer_order_id = %(PID)s
   AND l.is_deleted = 0
   AND l.id IN (%(ROWS)s)
UNION ALL
SELECT CAST('HDR' AS CHAR), CAST(t.id AS CHAR), CAST(t.to_status AS CHAR), CAST(t.is_processing AS CHAR)
  FROM transfer_order t
 WHERE t.tenant_id = '%(T)s'
   AND t.id = %(PID)s
   AND t.is_deleted = 0
UNION ALL
SELECT CAST('GD' AS CHAR), CAST(g.id AS CHAR), CAST(g.gd_status AS CHAR), CAST('' AS CHAR)
  FROM goods_delivery g
 WHERE g.tenant_id = '%(T)s'
   AND g.id IN (%(GDS)s)
   AND g.is_deleted = 0""" % {"T": T, "PID": PID, "ROWS": N(E, "data.rowIdsSql"), "GDS": N(E, "data.gdIdsSql")}
    sql_p1back = """SELECT (SELECT COUNT(*)
          FROM transfer_order_vrqs3cmr_sub r
         WHERE r.tenant_id = '%(T)s'
           AND r.transfer_order_id = %(PID)s
           AND r.is_deleted = 0
           AND r.job_line_key LIKE '%(LIKE)s') AS job_records,
       (SELECT COUNT(DISTINCT r.job_line_key)
          FROM transfer_order_vrqs3cmr_sub r
         WHERE r.tenant_id = '%(T)s'
           AND r.transfer_order_id = %(PID)s
           AND r.is_deleted = 0
           AND r.job_line_key LIKE '%(LIKE)s') AS job_keys,
       t.to_status
  FROM transfer_order t
 WHERE t.tenant_id = '%(T)s'
   AND t.id = %(PID)s""" % {"T": T, "PID": PID, "LIKE": N(G, "data.jobPrefixLike")}
    sql_p3facts = """SELECT CAST(l.id AS CHAR) AS id,
       l.temp_qty_data,
       l.picking_status
  FROM goods_delivery_fwii8mvb_sub l
 WHERE l.tenant_id = '%s'
   AND l.id IN (%s)
   AND l.is_deleted = 0""" % (T, N(E, "data.gdLineIdsSql"))
    sql_p3back = """SELECT CAST(l.id AS CHAR) AS id,
       l.picking_status
  FROM goods_delivery_fwii8mvb_sub l
 WHERE l.tenant_id = '%s'
   AND l.id IN (%s)
   AND l.is_deleted = 0""" % (T, N(E, "data.gdLineIdsSql"))
    # one statement: the touched GD lines as stored now + every record of them on any live Picking, with bin / batch / HU names
    sql_p3fp = """SELECT CAST('L' AS CHAR) AS kind,
       CAST(l.id AS CHAR) AS id,
       CAST(NULL AS CHAR) AS rid,
       CAST(l.gd_qty AS CHAR) AS gd_qty,
       CAST(l.material_id AS CHAR) AS material_id,
       CAST(l.plant_id AS CHAR) AS plant_id,
       CAST(l.organization_id AS CHAR) AS organization_id,
       CAST(l.picking_status AS CHAR) AS picking_status,
       CAST(l.picked_qty AS CHAR) AS picked_qty,
       CAST(l.temp_qty_data AS CHAR) AS temp_qty_data,
       CAST(l.prev_temp_qty_data AS CHAR) AS prev_temp_qty_data,
       CAST(l.picked_temp_qty_data AS CHAR) AS picked_temp_qty_data,
       CAST(l.picked_view_stock AS CHAR) AS picked_view_stock,
       CAST(l.view_stock AS CHAR) AS view_stock,
       CAST(NULL AS CHAR) AS qty,
       CAST(NULL AS CHAR) AS loc,
       CAST(NULL AS CHAR) AS batch,
       CAST(NULL AS CHAR) AS hu,
       CAST(NULL AS CHAR) AS loc_name,
       CAST(NULL AS CHAR) AS batch_name,
       CAST(NULL AS CHAR) AS hu_name
  FROM goods_delivery_fwii8mvb_sub l
 WHERE l.tenant_id = '%(T)s'
   AND l.id IN (%(LINES)s)
   AND l.is_deleted = 0
UNION ALL
SELECT CAST('R' AS CHAR),
       CAST(r.gd_line_id AS CHAR),
       CAST(r.id AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(r.store_out_qty AS CHAR),
       CAST(COALESCE(r.target_location, r.source_bin) AS CHAR),
       CAST(COALESCE(r.target_batch, r.batch_no) AS CHAR),
       CAST(r.handling_unit_id AS CHAR),
       CAST(COALESCE(NULLIF(b.bin_location_combine, ''), NULLIF(b.bin_name, '')) AS CHAR),
       CAST(bt.batch_number AS CHAR),
       CAST(h.handling_no AS CHAR)
  FROM transfer_order_vrqs3cmr_sub r
  JOIN transfer_order t
    ON t.id = r.transfer_order_id
   AND t.tenant_id = r.tenant_id
   AND t.is_deleted = 0
  LEFT JOIN bin_location b
    ON b.id = COALESCE(r.target_location, r.source_bin)
  LEFT JOIN batch bt
    ON bt.id = COALESCE(r.target_batch, r.batch_no)
  LEFT JOIN handling_unit h
    ON h.id = r.handling_unit_id
 WHERE r.tenant_id = '%(T)s'
   AND r.is_deleted = 0
   AND r.gd_line_id IN (%(LINES)s)""" % {"T": T, "LINES": N(E, "data.gdLineIdsSql")}
    sql_p4facts = """SELECT CAST('L' AS CHAR) AS kind,
       CAST(l.goods_delivery_id AS CHAR) AS gd_id,
       CAST(l.id AS CHAR) AS id,
       CAST(l.material_id AS CHAR) AS material_id,
       CAST(l.item_bundle_id AS CHAR) AS item_bundle_id,
       CAST(l.picking_status AS CHAR) AS picking_status,
       CAST(l.gd_qty AS CHAR) AS gd_qty,
       CAST('' AS CHAR) AS gd_status
  FROM goods_delivery_fwii8mvb_sub l
 WHERE l.tenant_id = '%(T)s'
   AND l.goods_delivery_id IN (%(GDS)s)
   AND l.is_deleted = 0
UNION ALL
SELECT CAST('H' AS CHAR), CAST(g.id AS CHAR), CAST(g.id AS CHAR), CAST('' AS CHAR), CAST('' AS CHAR), CAST(g.picking_status AS CHAR), CAST('' AS CHAR), CAST(g.gd_status AS CHAR)
  FROM goods_delivery g
 WHERE g.tenant_id = '%(T)s'
   AND g.id IN (%(GDS)s)
   AND g.is_deleted = 0""" % {"T": T, "GDS": N(E, "data.gdIdsAllSql")}
    sql_p4back = """SELECT CAST(g.id AS CHAR) AS id,
       g.picking_status
  FROM goods_delivery g
 WHERE g.tenant_id = '%s'
   AND g.id IN (%s)
   AND g.is_deleted = 0""" % (T, N(E, "data.gdIdsAllSql"))
    sql_p5hdr = """SELECT CAST(t.id AS CHAR) AS id,
       t.to_status,
       CAST(t.gd_no AS CHAR) AS gd_no_json,
       CAST(t.plant_id AS CHAR) AS plant_id,
       t.created_by,
       CAST(t.customer_id AS CHAR) AS customer_id_json,
       t.organization_id,
       %(DI)s
  FROM transfer_order t
 WHERE t.tenant_id = '%(T)s'
   AND t.id = %(PID)s
   AND t.is_deleted = 0""" % {"T": T, "PID": PID, "DI": ",\n       ".join(("CAST(t.%s AS CHAR) AS %s" % (k, k)) if k in ("di_vehicle_number", "di_freight_charges") else
                                                              ("DATE_FORMAT(t.%s, '%%%%Y-%%%%m-%%%%d %%%%H:%%%%i:%%%%s') AS %s" % (k, k)) if k in ("di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection") else
                                                              "t." + k for k in DI)}
    sql_p5lines = """SELECT CAST(l.gd_id AS CHAR) AS gd_id,
       l.gd_no,
       CAST(l.so_id AS CHAR) AS so_id,
       l.so_no,
       CAST(l.customer_id AS CHAR) AS customer_id,
       CAST(l.qty_to_pick AS CHAR) AS qty_to_pick,
       CAST(l.pending_process_qty AS CHAR) AS pending_process_qty,
       l.line_status,
       CAST(l.item_bundle_id AS CHAR) AS item_bundle_id,
       CAST(l.item_code AS CHAR) AS item_code,
       CAST(l.handling_unit_id AS CHAR) AS handling_unit_id,
       l.row_type
  FROM transfer_order_jz8m9w3h_sub l
 WHERE l.tenant_id = '%s'
   AND l.transfer_order_id = %s
   AND l.is_deleted = 0""" % (T, PID)
    sql_p5recs = """SELECT CAST(r.gd_line_id AS CHAR) AS gd_line_id,
       CAST(r.store_out_qty AS CHAR) AS store_out_qty,
       CAST(r.target_location AS CHAR) AS target_location,
       CAST(r.source_bin AS CHAR) AS source_bin,
       CAST(r.target_batch AS CHAR) AS target_batch,
       CAST(r.batch_no AS CHAR) AS batch_no,
       CAST(r.handling_unit_id AS CHAR) AS handling_unit_id
  FROM transfer_order_vrqs3cmr_sub r
 WHERE r.tenant_id = '%s'
   AND r.transfer_order_id = %s
   AND r.is_deleted = 0
   AND r.gd_id IN (%s)""" % (T, PID, N("code_node_PCp5chunk", "data.gdIdsCsv"))
    sql_p5rule = """SELECT (SELECT CAST(r.id AS CHAR)
          FROM su_code_serial_no_rule r
         WHERE r.tenant_id = '%(T)s'
           AND r.business_type = 'Packing'
           AND r.department_id = %(ORG)s
           AND r.is_deleted = 0
         ORDER BY r.is_draft, r.is_default DESC, r.id
         LIMIT 1) AS rule_id,
       (SELECT k.packing_mode
          FROM packing_setup k
         WHERE k.tenant_id = '%(T)s'
           AND k.organization_id = '%(ORG)s'
           AND k.is_deleted = 0
         ORDER BY k.id
         LIMIT 1) AS packing_mode""" % {"T": T, "ORG": N(E, "data.organizationId")}
    sql_p5back = """SELECT p.gd_id,
       COUNT(*) AS n
  FROM packing p
 WHERE p.tenant_id = '%s'
   AND p.gd_id IN (%s)
   AND p.is_deleted = 0
   AND COALESCE(p.packing_status, '') <> 'Cancelled'
 GROUP BY p.gd_id""" % (T, N("code_node_PCp5expect", "data.expectSql"))
    sql_back = """SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_message,
       j.error_code,
       j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id = %s""" % (T, JOBID)

    pick_props = [("id", N("code_node_PCp1merge", "data.pickRows.id")), ("to_status", N("code_node_PCp1merge", "data.pickRows.to_status")),
                  ("table_picking_items", N("code_node_PCp1merge", "data.pickRows.table_picking_items")),
                  ("table_picking_records", N("code_node_PCp1merge", "data.pickRows.table_picking_records"))] + \
                 [(k, N("code_node_PCp1merge", "data.pickRows." + k)) for k in PICK_HEADER]
    pack_add_props = [(p, N("code_node_PCp5build", "data.createRows." + p)) for p in
                      ["packing_status", "plant_id", "packing_no", "packing_no_type", "so_id", "so_no", "gd_id", "to_id", "gd_no", "customer_id", "organization_id",
                       "packing_mode", "created_at", "created_by", "remarks", "remarks_2", "remarks_3", "idempotency_key", "table_item_source", "table_hu_source"] + DI]
    pack_upd_props = [(p, "{{node:loop_PCp5upd.%s}}" % p) for p in ["table_item_source", "table_hu_source"] + DI]
    check_names = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"]
    A = ["code_node_PCguard", "code_node_PCentry", "code_node_PCown"]

    nodes = [
        K.code(G, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", code_file("commit/guard.js"),
               ["route", "jobId", "tenantId", "jobPrefixLike", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_PCreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            result("code_node_PCrejres", "REJECTED_INPUT", G, ["code_node_PCguard"]), ret("return_node_PCrej", "code_node_PCrejres", "Return (rejected input)")]),
        K.parallel("condition_all_PCfacts", "Facts in parallel: the job, its step rows, its prepared payload", [
            ("cai_PCjob", "Job", [K.sql("sql_node_PCjob", "Facts 1: the job (+ DB clock, lease flag, lease_until, due)", sql_job,
                                        ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count",
                                         "next_attempt_at", "lease_owner", "lease_expires_at", "lease_live", "row_version", "error_code", "error_message", "error_details",
                                         "picking_id", "started_at", "due", "is_deleted"])]),
            ("cai_PCsteps", "Steps", [K.sql("sql_node_PCsteps", "Facts 2: this job's step rows", sql_steps, ["id", "step_name", "step_status"])]),
            ("cai_PCpayload", "Payload", [K.sql("sql_node_PCpayload", "Facts 3: the prepared payload", sql_payload, ["prepared_payload"])]),
        ]),
        K.code(E, "Entry: what this run does (phase A: P0 P1 P3 P4 then SPLIT; phase B: P5 P6), the lease claim", code_file("commit/entry.js"),
               ["route", "phase", "dbNow", "jobId", "organizationId", "pickingId", "pickingNo", "jobStatus", "rowVersion", "attempts", "leaseUntil", "jobRows", "needJobUpd",
                "unlockRows", "needUnlock", "needP0", "needP1", "needP3", "needP3fp", "needP4", "needP5", "p3Passes", "rowIdsSql", "gdIdsSql", "gdIdsAllSql", "gdLineIdsSql",
                "plannedRecords", "plannedGdLines", "packingRequired", "result_code", "result_message", "job_status"], arrays=("jobRows", "unlockRows", "p3Passes")),
        K.if_(ids, "if_PCnowrite", "IF this run may not write: answer only", is_(E, "route", "NO_WRITE"), [
            result("code_node_PCnwres", "NO_WRITE", E, ["code_node_PCguard", "code_node_PCentry"]), ret("return_node_PCnw", "code_node_PCnwres", "Return (no write)")]),
        K.if_(ids, "if_PCentryend", "IF the payload is unusable: job FAILED (+ lock released) or REQUIRES_REVIEW", "%s || %s" % (is_(E, "route", "FAIL"), is_(E, "route", "REVIEW")),
              end_block("PCef", E, ["code_node_PCguard", "code_node_PCentry"], "ENTRY_END", unlock=True)),
        job_update(ids, "update_node_PCclaim", "Lease claim: job COMMITTING_PICKING, lease_owner = this run, lease_expires_at = now + 10 min", E,
                   props=JOB_PROPS + ["started_at"]),
        K.sql("sql_node_PCown", "Read-back: the job after the lease claim", sql_own, ["id", "job_status", "lease_owner", "row_version"]),
        K.code(O, "Own: COMMITTING_PICKING under this run's lease, else LOST", code_file("commit/own.js"), ["route", "jobStatus", "rowVersion", "result_code", "result_message"]),
        K.if_(ids, "if_PClost", "IF another run took the job: stop", is_(O, "route", "LOST"), [
            result("code_node_PClostres", "LOST", O, A), ret("return_node_PClost", "code_node_PClostres", "Return (lost)")]),
        # ------------------------------------------------------------------ P0
        K.if_(ids, "if_PCp0", "IF P0 REVALIDATE is due", is_(E, "needP0", "YES"), [
            K.sql("sql_node_PCp0facts", "P0 facts: the picked lines, the Picking header, the deliveries now", sql_p0, ["kind", "id", "v1", "v2"]),
            K.code("code_node_PCp0", "P0 REVALIDATE: unchanged since PREPARE -> DONE; else FAILED + lock released (nothing written)", code_file("commit/p0.js"),
                   ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message"], arrays=("stepRows", "jobRows", "unlockRows")),
            K.if_(ids, "if_PCp0fail", "IF the Picking changed meanwhile", is_("code_node_PCp0", "route", "FAIL"),
                  end_block("PCp0", "code_node_PCp0", A + ["code_node_PCp0"], "P0_STALE", unlock=True)),
            gate(ids, "cor_PCp0step", "P0 DONE to record?", "code_node_PCp0", "needStep", [step_add(ids, "add_node_PCp0step", "P0_REVALIDATE DONE (unique job / step)", "code_node_PCp0")]),
        ]),
        # ------------------------------------------------------------------ P1
        K.if_(ids, "if_PCp1", "IF P1 PICKING is due", is_(E, "needP1", "YES"), [
            K.get_node(ids, "get_node_PCp1get", "P1: the Picking as stored now (lines + records tree)", PICK, ("id", "in", PID)),
            K.code("code_node_PCp1merge", "P1 merge: stored Picking + prepared pick -> one update (records by job_line_key, absolute line values)", code_file("commit/p1_merge.js"),
                   ["route", "pickRows", "needWrite", "added", "kept", "toStatus", "result_code", "result_message"], arrays=("pickRows",)),
            gate(ids, "cor_PCp1write", "Picking to write?", "code_node_PCp1merge", "needWrite", [
                K.update(ids, "update_node_PCp1write", "P1 WRITE: the Picking (to_status, every line, every record, the header patch)", PICK, ("id", "in", N("code_node_PCp1merge", "data.pickRows.id")), pick_props)]),
            K.sql("sql_node_PCp1back", "P1 read-back: this job's records (by job_line_key) and the Picking status", sql_p1back, ["job_records", "job_keys", "to_status"]),
            K.code("code_node_PCp1check", "P1 check: every record once -> DONE; fewer -> retry; twice -> review", code_file("commit/p1_check.js"), check_names, arrays=("stepRows", "jobRows")),
            K.if_(ids, "if_PCp1end", "IF P1 did not complete", is_("code_node_PCp1check", "route", "END"), end_block("PCp1", "code_node_PCp1check", A + ["code_node_PCp1merge", "code_node_PCp1check"], "P1_END")),
            gate(ids, "cor_PCp1step", "P1 DONE to record?", "code_node_PCp1check", "needStep", [step_add(ids, "add_node_PCp1step", "P1_PICKING DONE", "code_node_PCp1check")]),
        ]),
        # ------------------------------------------------------------------ P3
        K.if_(ids, "if_PCp3", "IF P3 GD LINES is due", is_(E, "needP3", "YES"), [
            K.sql("sql_node_PCp3facts", "P3 facts: the touched GD lines now (their allocation)", sql_p3facts, ["id", "temp_qty_data", "picking_status"]),
            K.code("code_node_PCp3plan", "P3 plan: picking_status + prev_temp_qty_data per line, slices of <= 250", code_file("commit/p3_plan.js"),
                   ["rows", "batches", "count", "total", "missing", "result_message"], arrays=("rows", "batches")),
            K.set_cache("set_cache_PCp3idx0", "Slice index of P3 = 0 (per run: the key carries the run's nonce)", "pk_p3_" + N(G, "data.nonce"), "0"),
            K.loop(ids, "loop_PCp3", "Write the GD lines in slices of <= 250", N("code_node_PCp3plan", "data.batches"), [
                K.get_cache("get_cache_PCp3idx", "Slice index of P3", "pk_p3_" + N(G, "data.nonce")),
                K.code("code_node_PCp3slice", "Slice of P3: rows [index * 250, + 250)", code_file("commit/p3_slice.js"), ["rows", "index", "nextIndex", "count", "from"], arrays=("rows",)),
                K.update(ids, "update_node_PCp3write", "P3 WRITE: GD lines picking_status + prev_temp_qty_data (<= 250 per call)", GDL, ("id", "in", N("code_node_PCp3slice", "data.rows.id")),
                         [(p, N("code_node_PCp3slice", "data.rows." + p)) for p in ["id", "picking_status", "prev_temp_qty_data"]]),
                K.set_cache("set_cache_PCp3idxN", "Next slice index of P3", "pk_p3_" + N(G, "data.nonce"), N("code_node_PCp3slice", "data.nextIndex")),
            ]),
            K.sql("sql_node_PCp3back", "P3 read-back: the GD lines' picking_status", sql_p3back, ["id", "picking_status"]),
            K.code("code_node_PCp3check", "P3 check: every line reads back its status -> DONE; else retry", code_file("commit/p3_check.js"), check_names, arrays=("stepRows", "jobRows")),
            K.if_(ids, "if_PCp3end", "IF P3 did not complete", is_("code_node_PCp3check", "route", "END"), end_block("PCp3", "code_node_PCp3check", A + ["code_node_PCp3check"], "P3_END")),
            gate(ids, "cor_PCp3step", "P3 DONE to record?", "code_node_PCp3check", "needStep", [step_add(ids, "add_node_PCp3step", "P3_GD_LINES DONE", "code_node_PCp3check")]),
        ]),
        # ------------------------------------------------------------------ P3, Full Picking
        K.if_(ids, "if_PCp3fp", "IF P3 GD LINES is due under Full Picking: recount the touched GD lines from every Picking's records", is_(E, "needP3fp", "YES"), [
            K.set_cache("set_cache_PCp3fpSt0", "Recount state = [not settled, 0 passes, 0 written, 0 over] (per run: the key carries the run's nonce)", "pk_p3fp_" + N(G, "data.nonce"), "[0, 0, 0, 0]"),
            K.loop(ids, "loop_PCp3fp", "Recount passes (at most 4): read + write, until a read finds nothing to write", N(E, "data.p3Passes"), [
                K.get_cache("get_cache_PCp3fpSt", "Recount state", "pk_p3fp_" + N(G, "data.nonce")),
                K.code("code_node_PCp3fpGate", "Pass gate: settled -> skip the pass", code_file("commit/p3fp_gate.js"), ["route", "passes"]),
                K.if_(ids, "if_PCp3fpGo", "IF the recount has not settled: one pass", is_("code_node_PCp3fpGate", "route", "GO"), [
                    K.sql("sql_node_PCp3fpFacts", "P3 facts: the touched GD lines + every record of them on any Picking (+ bin / batch / HU names), one statement", sql_p3fp, ['kind', 'id', 'rid', 'gd_qty', 'material_id', 'plant_id', 'organization_id', 'picking_status', 'picked_qty', 'temp_qty_data', 'prev_temp_qty_data', 'picked_temp_qty_data', 'picked_view_stock', 'view_stock', 'qty', 'loc', 'batch', 'hu', 'loc_name', 'batch_name', 'hu_name']),
                    K.code("code_node_PCp3fpPlan", "P3 plan (Full Picking): recount -> the lines whose stored values differ, slices of <= 250; nothing to write = settled",
                           code_file("commit/p3fp_plan.js"), ["slices", "hasRows", "count", "lines", "state", "result_message"], arrays=("slices", "state")),
                    K.set_cache("set_cache_PCp3fpSt", "Recount state after this pass", "pk_p3fp_" + N(G, "data.nonce"), N("code_node_PCp3fpPlan", "data.state")),
                    gate(ids, "cor_PCp3fpWrite", "GD lines to write in this pass?", "code_node_PCp3fpPlan", "hasRows", [
                        K.loop(ids, "loop_PCp3fpSlices", "Write the GD lines in slices of <= 250", N("code_node_PCp3fpPlan", "data.slices"), [
                            K.code("code_node_PCp3fpSlice", "Slice of P3 (Full Picking): the loop's current rows", code_file("commit/p3fp_slice.js"), ["rows", "count"], arrays=("rows",)),
                            K.update(ids, "update_node_PCp3fpWrite", "P3 WRITE (Full Picking): picking_status, picked qty / bins / view, prev_temp_qty_data (<= 250 per call)", GDL,
                                     ("id", "in", N("code_node_PCp3fpSlice", "data.rows.id")),
                                     [(p, N("code_node_PCp3fpSlice", "data.rows." + p)) for p in ["id", "picking_status", "prev_temp_qty_data", "picked_qty", "picked_temp_qty_data", "picked_view_stock"]]),
                        ])]),
                ]),
            ]),
            K.get_cache("get_cache_PCp3fpEnd", "Recount state after the passes", "pk_p3fp_" + N(G, "data.nonce")),
            K.code("code_node_PCp3fpCheck", "P3 check (Full Picking): settled -> DONE; else retry", code_file("commit/p3fp_check.js"), check_names, arrays=("stepRows", "jobRows")),
            K.if_(ids, "if_PCp3fpEnd", "IF P3 did not complete", is_("code_node_PCp3fpCheck", "route", "END"), end_block("PCp3fp", "code_node_PCp3fpCheck", A + ["code_node_PCp3fpCheck"], "P3_END")),
            gate(ids, "cor_PCp3fpStep", "P3 DONE to record?", "code_node_PCp3fpCheck", "needStep", [step_add(ids, "add_node_PCp3fpStep", "P3_GD_LINES DONE", "code_node_PCp3fpCheck")]),
        ]),
        # ------------------------------------------------------------------ P4 (+ SPLIT)
        K.if_(ids, "if_PCp4", "IF P4 GD HEADERS is due (phase A ends here: SPLIT)", is_(E, "needP4", "YES"), [
            K.sql("sql_node_PCp4facts", "P4 facts: every line + header of every Goods Delivery on the Picking", sql_p4facts, ["kind", "gd_id", "id", "material_id", "item_bundle_id", "picking_status", "gd_qty", "gd_status"]),
            K.code("code_node_PCp4plan", "P4 plan: header picking_status = rollUpPicking(B3E0 rule) per delivery", code_file("commit/p4_plan.js"), ["rows", "need", "count", "skipped", "result_message"], arrays=("rows",)),
            gate(ids, "cor_PCp4write", "GD headers to write?", "code_node_PCp4plan", "need", [
                K.update(ids, "update_node_PCp4write", "P4 WRITE: Goods Delivery picking_status (header only - no GOODS_DELIVERY re-save)", GD, ("id", "in", N("code_node_PCp4plan", "data.rows.id")),
                         [(p, N("code_node_PCp4plan", "data.rows." + p)) for p in ["id", "picking_status"]], labels={"picking_status": "Picking Status"})]),
            K.sql("sql_node_PCp4back", "P4 read-back: the headers' picking_status", sql_p4back, ["id", "picking_status"]),
            K.code("code_node_PCp4check", "P4 check: DONE + the SPLIT hand-over lease; else retry", code_file("commit/p4_check.js"), check_names, arrays=("stepRows", "jobRows")),
            K.if_(ids, "if_PCp4end", "IF P4 did not complete", is_("code_node_PCp4check", "route", "END"), end_block("PCp4", "code_node_PCp4check", A + ["code_node_PCp4check"], "P4_END")),
            gate(ids, "cor_PCp4step", "P4 DONE to record?", "code_node_PCp4check", "needStep", [step_add(ids, "add_node_PCp4step", "P4_GD_HEADERS DONE", "code_node_PCp4check")]),
            gate(ids, "cor_PCsplit", "SPLIT hand-over to write?", "code_node_PCp4check", "needJobUpd", [job_update(ids, "update_node_PCsplit", "Job: SPLIT| hand-over lease (the next run does the Packing and the finish)", "code_node_PCp4check")]),
            result("code_node_PCsplitres", "SPLIT", "code_node_PCp4check", A + ["code_node_PCp4check"]),
            ret("return_node_PCsplit", "code_node_PCsplitres", "Return (SPLIT)"),
        ]),
        # ------------------------------------------------------------------ P5
        K.if_(ids, "if_PCp5", "IF P5 PACKING is due (packing required + auto trigger)", is_(E, "needP5", "YES"), [
            K.parallel("condition_all_PCp5a", "P5 facts: the Picking header and lines, the numbering rule", [
                ("cai_PCp5hdr", "Header", [K.sql("sql_node_PCp5hdr", "P5: the Picking header (status, deliveries, Delivery Info)", sql_p5hdr,
                                                 ["id", "to_status", "gd_no_json", "plant_id", "created_by", "customer_id_json", "organization_id"] + DI)]),
                ("cai_PCp5lines", "Lines", [K.sql("sql_node_PCp5lines", "P5: the Picking lines (picked = qty_to_pick - pending)", sql_p5lines,
                                                  ["gd_id", "gd_no", "so_id", "so_no", "customer_id", "qty_to_pick", "pending_process_qty", "line_status", "item_bundle_id", "item_code", "handling_unit_id", "row_type"])]),
                ("cai_PCp5rule", "Rule", [K.sql("sql_node_PCp5rule", "P5: the Packing numbering rule + packing mode of the organization", sql_p5rule, ["rule_id", "packing_mode"])]),
            ]),
            K.code("code_node_PCp5gate", "P5 gate: Completed? the picked deliveries in chunks of <= 25 (their HU / SO ids)", code_file("commit/p5_gate.js"),
                   ["route", "chunks", "chunkCount", "gdCount", "result_message"], arrays=("chunks",)),
            K.if_(ids, "if_PCp5go", "IF there is a Packing to fill", is_("code_node_PCp5gate", "route", "GO"), [
                K.set_cache("set_cache_PCp5acc0", "Packing tally = [no delivery, no failure] (per run: the key carries the run's nonce)", "pk_p5_" + N(G, "data.nonce"), "[[], []]"),
                K.loop(ids, "loop_PCp5chunks", "Each chunk of <= 25 deliveries: read, build, write", N("code_node_PCp5gate", "data.chunks"), [
                    K.code("code_node_PCp5chunk", "This chunk: its deliveries, HU and SO ids", code_file("commit/p5_chunk.js"),
                           ["gdIds", "huIds", "soIds", "gdIdsCsv", "groups", "count"], arrays=("gdIds", "huIds", "soIds"), objects=("groups",)),
                    search_in(ids, "search_node_PCp5gd", "P5: the chunk's Goods Deliveries (header + table_gd)", GD, "id", N("code_node_PCp5chunk", "data.gdIds"), 100),
                    search_in(ids, "search_node_PCp5pack", "P5: their Packings", PACK, "gd_id", N("code_node_PCp5chunk", "data.gdIds"), 100),
                    search_in(ids, "search_node_PCp5hu", "P5: the handling units of the chunk's picked lines", HU, "id", N("code_node_PCp5chunk", "data.huIds"), 500),
                    search_in(ids, "search_node_PCp5so", "P5: the sales orders of the chunk's picked lines", SO, "id", N("code_node_PCp5chunk", "data.soIds"), 100),
                    K.sql("sql_node_PCp5recs", "P5: this Picking's records of the chunk's deliveries (picked qty per GD line / bin / batch / HU)", sql_p5recs,
                          ["gd_line_id", "store_out_qty", "target_location", "source_bin", "target_batch", "batch_no", "handling_unit_id"]),
                    K.get_cache("get_cache_PCp5acc", "Packing tally so far", "pk_p5_" + N(G, "data.nonce")),
                    K.code("code_node_PCp5build", "P5 build: one Packing per delivery of the chunk - create (PKG|<gd_id>) or refresh; the tally", code_file("commit/p5_build.js"),
                           ["route", "createRows", "updateRows", "hasCreates", "hasUpdates", "acc", "result_message"], arrays=("createRows", "updateRows", "acc")),
                    K.set_cache("set_cache_PCp5acc", "Packing tally after this chunk", "pk_p5_" + N(G, "data.nonce"), N("code_node_PCp5build", "data.acc")),
                    gate(ids, "cor_PCp5create", "Packings to create?", "code_node_PCp5build", "hasCreates", [
                        K.add(ids, "add_node_PCp5create", "P5 WRITE: new Packing(s), <= 25 per call (packing_no issued + the rule, idempotency_key PKG|<gd_id>)", PACK, pack_add_props)]),
                    gate(ids, "cor_PCp5update", "Packings to refresh?", "code_node_PCp5build", "hasUpdates", [
                        K.loop(ids, "loop_PCp5upd", "Refresh each existing Packing", N("code_node_PCp5build", "data.updateRows"), [
                            K.update(ids, "update_node_PCp5upd", "P5 WRITE: the Packing's item / HU source and Delivery Info", PACK, ("id", "in", "{{node:loop_PCp5upd.existing_packing_id}}"), pack_upd_props)])]),
                ]),
                K.get_cache("get_cache_PCp5accEnd", "Packing tally of every chunk", "pk_p5_" + N(G, "data.nonce")),
                K.code("code_node_PCp5expect", "P5 tally: the deliveries that must now have a Packing; a chunk that could not be built", code_file("commit/p5_expect.js"),
                       ["route", "expectSql", "expectCount", "result_message"]),
                K.sql("sql_node_PCp5back", "P5 read-back: live Packings per delivery", sql_p5back, ["gd_id", "n"]),
                K.code("code_node_PCp5check", "P5 check: one live Packing per delivery -> DONE; else retry / review", code_file("commit/p5_check.js"),
                       check_names + ["unlockRows", "needUnlock"], arrays=("stepRows", "jobRows", "unlockRows")),
                K.if_(ids, "if_PCp5end", "IF P5 did not complete", is_("code_node_PCp5check", "route", "END"),
                      end_block("PCp5", "code_node_PCp5check", A + ["code_node_PCp5gate", "code_node_PCp5expect", "code_node_PCp5check"], "P5_END", unlock=True)),
                gate(ids, "cor_PCp5step", "P5 DONE to record?", "code_node_PCp5check", "needStep", [step_add(ids, "add_node_PCp5step", "P5_PACKING DONE", "code_node_PCp5check")]),
            ]),
        ]),
        # ------------------------------------------------------------------ P6
        K.if_(ids, "if_PCp6", "IF phase B: P6 FINISH", is_(E, "phase", "B"), [
            K.code("code_node_PCp6", "P6 FINISH: the Picking lock released, the job COMPLETED with the picker's message", code_file("commit/p6.js"),
                   ["unlockRows", "jobRows", "result_message"], arrays=("unlockRows", "jobRows")),
            unlock_update(ids, "update_node_PCp6unlock", "Picking is_processing = 0", "code_node_PCp6"),
            job_update(ids, "update_node_PCp6job", "Job COMPLETED (lease released)", "code_node_PCp6"),
            K.sql("sql_node_PCback", "Read-back: the job at the end", sql_back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
            result("code_node_PCdoneres", "DONE", "sql_node_PCback", A + ["code_node_PCp5gate", "code_node_PCp5expect", "code_node_PCp5check"], message_from="code_node_PCp6"),
            ret("return_node_PCdone", "code_node_PCdoneres", "Return (DONE)"),
        ]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a CONFIRM_PICKING job (READY_TO_COMMIT, or COMMITTING_PICKING to resume)")], res_fields, nodes)


# =============================================================================================== PICKING_ASYNC_WORKER
def build_worker():
    ids = K.Ids(1796200000000)
    G = "code_node_PWguard"
    T = N(G, "data.tenantId")
    res_fields = ["worker_route", "processed", "jobs", "job_id", "job_status", "result_code", "result_message", "picking_id", "evidence"]
    poll = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       x.id,
       x.organization_id,
       x.picking_id,
       x.job_status,
       x.progress_percent,
       x.progress_message,
       x.attempt_count,
       x.next_attempt_at,
       x.lease_owner,
       x.lease_expires_at,
       x.dead_lease,
       x.row_version,
       x.error_code,
       x.error_message,
       x.error_details,
       x.claim_id,
       x.claim_started_at,
       x.claim_owner
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN (SELECT CAST(j.id AS CHAR) AS id,
                    j.organization_id,
                    j.picking_id,
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
              WHERE j.tenant_id = '%(T)s'
                AND j.is_deleted = 0
                AND j.command = 'CONFIRM_PICKING'
                AND (%(JOB)s = 0 OR j.id = %(JOB)s)
                AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING')
                AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= NOW(3))
                AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW(3))
                AND (c.id IS NULL OR c.started_at <= NOW(3) - INTERVAL 10 MINUTE)
              ORDER BY j.create_time, j.id
              LIMIT 5) x
    ON 1 = 1""" % {"T": T, "JOB": N(G, "data.jobId")}
    tick = """SELECT DATE_FORMAT(n.t, '%%Y-%%m-%%d %%H:%%i:%%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%%Y-%%m-%%d %%H:%%i:%%s') AS lease_until,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       j.picking_id,
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
   AND cw.is_deleted = 0""" % {"T": T, "IDS": N("code_node_PWplan", "data.jobIdsSql")}
    final = """SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.attempt_count,
       j.lease_owner,
       j.error_code,
       j.error_message,
       j.picking_id
  FROM gd_async_job j
 WHERE j.tenant_id = '%s'
   AND j.id IN (%s)""" % (T, N("code_node_PWplan", "data.jobIdsSql"))
    JOBREF = N("code_node_PWpick", "data.jobId")

    def jobread(nid, title):
        return K.sql(nid, title, job_sql(T, JOBREF), JOB_SQL_COLS)

    def publish(prefix, mid_node, which, wf_title):
        """one PICKING_BULK_COMMIT call + its read-back + the worker's own write when the call wrote nothing"""
        resp, back, after = "code_node_PW%sResp" % prefix, "sql_node_PW%sBack" % prefix, "code_node_PW%sAfter" % prefix
        return [
            K.call(ids, "workflow_node_PW%s" % prefix, wf_title, "PICKING_BULK_COMMIT", IDS["PICKING_BULK_COMMIT"], [("job_id", JOBREF)]),
            K.code(resp, "The %s response, normalized (evidence; the job row decides)" % which,
                   code_file("worker/callee.js", {"__WHAT__": which, "__NODE__": "workflow_node_PW%s" % prefix, "\"__EXTRA__\"": "\"publish_route\""}),
                   ["called", "job_id", "job_status", "result_code", "result_message", "publish_route"]),
            jobread(back, "Read-back: the job after the %s (the truth)" % which),
            K.code(after, "After the %s: COMMIT wrote the job itself; the worker writes only when nothing was saved" % which,
                   code_file("worker/after_publish.js", {"__WHICH__": which, "__MID__": mid_node, "__RESP__": resp, "__BACK__": back}),
                   ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "publishRoute", "result_code", "result_message", "job_status"],
                   arrays=("jobRows", "unlockRows")),
            gate(ids, "cor_PW%sJob" % prefix, "Job row to write after the %s?" % which, after, "needJobUpd", [job_update(ids, "update_node_PW%sJob" % prefix, "Job: FAILED (a hard code) / retry with backoff (lease released)", after)]),
            gate(ids, "cor_PW%sUnlock" % prefix, "Picking lock to release after the %s?" % which, after, "needUnlock", [unlock_update(ids, "update_node_PW%sUnlock" % prefix, "Picking is_processing = 0 (nothing was saved)", after)]),
        ]

    plan_ref = "[%s][0]" % N("code_node_PWplan", "data")
    nodes = [
        K.code(G, "Guard: optional job_id, session tenant, this run's lease owner WRK|<nonce>", code_file("worker/guard.js"),
               ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_PWreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_PWrejres", "Result (REJECTED_INPUT)", code_file("worker/result.js", {"__PATH__": "REJECTED_INPUT", "__PLAN__": "null", "__ROWS__": "[]"}), res_fields),
            K.ret("return_node_PWrej", "Return (invalid input)", [(f, N("code_node_PWrejres", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_PWpoll", "Poll: the due CONFIRM_PICKING jobs of the tenant (at most 5, oldest first; lease expired or never set; backoff over; no live claim row) + DB clock", poll,
              ["db_now", "id", "organization_id", "picking_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
               "lease_expires_at", "dead_lease", "row_version", "error_code", "error_message", "error_details", "claim_id", "claim_started_at", "claim_owner"]),
        K.code("code_node_PWplan", "Plan: the loop's items (the due jobs with their claim facts), the run start", code_file("worker/plan.js"),
               ["route", "dbNow", "runStart", "items", "count", "jobIdsSql", "result_code", "result_message"], arrays=("items",)),
        K.set_cache("set_cache_PWidx0", "Loop index = 0 (per run: the key carries this run's nonce)", "pk_wrk_" + N(G, "data.nonce"), "0"),
        K.loop(ids, "loop_PWjobs", "Loop over the planned jobs (in order; a lost claim gate ends the tick, the rest wait for the next)", N("code_node_PWplan", "data.items"), [
            K.get_cache("get_cache_PWidx", "Loop index", "pk_wrk_" + N(G, "data.nonce")),
            K.sql("sql_node_PWtick", "Tick: the FRESH read of the planned jobs (state, lease, backoff, claim row) + the lease end of a claim made now", tick,
                  ["db_now", "lease_until", "id", "organization_id", "picking_id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
                   "lease_owner", "lease_expires_at", "lease_live", "dead_lease", "due_now", "row_version", "error_code", "error_message", "error_details", "claim_id",
                   "claim_started_at", "claim_owner", "claim_live"]),
            K.code("code_node_PWpick", "Pick: the item by index; SKIP after the budget / not due / live lease / live claim; the claim gate rows", code_file("worker/pick.js"),
                   ["route", "index", "nextIndex", "dbNow", "leaseUntil", "elapsed", "jobId", "organizationId", "pickingId", "item", "rvBase", "rvRows", "needRvUpd", "claimName",
                    "claimRows", "needClaimAdd", "result_message"], arrays=("rvRows", "claimRows"), objects=("item",)),
            gate(ids, "cor_PWrv", "Dead claim to move past (row_version = v + 1)?", "code_node_PWpick", "needRvUpd", [
                job_update(ids, "update_node_PWrv", "Job: row_version = v + 1 and the retry count (absolute)", "code_node_PWpick", "rvRows", ["id", "row_version", "attempt_count"])]),
            gate(ids, "cor_PWclaimAdd", "Claim row to insert?", "code_node_PWpick", "needClaimAdd", [
                step_add(ids, "add_node_PWclaim", "CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> (unique tenant / job / step: a twin's insert fails and its run ends)", "code_node_PWpick", "claimRows")]),
            K.code("code_node_PWclaim", "Claim: the lease / state write; a dead lease or claim = one retry; exhausted after max_retries", code_file("worker/claim.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "pickingId", "rowVersion", "attempts", "claimRows", "needClaim", "failRows", "unlockRows", "exhausted",
                    "result_code", "result_message", "job_status"], arrays=("claimRows", "failRows", "unlockRows")),
            gate(ids, "cor_PWlease", "Lease / state to write?", "code_node_PWclaim", "needClaim", [
                job_update(ids, "update_node_PWlease", "Lease write: WRK|<nonce> for 10 min, VALIDATING for a QUEUED job, the retry count", "code_node_PWclaim", "claimRows")]),
            jobread("sql_node_PWown", "Read-back: the job after the lease write"),
            K.code("code_node_PWown", "Own: state and lease as written -> PREPARE / PUBLISH / RESUME / EXHAUST; else LOST", code_file("worker/own.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "pickingId", "attempts", "failRows", "unlockRows", "needFail", "needUnlock", "rowVersion",
                    "result_code", "result_message", "job_status"], arrays=("failRows", "unlockRows")),
            gate(ids, "cor_PWfail", "Exhausted: job row to write?", "code_node_PWown", "needFail", [
                job_update(ids, "update_node_PWfail", "Job FAILED (pre-commit) / REQUIRES_REVIEW (COMMITTING_PICKING)", "code_node_PWown", "failRows")]),
            gate(ids, "cor_PWfailUnlock", "Exhausted pre-commit: Picking lock to release?", "code_node_PWown", "needUnlock", [
                unlock_update(ids, "update_node_PWfailUnlock", "Picking is_processing = 0 (nothing was saved)", "code_node_PWown")]),
            K.if_(ids, "if_PWprep", "IF the job is pre-commit under this run's lease: the ONE PICKING_BULK_PREPARE call", is_("code_node_PWown", "route", "PREPARE"), [
                K.call(ids, "workflow_node_PWprep", "PICKING_BULK_PREPARE (set-based reads; writes the job + releases the lock on FAILED)", "PICKING_BULK_PREPARE", IDS["PICKING_BULK_PREPARE"], [("job_id", JOBREF)]),
                K.code("code_node_PWprepResp", "The prepare response, normalized (evidence; the job row decides)",
                       code_file("worker/callee.js", {"__WHAT__": "prepare", "__NODE__": "workflow_node_PWprep", "\"__EXTRA__\"": "\"line_count\""}),
                       ["called", "job_id", "job_status", "result_code", "result_message", "line_count"]),
                jobread("sql_node_PWprepBack", "Read-back: the job after prepare (the truth)"),
                K.code("code_node_PWafterPrep", "After prepare: READY_TO_COMMIT -> publish; FAILED -> lease released; else a hard code fails it / a counted retry", code_file("worker/after_prepare.js"),
                       ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "prepareResult", "prepareMessage", "result_code", "result_message", "job_status"],
                       arrays=("jobRows", "unlockRows")),
                gate(ids, "cor_PWprepJob", "Job row to write after prepare?", "code_node_PWafterPrep", "needJobUpd", [
                    job_update(ids, "update_node_PWprepJob", "Job: lease released / FAILED / retry with backoff", "code_node_PWafterPrep")]),
                gate(ids, "cor_PWprepUnlock", "Picking lock to release after prepare?", "code_node_PWafterPrep", "needUnlock", [
                    unlock_update(ids, "update_node_PWprepUnlock", "Picking is_processing = 0 (nothing was saved)", "code_node_PWafterPrep")]),
            ]),
            jobread("sql_node_PWmid", "The job before the publish decision"),
            K.code("code_node_PWmid", "Before publish: READY_TO_COMMIT under this run's lease, or COMMITTING_PICKING with no live lease -> PUBLISH", code_file("worker/mid.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_PWpub", "IF the job is to be published / resumed: the ONE PICKING_BULK_COMMIT call", is_("code_node_PWmid", "route", "PUBLISH"),
                  publish("pub", "code_node_PWmid", "publish", "PICKING_BULK_COMMIT (phase A: revalidate, Picking, GD lines, GD headers; or phase B on a resume)")),
            jobread("sql_node_PWsplit", "The job after the publish call (the split decision)"),
            K.code("code_node_PWsplit", "Second publish: COMMITTING_PICKING under a SPLIT| hand-over lease -> PUBLISH again", code_file("worker/split.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_PWpub2", "IF PICKING_BULK_COMMIT ended SPLIT: the second call (Packing + finish)", is_("code_node_PWsplit", "route", "PUBLISH"),
                  publish("pub2", "code_node_PWsplit", "second publish", "PICKING_BULK_COMMIT again after its SPLIT (phase B: Packing, finish)")),
            K.set_cache("set_cache_PWidxN", "Next loop index", "pk_wrk_" + N(G, "data.nonce"), N("code_node_PWpick", "data.nextIndex")),
        ]),
        K.sql("sql_node_PWfinal", "Read-back: the planned jobs (final)", final, ["id", "job_status", "attempt_count", "lease_owner", "error_code", "error_message", "picking_id"]),
        K.code("code_node_PWresult", "Result (DONE)", code_file("worker/result.js", {"__PATH__": "DONE", "__PLAN__": plan_ref, "__ROWS__": "[%s][0]" % N("sql_node_PWfinal", "data")}), res_fields),
        K.ret("return_node_PWdone", "Return the tick's result", [(f, N("code_node_PWresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "optional: gd_async_job.id (digits) to drive this job only (the form's kick after a submit); empty under Quartz: the oldest due jobs of the session tenant (at most 5 per tick)")],
                      res_fields, nodes)


def adopt_keys(new, old):
    """Keep the deployed file's response_json keys wherever the node and the field are the same: the builder's keys come from
    one seeded sequence, so a change re-keys every node built after it."""
    def index(doc):
        out = {}
        def walk(n):
            if isinstance(n, dict):
                d = n.get("data")
                if isinstance(n.get("id"), str) and isinstance(d, dict) and isinstance(d.get("response_json"), list):
                    for r in d["response_json"]:
                        out[(n["id"], r.get("name"))] = r
                for v in n.values():
                    walk(v)
            elif isinstance(n, list):
                for v in n:
                    walk(v)
        walk(doc)
        for part in ("request_json", "response_json"):
            for r in doc.get(part, []):
                out[(part, r.get("name"))] = r
        return out
    o = index(old)
    adopted = set()
    for k, r in index(new).items():
        if k in o and o[k].get("bsonType") == r.get("bsonType"):
            r["key"] = o[k]["key"]
            adopted.add(id(r))
            for oc, nc in zip(o[k].get("children") or [], r.get("children") or []):
                if "key" in oc and "key" in nc:
                    nc["key"] = oc["key"]
                    adopted.add(id(nc))
    entries = []
    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("key"), str) and "bsonType" in n:
                entries.append(n)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(new)
    # a fresh key comes from the same seeded sequence as the deployed ones: re-key a new entry that collides
    used = set(e["key"] for e in entries if id(e) in adopted)
    K._taken.update(used)
    for e in entries:
        if id(e) in adopted:
            continue
        if e["key"] in used:
            e["key"] = K.key()
        used.add(e["key"])
    keys = [e["key"] for e in entries]
    assert len(keys) == len(set(keys)), "duplicate response_json key"


BUILDERS = [("PICKING_ASYNC_SUBMIT", build_submit), ("PICKING_ASYNC_WORKER", build_worker), ("PICKING_BULK_PREPARE", build_prepare), ("PICKING_BULK_COMMIT", build_commit)]

if __name__ == "__main__":
    # keys come from one seeded sequence, so a change to one workflow re-keys the ones built after it: write only the
    # workflows named on the command line (the others are deployed as they are)
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    os.makedirs(OUT, exist_ok=True)
    for name, fn in BUILDERS:
        doc = fn()
        seen = K.check_ids(doc)
        path = OUT + name + ".json"
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old is not None:
            adopt_keys(doc, json.loads(old))
        text = render(doc, "min")
        state = "new" if old is None else ("same" if old == text else "changed")
        print("%-22s %3d nodes  %8d bytes  %s" % (name, len(seen), len(text), state))
        if WRITE and state != "same" and name in only:
            open(path, "w", encoding="utf-8").write(text)
    if not WRITE:
        print("(dry run: --write to save)")
