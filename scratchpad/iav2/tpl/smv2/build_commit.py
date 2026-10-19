"""LOT_V2_COMMIT (package C; CONTRACT.md sections 4, 5, 9, 10, 14): executes PREPARE's manifest as resumable steps.

Phase A: L0 REVALIDATE (stored lines at the request's lineFingerprint, In Transit rows at their before-values; the entry checks
the lock), L1 INVENTORY (ONE INVENTORY_BULK_APPLY APPLY, operation SMLT|<job>; skipped without movements), then the SPLIT /
PARK hand-over. Phase B: L2 LINES (COMPLETE / EDIT, and DIRECT / STAGE with an ALLOC part: one whole-subform update), L3 LEDGER
(in_transit_detail, slices of 250), L4 FINISH (Item dates, the header's final status = the unlock), then the job COMPLETED. Every
step reads its part and the rows now, writes only what is still at its before-value, reads back and records an L<n> DONE row
(step framework of scratchpad/pwv2 + grv2 commit, GD's lockWait).

usage: python3 build_lot.py [--write] LOT_V2_COMMIT
"""
import hashlib
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


FP_LINES = _load(os.path.join(HERE, "code", "shared", "sql.py"), "lot_shared_sql").FP_LINES
N, gate, call, job_update, step_add, sub, is_ = V.N, V.gate, V.call, V.job_update, V.step_add, V.sub, V.is_
LOT = "Location Transfer:Table:2013791389687349250"
LOT_LABELS = {"stock_movement_status": "Stock Movement Status"}
RES = V.RES_FIELDS
CG, CE = "code_node_LCguard", "code_node_LCentry"
# the steps this build has (the entry refuses a job needing another one before any write: LOT_STEP_NOT_BUILT)
BUILT = ["L0", "L1", "L2", "L3", "L4"]
# update_node_TxDhhT03's props minus stock_movement_status (CONTRACT section 5, S|..|LINES)
L2_HEADER = ["issuing_operation_faci", "issue_date", "movement_type", "movement_type_id", "movement_reason", "issued_by", "reference_documents", "organization_id",
             "project_id", "is_production_order", "production_order_id", "remarks", "remark", "remark2", "remark3"]
# the classic in-transit writers' columns (CONTRACT section 5, IT)
# V2.1 bundles: the stored line columns a DIRECT / STAGE rewrite sends back (the line schema's fields that are columns, minus the
# platform's audit / tenant / parent-document columns: a column missing from a written row is stored NULL)
L2_LINE_COLS = ["id", "item_selection", "item_name", "item_desc", "requested_qty", "total_quantity", "quantity_uom", "storage_location_id", "location_id",
                "stock_summary", "item_remark", "item_remark2", "item_remark3", "balance_id", "organization_id", "line_index", "temp_qty_data", "temp_hu_data",
                "temp_excess_data", "uom_options", "issuing_plant", "receiving_plant", "is_serialized_item", "is_serial_allocated", "project_id", "item_bundle_id",
                "bundle_ratio", "parent_id"]
LINE_SQL = {c: "CAST(l.%s AS CHAR)" % c for c in ["id", "requested_qty", "total_quantity", "quantity_uom", "storage_location_id", "location_id", "issuing_plant",
                                                   "receiving_plant", "project_id", "bundle_ratio", "parent_id"]}
HDR_SQL = {"issuing_operation_faci": "CAST(g.issuing_operation_faci AS CHAR)", "issue_date": "DATE_FORMAT(g.issue_date, '%Y-%m-%d %H:%i:%s')",
           "project_id": "CAST(g.project_id AS CHAR)", "production_order_id": "CAST(g.production_order_id AS CHAR)"}
IT_SETS = {"recon": ("reconSlices", "RECON (update_node_LOTreconAdjust's columns)", ["transit_qty", "open_qty", "status"]),
           "main": ("mainSlices", "MAIN (update_node_LOTmainClose's columns)", ["received_qty", "open_qty", "status", "received_date"]),
           "cancel": ("cancelSlices", "CANCEL (update_node_LOTcancelClose's columns)", ["open_qty", "status"]),
           "fold": ("foldSlices", "FOLD (an adjust then a close)", ["transit_qty", "received_qty", "open_qty", "status", "received_date"])}
IT_ADD_COLS = V.IT_COLS + ["received_date", "job_line_key"]
SHARED = {"common": "code/shared/lot_common.js", "fp": "code/shared/fingerprint.js", "movekey": "code/shared/movekey.js"}


def ccode(name, shared=(), subs=None):
    parts = [V.include_js(HERE, SHARED["common"])] + [V.include_js(HERE, SHARED[x]) for x in shared]
    parts += [V.raw(HERE, "code/commit/_common.js"), V.raw(HERE, "code/commit/_cmp.js"), V.raw(HERE, "code/commit/" + name)]
    body = "\n".join(parts)
    for a, b in (subs or {}).items():
        assert a in body, (name, a)
        body = body.replace(a, b)
    left = re.findall(r"__[A-Z]+__", body)
    assert not left, (name, left)
    assert "{{" not in V.include_js(HERE, SHARED["common"])
    return body


RESULT_JS = "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\n"


def declare_field(doc, node_id, name, after):
    """adds the string output `name` to a built code node's response_json right after `after`, with a key derived from the node
    id (no draw from wfkit's key stream: no other key of this or a later workflow moves)"""
    found = []
    keys = set()

    def walk(n):
        if isinstance(n, dict):
            if n.get("id") == node_id and n.get("type") == "code-node":
                found.append(n)
            if isinstance(n.get("key"), str):
                keys.add(n["key"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    assert len(found) == 1, (node_id, len(found))
    rj = found[0]["data"]["response_json"]
    names = [r["name"] for r in rj]
    assert name not in names and after in names, (node_id, name, after)
    key = "js" + hashlib.md5((node_id + "|" + name).encode()).hexdigest()[:6]
    assert key not in keys, key
    rj.insert(names.index(after) + 1, {"key": key, "name": name, "title": name, "description": "", "bsonType": "string", "isExpand": False, "children": []})
    return doc


def cres(tag, src, path):
    body = RESULT_JS + V.raw(HERE, "code/commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [K.code("code_node_LC%sres" % tag, "Result (%s)" % path, body, RES),
            K.ret("return_node_LC%s" % tag, "Return (%s)" % path, [(f, N("code_node_LC%sres" % tag, "data." + f)) for f in RES])]


def unlock(ids, nid, title, src, field="unlockRows"):
    return V.status_unlock(LOT, "stock_movement_status", LOT_LABELS)(ids, nid, title, src, field)


def end_a(ids, tag, src, title):
    """phase A (no stock moved yet): the transfer back to its status before the save, then the job row"""
    nodes = [gate(ids, "cor_LC%sunlock" % tag, "Transfer lock to release?", src, "needUnlock", [
                 unlock(ids, "update_node_LC%sunlock" % tag, "Location Transfer back to its status before the save (no stock was moved)", src)]),
             gate(ids, "cor_LC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
                 job_update(ids, "update_node_LC%sjob" % tag, "Job: wait / retry with backoff / FAILED / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_LC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def end_b(ids, tag, src, title):
    """phase B (the stock moved): retry with backoff or REQUIRES_REVIEW - never back"""
    nodes = [gate(ids, "cor_LC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
        job_update(ids, "update_node_LC%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_LC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def commit_sql():
    T, JOB = N(CG, "data.tenantId"), N(CG, "data.jobId")
    LOTID, ORG, PFX, SPFX = N(CE, "data.lotId"), N(CE, "data.organizationId"), N(CE, "data.partPrefix"), N(CE, "data.sPartPrefix")
    TOK = dict(T=T, JOB=JOB)
    req = lambda key, alias: "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.%s')), NULL) AS %s" % (key, alias)
    S = {}
    S["job"] = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.progress_percent, j.progress_message, j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at, j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live, (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted, j.line_count,
       @PREV,
       @ACTION,
       @SAVEAS,
       @NONCE,
       @LINEFP,
       @INFP
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB""", PREV=req("prevStatus", "prev_status"), ACTION=req("action", "req_action"), SAVEAS=req("saveAs", "req_save_as"), NONCE=req("nonce", "req_nonce"),
                   LINEFP=req("lineFingerprint", "line_fp"), INFP=req("incomingFingerprint", "incoming_fp"), **TOK)
    S["steps"] = sub("SELECT st.step_name, st.step_status FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' AND st.step_name REGEXP '^L[0-9]_' "
                     "AND st.is_deleted = 0", **TOK)
    S["payload"] = sub("SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["lot"] = sub("""SELECT CAST(g.id AS CHAR) AS lot_id, g.stock_movement_status, CAST(g.lot_v2_job_id AS CHAR) AS lot_v2_job_id,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('SMLT|', SUBSTRING(j.correlation_id, 5)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN sm_location_transfer g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 5) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.id = @JOB AND j.correlation_id REGEXP '^LOT\\\\|[0-9]{1,20}$'""", **TOK)
    S["sparts"] = sub("SELECT st.step_name, CHAR_LENGTH(st.result_ref) AS chars FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                      "AND st.step_name LIKE 'S|%' AND st.is_deleted = 0 ORDER BY st.step_name", **TOK)
    S["own"] = sub("SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["part"] = lambda name: sub("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                                 "AND st.step_name LIKE CONCAT('@PFX', '@NAME|%') AND st.is_deleted = 0 ORDER BY st.step_name", PFX=PFX, NAME=name, **TOK)
    S["spart"] = sub("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                     "AND st.step_name LIKE CONCAT('@SPFX', 'LINES|%') AND st.is_deleted = 0 ORDER BY st.step_name", SPFX=SPFX, **TOK)
    S["intents"] = sub("SELECT COUNT(*) AS intents FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = 'SMLT|@JOB' AND st.step_name LIKE 'IBA|I|%' "
                       "AND st.is_deleted = 0", **TOK)
    S["lines"] = sub(FP_LINES, T=T, LOT=LOTID)
    anchor = "'item_bundle_id', l.item_bundle_id) AS j"
    assert FP_LINES.count(anchor) == 1
    S["linesq"] = sub(FP_LINES.replace(anchor, "'item_bundle_id', l.item_bundle_id, 'total_quantity', CAST(l.total_quantity AS CHAR)) AS j"), T=T, LOT=LOTID)
    S["linesfull"] = sub("SELECT JSON_OBJECT(" + ", ".join("'%s', %s" % (c, LINE_SQL.get(c, "l." + c)) for c in L2_LINE_COLS) + """) AS j
  FROM sm_location_transfer_d2c7o1jd_sub l
 WHERE l.tenant_id = '@T'
   AND l.sm_location_transfer_id = @LOTID
   AND l.is_deleted = 0
 ORDER BY l.id""", LOTID=LOTID, **TOK)
    S["hdr15"] = sub("SELECT JSON_OBJECT(" + ", ".join("'%s', %s" % (c, HDR_SQL.get(c, "g." + c)) for c in L2_HEADER) + """) AS j
  FROM sm_location_transfer g
 WHERE g.tenant_id = '@T'
   AND g.id = @LOTID
   AND g.is_deleted = 0""", LOTID=LOTID, **TOK)
    S["ledger"] = sub("""SELECT JSON_OBJECT('id', CAST(t.id AS CHAR), 'job_line_key', t.job_line_key, 'status', t.status, 'transit_qty', t.transit_qty,
       'received_qty', t.received_qty, 'open_qty', t.open_qty, 'received_date', DATE_FORMAT(t.received_date, '%Y-%m-%d %H:%i:%s')) AS j
  FROM in_transit_detail t
 WHERE t.tenant_id = '@T'
   AND t.doc_id = '@LOTID'
   AND t.organization_id = '@ORG'
   AND t.is_deleted = 0
 ORDER BY t.id""", LOTID=LOTID, ORG=ORG, **TOK)
    S["hdr"] = sub("SELECT g.stock_movement_status, g.stock_movement_no FROM sm_location_transfer g WHERE g.tenant_id = '@T' AND g.id = @LOTID AND g.is_deleted = 0",
                   LOTID=LOTID, **TOK)
    return S


def build():
    ids = K.Ids(1799200000000)
    S = commit_sql()
    sq = lambda nid, title, key, cols=("j",): K.sql(nid, title, S[key], list(cols))
    part = lambda nid, title, name: K.sql(nid, title, S["part"](name), ["step_name", "result_ref"])
    br = lambda tag, items: K.parallel("condition_all_LC%s" % tag, "Reads in parallel", [("cai_LC%s%d" % (tag, i), t, [n]) for i, (t, n) in enumerate(items)])
    pick = lambda node, keys: "{ " + ", ".join("%s: [%s][0]" % (k, N(node, "data." + k)) for k in keys) + " }"
    entry_fields = ["route", "phase", "dbNow", "jobId", "tenantId", "organizationId", "lotId", "lotNo", "action", "prevStatus", "saveAs", "lineFingerprint", "incomingFingerprint",
                    "lineCount", "idempotencyKey", "jobStatus", "rowVersion", "attempts", "leaseUntil", "unlockOk", "partPrefix", "sPartPrefix", "jobRows", "needJobUpd",
                    "unlockRows", "needUnlock", "needL0", "needL1", "needL2", "needL2Full", "hasAlloc", "needL3", "needL4", "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows")
    rej_body = RESULT_JS + V.raw(HERE, "code/commit/result.js") + "\nreturn commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");" % (
        N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    E = "[%s][0]" % N(CE, "data")
    L0, L1I, L1A, L1 = "code_node_LCl0", "code_node_LCl1in", "code_node_LCl1ans", "code_node_LCl1"
    L2P, L2C, L3P, L3C, L4P, L4C, FIN = "code_node_LCl2plan", "code_node_LCl2check", "code_node_LCl3plan", "code_node_LCl3check", "code_node_LCl4plan", "code_node_LCl4check", "code_node_LCfinish"
    l3_sets = [K.loop(ids, "loop_LCl3%s" % tag, "L3 WRITE: In Transit rows %s, <= 250 per call" % title, N(L3P, "data." + field), [
        K.code("code_node_LCl3%sslice" % tag, "This slice (the loop item: <= 250 rows)", V.raw(HERE, "code/commit/slice.js").replace("__LOOP__", "loop_LCl3%s" % tag), ["n", "rows"],
               arrays=("rows",), objects=("n",)),
        K.update(ids, "update_node_LCl3%swrite" % tag, "L3 WRITE: in_transit_detail %s by id" % title, V.IT, ("id", "in", N("code_node_LCl3%sslice" % tag, "data.rows.id")),
                 [(p, N("code_node_LCl3%sslice" % tag, "data.rows." + p)) for p in ["id"] + cols])])
        for tag, (field, title, cols) in IT_SETS.items()]
    nodes = [
        K.code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"),
               ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_LCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            K.code("code_node_LCrejres", "Result (REJECTED_INPUT)", rej_body, RES),
            K.ret("return_node_LCrej", "Return (rejected input)", [(f, N("code_node_LCrejres", "data." + f)) for f in RES])]),
        K.parallel("condition_all_LCfacts", "Facts in parallel: the job (+ its request), its L step rows, its manifest, the transfer's lock, its S part names", [
            ("cai_LCjob", "Job", [K.sql("sql_node_LCjob", "The job (+ DB clock, lease flag, lease_until, due; request: prevStatus, action, saveAs, nonce, fingerprints)", S["job"],
                ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                 "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted",
                 "line_count", "prev_status", "req_action", "req_save_as", "req_nonce", "line_fp", "incoming_fp"])]),
            ("cai_LCsteps", "Steps", [K.sql("sql_node_LCsteps", "This job's L step rows", S["steps"], ["step_name", "step_status"])]),
            ("cai_LCpayload", "Manifest", [K.sql("sql_node_LCpayload", "The prepared manifest", S["payload"], ["prepared_payload"])]),
            ("cai_LClot", "Transfer + lock", [K.sql("sql_node_LClot", "The transfer's status, its V2 job and its latest LOCK row", S["lot"], ["lot_id", "stock_movement_status", "lot_v2_job_id", "lock_ref"])]),
            ("cai_LCsparts", "S parts", [K.sql("sql_node_LCsparts", "SUBMIT's S| part rows of the job (names + sizes only: COMPLETE / EDIT need the LINES part before L1)", S["sparts"],
                                               ["step_name", "chars"])]),
        ]),
        K.code(CE, "Entry: what this run does (phase A: L0 L1, SPLIT / PARK; phase B: L2 L3 L4, COMPLETED), the lease claim", ccode("entry.js", subs={"__BUILT__": json.dumps(BUILT)}),
               entry_fields, arrays=("jobRows", "unlockRows"), objects=("rowVersion", "attempts", "lineCount")),
        K.if_(ids, "if_LCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_LCentryend", "IF the manifest is unusable, the transfer lost its lock or a step is missing: FAILED (+ back) or REQUIRES_REVIEW",
              "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
                  gate(ids, "cor_LCefunlock", "Transfer lock to release?", CE, "needUnlock", [unlock(ids, "update_node_LCefunlock", "Location Transfer back to its status before the save", CE)]),
                  gate(ids, "cor_LCefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_LCefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows")]),
              ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_LCclaim", "Lease claim: job COMMITTING_LOT, lease_owner = this run, lease_expires_at = now + 10 min", CE, "jobRows"),
        K.sql("sql_node_LCown", "Read-back: the job after the lease claim", S["own"], ["id", "job_status", "lease_owner", "row_version"]),
        K.code("code_node_LCown", "Own: COMMITTING_LOT under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_LClost", "IF another run took the job: stop", is_("code_node_LCown", "route", "LOST"), cres("lost", "code_node_LCown", "LOST")),
        # ---------------------------------------------------------------- L0
        K.if_(ids, "if_LCl0", "IF L0 REVALIDATE is due", is_(CE, "needL0", "YES"), [
            br("l0read", [("IT part", part("sql_node_LCl0it", "L0: the IT part", "IT")),
                          ("Lines", sq("sql_node_LCl0lines", "L0: the stored lines (FP_LINES: what lotLineFingerprint reads)", "lines")),
                          ("Ledger", sq("sql_node_LCl0ledger", "L0: the transfer's In Transit rows now (doc_id, organization)", "ledger"))]),
            K.code(L0, "L0 REVALIDATE: stored lines at the request's lineFingerprint, every planned In Transit update at before -> DONE; else FAILED + back", ccode("l0.js", ("fp",)),
                   chk, arrays=chk_arr),
            end_a(ids, "l0", L0, "IF the transfer changed meanwhile (FAILED)"),
            V.step_done(ids, "LC", "l0", L0, "L0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- L1
        K.if_(ids, "if_LCl1", "IF L1 INVENTORY is due (phase A ends here: SPLIT / PARK)", is_(CE, "needL1", "YES"), [
            part("sql_node_LCl1part", "L1: the ENGINE part", "ENGINE"),
            K.code(L1I, "L1: the operation key and the movements (none -> no call)", ccode("l1_in.js"), ["ok", "needCall", "operationKey", "movements", "keys", "why"],
                   arrays=("movements", "keys")),
            gate(ids, "cor_LCl1call", "Stock to move?", L1I, "needCall", [
                call(ids, "workflow_node_LCl1", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; SMLT|<job> replays on a re-run)", V.ENGINE, [
                    ("operation_key", N(L1I, "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")),
                    ("movements", N(L1I, "data.movements"))])]),
            K.code(L1A, "L1: the engine's answer (409: read its intent rows; 400: read the LABELS part)", ccode("l1_ans.js"),
                   ["code", "result_code", "message", "need409", "need400"]),
            gate(ids, "cor_LCl1ops", "409: the engine's intent rows to count?", L1A, "need409", [
                sq("sql_node_LCl1ops", "L1: this operation's engine intent rows (any = it may have written)", "intents", ["intents"])]),
            gate(ids, "cor_LCl1lab", "400: the LABELS part to read?", L1A, "need400", [part("sql_node_LCl1labels", "L1: the LABELS part (movement_key -> line, item, bin)", "LABELS")]),
            K.code(L1, "L1 check: 200 / no movement -> DONE + SPLIT or PARK; 409 -> wait, then FAILED + back (review with intent rows); 400 -> FAILED + back (mapped); else review",
                   ccode("l1.js", ("movekey",)), chk + ["splitRows", "needSplit", "path"], arrays=chk_arr + ("splitRows",)),
            end_a(ids, "l1", L1, "IF the stock did not move"),
            V.step_done(ids, "LC", "l1", L1, "L1_INVENTORY"),
            gate(ids, "cor_LCsplit", "SPLIT / PARK hand-over to write?", L1, "needSplit", [
                job_update(ids, "update_node_LCsplit", "Job: SPLIT| hand-over lease (the worker calls phase B now) or PARK (due now, no lease: the next tick); attempt_count 0", L1, "splitRows")]),
        ] + cres("split", L1, "SPLIT")),
        # ---------------------------------------------------------------- L2
        K.if_(ids, "if_LCl2", "IF L2 LINES is due (COMPLETE / EDIT; DIRECT / STAGE with an ALLOC part)", is_(CE, "needL2", "YES"), [
            br("l2read", [("S LINES part", K.sql("sql_node_LCl2part", "L2: SUBMIT's S|<nonce>|LINES part", S["spart"], ["step_name", "result_ref"])),
                          ("ALLOC part", part("sql_node_LCl2alloc", "L2: the ALLOC part (V2.1: auto-allocated picks by line id)", "ALLOC")),
                          ("Lines", sq("sql_node_LCl2lines", "L2: the stored lines now (FP_LINES + total_quantity)", "linesq"))]),
            gate(ids, "cor_LCl2full", "DIRECT / STAGE with an ALLOC part: the stored lines whole?", CE, "needL2Full", [
                br("l2full", [("Lines whole", sq("sql_node_LCl2full", "L2: the stored lines with every column (the rewrite sends them back)", "linesfull")),
                              ("Header", sq("sql_node_LCl2hdr", "L2: the header's update_node_TxDhhT03 columns (written back as stored)", "hdr15"))])]),
            K.code(L2P, "L2 plan: the S lines (+ ALLOC picks) or the stored lines + ALLOC picks -> the one whole-subform write; done / else review", ccode("l2.js", ("fp",), {
                "__HEADER__": json.dumps(L2_HEADER), "__CALL__": "commitL2Plan(%s, [%s][0], [%s][0], [%s][0], [%s][0], [%s][0])" % (
                    E, N("sql_node_LCl2part", "data"), N("sql_node_LCl2alloc", "data"), N("sql_node_LCl2lines", "data"), N("sql_node_LCl2full", "data"),
                    N("sql_node_LCl2hdr", "data"))}),
                ["route", "row", "needWrite", "lineCount", "expect", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"], arrays=("jobRows",),
                objects=("row", "lineCount", "expect")),
            end_b(ids, "l2pl", L2P, "IF the lines cannot be written"),
            gate(ids, "cor_LCl2write", "Lines to write?", L2P, "needWrite", [
                K.update(ids, "update_node_LCl2write", "L2 WRITE: the transfer's header props + the whole stock_movement subform (update_node_TxDhhT03's props minus status)", LOT,
                         ("id", "in", N(L2P, "data.row.id")), [(p, N(L2P, "data.row." + p)) for p in L2_HEADER + ["stock_movement"]])]),
            sq("sql_node_LCl2back", "L2 read-back: the stored lines (FP_LINES + total_quantity)", "linesq"),
            K.code(L2C, "L2 check: the lines read back at the target (+ the ALLOC picks, each child under its parent) -> DONE", ccode("l2.js", ("fp",), {
                "__HEADER__": json.dumps(L2_HEADER), "__CALL__": "commitL2Check(%s, %s, [%s][0])" % (E, pick(L2P, ["expect"]), N("sql_node_LCl2back", "data"))}), chk, arrays=chk_arr),
            end_b(ids, "l2", L2C, "IF L2 did not complete"),
            V.step_done(ids, "LC", "l2", L2C, "L2_LINES"),
        ]),
        # ---------------------------------------------------------------- L3
        K.if_(ids, "if_LCl3", "IF L3 LEDGER is due", is_(CE, "needL3", "YES"), [
            br("l3read", [("IT part", part("sql_node_LCl3it", "L3: the IT part", "IT")),
                          ("Ledger", sq("sql_node_LCl3ledger", "L3: the transfer's In Transit rows now (doc_id, organization)", "ledger"))]),
            K.code(L3P, "L3 plan: updates by id at before -> their columns, creates not found by job_line_key -> add; at after = done; else review", ccode("l3.js", (), {
                "__ADDCOLS__": json.dumps(IT_ADD_COLS), "__CALL__": "commitL3Plan(%s, [%s][0], [%s][0])" % (E, N("sql_node_LCl3it", "data"), N("sql_node_LCl3ledger", "data"))}),
                ["route", "reconSlices", "mainSlices", "cancelSlices", "foldSlices", "addSlices", "updCount", "addCount", "expect", "jobRows", "needJobUpd", "result_code", "result_message",
                 "job_status"], arrays=("reconSlices", "mainSlices", "cancelSlices", "foldSlices", "addSlices", "jobRows"), objects=("updCount", "addCount", "expect")),
            end_b(ids, "l3pl", L3P, "IF the In Transit ledger cannot be written"),
        ] + l3_sets + [
            V.slice_loop(ids, "LC", "l3a", L3P, "addSlices", "L3 WRITE: new in_transit_detail rows (add_node_LOTmainCreate / LOTreconCreate columns + job_line_key)", V.IT, IT_ADD_COLS,
                         V.raw(HERE, "code/commit/slice.js"), add=True),
            sq("sql_node_LCl3back", "L3 read-back: the transfer's In Transit rows", "ledger"),
            K.code(L3C, "L3 check: every update at after, every create once -> DONE", ccode("l3.js", (), {
                "__ADDCOLS__": json.dumps(IT_ADD_COLS), "__CALL__": "commitL3Check(%s, %s, [%s][0])" % (E, pick(L3P, ["expect"]), N("sql_node_LCl3back", "data"))}), chk, arrays=chk_arr),
            end_b(ids, "l3", L3C, "IF L3 did not complete"),
            V.step_done(ids, "LC", "l3", L3C, "L3_LEDGER"),
        ]),
        # ---------------------------------------------------------------- L4
        K.if_(ids, "if_LCl4", "IF L4 FINISH is due", is_(CE, "needL4", "YES"), [
            br("l4read", [("HDR part", part("sql_node_LCl4hdr", "L4: the HDR part", "HDR")), ("ITEMS part", part("sql_node_LCl4items", "L4: the ITEMS part", "ITEMS")),
                          ("Header", sq("sql_node_LCl4now", "L4: the transfer's status and number now", "hdr", ["stock_movement_status", "stock_movement_no"]))]),
            K.code(L4P, "L4 plan: header at after -> done; at before (Processing) -> Item dates in slices, then the header's final status (+ the cancel number)", ccode("l4.js", (), {
                "__CALL__": "commitL4Plan(%s, [%s][0], [%s][0], [%s][0])" % (E, N("sql_node_LCl4hdr", "data"), N("sql_node_LCl4items", "data"), N("sql_node_LCl4now", "data"))}),
                ["route", "after", "statusRows", "needStatus", "numberRows", "needNumber", "itemSlices", "itemCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                arrays=("statusRows", "numberRows", "itemSlices", "jobRows"), objects=("after", "itemCount")),
            end_b(ids, "l4pl", L4P, "IF the transfer cannot be finished"),
            V.slice_loop(ids, "LC", "l4i", L4P, "itemSlices", "L4 WRITE: Item last_transaction_date (code_node_0njluBVP's value)", V.ITEM, ["last_transaction_date"],
                         V.raw(HERE, "code/commit/slice.js")),
            gate(ids, "cor_LCl4status", "Final status to write?", L4P, "needStatus", [
                K.update(ids, "update_node_LCl4status", "L4 WRITE: the transfer's final status (Completed / In Progress) - its Processing lock ends", LOT, ("id", "in", N(L4P, "data.statusRows.id")),
                         [(p, N(L4P, "data.statusRows." + p)) for p in ["id", "stock_movement_status"]], labels=LOT_LABELS)]),
            gate(ids, "cor_LCl4number", "Cancelled status + number to write?", L4P, "needNumber", [
                K.update(ids, "update_node_LCl4number", "L4 WRITE: Cancelled + the '-Cancelled' number (update_node_u5YASPXU's columns) - its Processing lock ends", LOT,
                         ("id", "in", N(L4P, "data.numberRows.id")), [(p, N(L4P, "data.numberRows." + p)) for p in ["id", "stock_movement_status", "stock_movement_no"]],
                         labels=LOT_LABELS)]),
            sq("sql_node_LCl4back", "L4 read-back: the transfer's status and number", "hdr", ["stock_movement_status", "stock_movement_no"]),
            K.code(L4C, "L4 check: the header at after -> DONE", ccode("l4.js", (), {
                "__CALL__": "commitL4Check(%s, %s, [%s][0])" % (E, pick(L4P, ["after"]), N("sql_node_LCl4back", "data"))}), chk, arrays=chk_arr),
            end_b(ids, "l4", L4C, "IF L4 did not complete"),
            V.step_done(ids, "LC", "l4", L4C, "L4_FINISH"),
        ]),
        # ---------------------------------------------------------------- finish
        K.code(FIN, "FINISH: the job COMPLETED (the header write was the unlock)", ccode("finish.js"), ["jobRows", "result_message"], arrays=("jobRows",)),
        job_update(ids, "update_node_LCdone", "Job COMPLETED (lease released)", FIN, "jobRows"),
    ] + cres("done", FIN, "DONE")
    doc = K.workflow([("job_id", "string", "gd_async_job.id (digits) of a SAVE_LOT job (READY_TO_COMMIT, or COMMITTING_LOT to resume)")], RES, nodes)
    left = re.findall(r"__[A-Z]+__", json.dumps(doc, ensure_ascii=False))
    assert not left, left
    return declare_field(doc, CE, "jsAt", "dbNow")


BUILDERS = [("LOT_V2_COMMIT", build)]
