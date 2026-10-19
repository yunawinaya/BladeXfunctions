"""SA_V2_COMMIT (package C; CONTRACT.md sections 2, 4, 5, 9, 10, 14): executes PREPARE's manifest as resumable steps.
Copied from tpl/smv2/build_commit.py (LOT_V2_COMMIT) and de-LOT-ed.

Phase A (nothing moved until A2): A0 REVALIDATE (FORM: the stored lines at the plan's fingerprints; REVIEW: the Stock Count's
lines at scFingerprint, no other Processing SA of it; the entry checks the lock), A1 SA LINES (REVIEW / edited COMPLETE: one
whole-subform update), A2 INVENTORY (ONE INVENTORY_BULK_APPLY APPLY, operation SAC|<job>), then the SPLIT / PARK hand-over.
Phase B (never unlocks): A3 STOCK COUNT (REVIEW: the SC part's one update; FORM with stock_count_id: classic parity), A4 FINISH
(Item dates in slices, the A4_REORDER marker then REORDER_SET_REDIS at most once, the header Completed = the unlock), then
the job COMPLETED. Every step reads its part and the rows now, writes only what is still at its before-value, reads back
and records an A<n> DONE row (step framework of tpl/smv2 code/commit/_common.js + _cmp.js; GD's lockWait).

usage: python3 build_commit.py [--write]      (or through the controller's build_sa.py)
"""
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


_SQL = _load(os.path.join(HERE, "code", "shared", "sql.py"), "sa_shared_sql")
FP_SA_LINES, FP_SC_LINES = _SQL.FP_SA_LINES, _SQL.FP_SC_LINES
IDS = json.load(open(os.path.join(HERE, "ids.json")))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "Stock Adjustment", "AsyncV2")
N, gate, call, job_update, step_add, is_ = V.N, V.gate, V.call, V.job_update, V.step_add, V.is_
SA = "Stock Adjustment:Table:%s" % IDS["tables"]["Stock Adjustment"]
SC = "Stock Count:Table:%s" % IDS["tables"]["Stock Count"]
SCL = "Adjustment Details(Stock Count):Table:%s" % IDS["tables"]["Adjustment Details(Stock Count)"]
SA_LABELS = {"stock_adjustment_status": "Stock Adjustment Status"}
SC_LABELS = {"stock_count_status": "Stock Count Status", "review_status": "Review Status", "adjustment_status": "Adjustment Status"}
ENGINE = ("INVENTORY_BULK_APPLY", IDS["INVENTORY_BULK_APPLY"])
REORDER = ("REORDER_SET_REDIS", IDS["REORDER_SET_REDIS"])
RES = V.RES_FIELDS
CG, CE = "code_node_SACguard", "code_node_SACentry"
# update_node_bYNSsj0v's header props minus stock_adjustment_status / adjustment_no / adjustment_no_type (CONTRACT section 7
# COMPLETE, section 9 A1: a number prop written by the worker's session would issue a second number)
SA_HDR = ["plant_id", "adjustment_date", "adjustment_type", "stock_count_id", "adjusted_by", "organization_id", "project_id", "acc_integration_type", "reference_documents",
          "adjustment_remarks", "adjustment_remarks2", "adjustment_remarks3", "posted_status"]
# every column of stock_adjustment_1dknywqh_sub a row carries (base/columns.json minus id, the parent key and the system columns;
# = the SA form's line fields): a key left out of a whole-subform update is stored NULL
SA_LINE_COLS = ["material_id", "material_name", "material_desc", "adjustment_reason", "total_quantity", "uom_id", "unit_price", "adj_summary", "adjustment_remarks", "balance_index",
                "line_index", "plant_id", "item_category", "is_single_serial", "is_serialized_item", "item_remark", "item_remark2", "item_remark3", "project_id"]
# update_node_sc's props (base/STOCK_COUNT.v10.json) minus stock_count_no / stock_count_no_type (CONTRACT section 5 SC)
SC_PROPS = ["id", "stock_count_status", "plant_id", "organization_id", "count_type", "count_method", "item_list", "start_date", "end_date", "assignees", "user_assignees",
            "work_group_assignees", "blind_count", "total_counted", "total_variance", "review_status", "adjustment_status", "stock_count_remark", "stock_count_remark2",
            "stock_count_remark3", "attachment", "previous_status", "table_stock_count"]
SHARED = {"common": "code/shared/sa_common.js", "fp": "code/shared/fingerprint.js", "movekey": "code/shared/movekey.js"}
A1ERR = """SELECT i.current_node_id, LEFT(i.error_msg, 2000) AS error_msg
  FROM su_code_workflow_inst i
 WHERE i.workflow_id = @WFID
   AND i.tenant_id = '@T'
   AND i.is_deleted = 0
   AND i.status = 'Fail'
   AND i.current_node_id IN ('update_node_SACa1full', 'update_node_SACa1lines')
   AND i.create_time >= (SELECT j.create_time FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB)
   AND i.request_json_data LIKE '%"job_id":"@JOB"%'
 ORDER BY i.id DESC
 LIMIT 1"""


def include_shared(rel):
    """a code/shared file for a code node WITHOUT its trailing node-test export statement. lib/v2build.include_js drops only the
    lines that start with "if (typeof module", but sa_common.js's export statement spans two lines: its dangling continuation
    line would be a SyntaxError in every node"""
    text = V.raw(HERE, rel)
    at = text.find("\nif (typeof module")
    if at >= 0:
        tail = text[at + 1:]
        assert tail.rstrip().endswith("};") and "module.exports" in tail and tail.count(";") == 1, (rel, tail[:200])
        text = text[:at]
    assert "{{" not in text and "module.exports" not in text, rel
    return text


def ccode(name, shared=(), subs=None):
    parts = [include_shared(SHARED["common"])] + [include_shared(SHARED[x]) for x in shared]
    parts += [V.raw(HERE, "code/commit/_common.js"), V.raw(HERE, "code/commit/_cmp.js"), V.raw(HERE, "code/commit/" + name)]
    body = "\n".join(parts)
    for a, b in (subs or {}).items():
        assert a in body, (name, a)
        body = body.replace(a, b)
    left = re.findall(r"__[A-Z]+__", body)
    assert not left, (name, left)
    return body


RESULT_JS = "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\n"


def code(nid, title, body, names, arrays=(), objects=()):
    """K.code, with the script's closing `return res;` spelled out as exactly the declared keys: the platform keeps only those
    anyway, and the linter then reads this return (not a helper's object literal from code/shared) as the node's output"""
    body = body.rstrip()
    assert body.endswith("\nreturn res;"), (nid, body[-60:])
    body = body[: -len("return res;")] + "return { " + ", ".join("%s: res.%s" % (n, n) for n in names) + " };"
    return K.code(nid, title, body, names, arrays=arrays, objects=objects)


def cres(tag, src, path):
    body = RESULT_JS + V.raw(HERE, "code/commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [code("code_node_SAC%sres" % tag, "Result (%s)" % path, body, RES),
            K.ret("return_node_SAC%s" % tag, "Return (%s)" % path, [(f, N("code_node_SAC%sres" % tag, "data." + f)) for f in RES])]


def unlock(ids, nid, title, src, field="unlockRows"):
    return V.status_unlock(SA, "stock_adjustment_status", SA_LABELS)(ids, nid, title, src, field)


def end_a(ids, tag, src, title):
    """phase A (no stock moved yet): the Stock Adjustment back to its status before the completion, then the job row"""
    nodes = [gate(ids, "cor_SAC%sunlock" % tag, "Stock Adjustment lock to release?", src, "needUnlock", [
                 unlock(ids, "update_node_SAC%sunlock" % tag, "Stock Adjustment back to its status before the completion (Draft / Cancelled; no stock was moved)", src)]),
             gate(ids, "cor_SAC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
                 job_update(ids, "update_node_SAC%sjob" % tag, "Job: wait / retry with backoff / FAILED / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_SAC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def end_b(ids, tag, src, title):
    """phase B (the stock moved): retry with backoff or REQUIRES_REVIEW - never back"""
    nodes = [gate(ids, "cor_SAC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
        job_update(ids, "update_node_SAC%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_SAC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def commit_sql():
    T, JOB = N(CG, "data.tenantId"), N(CG, "data.jobId")
    SAID, SCID, PFX = N(CE, "data.saId"), N(CE, "data.scId"), N(CE, "data.partPrefix")
    TOK = dict(T=T, JOB=JOB)
    req = lambda key, alias: "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.%s')), NULL) AS %s" % (key, alias)
    S = {}
    S["job"] = V.sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 30 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.progress_percent, j.progress_message, j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at, j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live, (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due,
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted, j.line_count,
       @PREV,
       @ACTION,
       @SOURCE,
       @EDITED,
       @SCID
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB""", PREV=req("prevStatus", "prev_status"), ACTION=req("action", "req_action"), SOURCE=req("source", "req_source"), EDITED=req("edited", "req_edited"),
                     SCID=req("scId", "req_sc_id"), **TOK)
    S["steps"] = V.sub("SELECT st.step_name, st.step_status FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' AND st.step_name REGEXP '^A[0-9]_' "
                       "AND st.is_deleted = 0", **TOK)
    S["payload"] = V.sub("SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["sa"] = V.sub("""SELECT CAST(g.id AS CHAR) AS sa_id, g.stock_adjustment_status, CAST(g.sa_v2_job_id AS CHAR) AS sa_v2_job_id, g.adjustment_no,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('SAC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN stock_adjustment g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.id = @JOB AND j.correlation_id REGEXP '^SA\\\\|[0-9]{1,20}$'""", **TOK)
    S["own"] = V.sub("SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["part"] = lambda name: V.sub("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                                   "AND st.step_name LIKE CONCAT('@PFX', '@NAME|%') AND st.is_deleted = 0 ORDER BY st.step_name", PFX=PFX, NAME=name, **TOK)
    S["intents"] = V.sub("SELECT COUNT(*) AS intents FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = 'SAC|@JOB' AND st.step_name LIKE 'IBA|I|%' "
                         "AND st.is_deleted = 0", **TOK)
    S["salines"] = V.sub(FP_SA_LINES, T=T, SA=SAID)
    S["sahdr"] = V.sub("""SELECT JSON_OBJECT('id', CAST(g.id AS CHAR), 'stock_adjustment_status', g.stock_adjustment_status, 'adjustment_no', g.adjustment_no,
       'plant_id', CAST(g.plant_id AS CHAR), 'adjustment_date', DATE_FORMAT(g.adjustment_date, '%Y-%m-%d %H:%i:%s'), 'adjustment_type', g.adjustment_type,
       'stock_count_id', CAST(g.stock_count_id AS CHAR), 'adjusted_by', g.adjusted_by, 'organization_id', g.organization_id, 'project_id', CAST(g.project_id AS CHAR),
       'acc_integration_type', g.acc_integration_type, 'reference_documents', g.reference_documents, 'adjustment_remarks', g.adjustment_remarks,
       'adjustment_remarks2', g.adjustment_remarks2, 'adjustment_remarks3', g.adjustment_remarks3, 'posted_status', g.posted_status) AS j
  FROM stock_adjustment g
 WHERE g.tenant_id = '@T'
   AND g.id = @SAID
   AND g.is_deleted = 0""", SAID=SAID, **TOK)
    S["sclines"] = V.sub(FP_SC_LINES, T=T, SC=SCID)
    # A0 reads the Stock Count only for a REVIEW (a FORM job's a0ScId is 0: no row)
    A0SC = N(CE, "data.a0ScId")
    S["a0sclines"] = V.sub(FP_SC_LINES, T=T, SC=A0SC)
    S["schdr"] = V.sub("""SELECT JSON_OBJECT('id', CAST(c.id AS CHAR), 'stock_count_no', c.stock_count_no, 'stock_count_status', c.stock_count_status,
       'review_status', c.review_status, 'adjustment_status', c.adjustment_status) AS j
  FROM stock_count c
 WHERE c.tenant_id = '@T'
   AND c.id = @SCID
   AND c.is_deleted = 0""", SCID=SCID, **TOK)
    S["scother"] = V.sub("""SELECT COUNT(*) AS other
  FROM stock_adjustment g
 WHERE g.tenant_id = '@T'
   AND g.stock_count_id = @SCID
   AND g.stock_adjustment_status = 'Processing'
   AND g.is_deleted = 0
   AND g.id <> @SAID""", SCID=A0SC, SAID=SAID, **TOK)
    # the platform's own error of the pass whose A1 write died (the run stops at the failing node: its su_code_workflow_inst row
    # names the node and keeps the error, e.g. the NULL sub_tenant_id cascade); read only on a pass after an A1_TRY marker.
    # Index (workflow_id, tenant_id, is_deleted, create_time); workflow_id = SA_V2_COMMIT's shell id (ids.json; "0" -> no row)
    S["a1err"] = V.sub(A1ERR, WFID=IDS["SA_V2_COMMIT"] if re.match(r"^[0-9]{1,20}$", IDS["SA_V2_COMMIT"]) else "0", **TOK)
    return S


def build():
    K._rng.seed(20261016)  # this workflow's response_json keys do not depend on what else was built before it
    ids = K.Ids(1799400000000)
    S = commit_sql()
    sq = lambda nid, title, key, cols=("j",): K.sql(nid, title, S[key], list(cols))
    part = lambda nid, title, name: K.sql(nid, title, S["part"](name), ["step_name", "result_ref"])
    br = lambda tag, items: K.parallel("condition_all_SAC%s" % tag, "Reads in parallel", [("cai_SAC%s%d" % (tag, i), t, [n]) for i, (t, n) in enumerate(items)])
    pick = lambda node, keys: "{ " + ", ".join("%s: [%s][0]" % (k, N(node, "data." + k)) for k in keys) + " }"
    entry_fields = ["route", "phase", "dbNow", "jsAt", "jobId", "tenantId", "organizationId", "saId", "saNo", "scId", "action", "source", "prevStatus", "lineFingerprint", "incomingFingerprint",
                    "scFingerprint", "scAfterFingerprint", "entryCount", "idempotencyKey", "jobStatus", "rowVersion", "attempts", "leaseUntil", "unlockOk", "partPrefix", "doneReorder", "triedA1", "a0ScId",
                    "jobRows", "needJobUpd", "unlockRows", "needUnlock", "needA0", "needA1", "needA2", "needA3R", "needA3P", "needA4", "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows")
    rej_body = RESULT_JS + V.raw(HERE, "code/commit/result.js") + "\nconst res = commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");\nreturn res;" % (
        N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    E = "[%s][0]" % N(CE, "data")
    A0, A1P, A1C = "code_node_SACa0", "code_node_SACa1plan", "code_node_SACa1check"
    A2I, A2A, A2 = "code_node_SACa2in", "code_node_SACa2ans", "code_node_SACa2"
    A3RP, A3RC, A3PP, A3PC = "code_node_SACa3rplan", "code_node_SACa3rcheck", "code_node_SACa3pplan", "code_node_SACa3pcheck"
    A4P, A4C, FIN = "code_node_SACa4plan", "code_node_SACa4check", "code_node_SACfinish"
    slice_js = V.raw(HERE, "code/commit/slice.js")
    a1 = lambda call: ccode("a1.js", ("fp",), {"__HEADER__": json.dumps(SA_HDR), "__LINECOLS__": json.dumps(SA_LINE_COLS), "__CALL__": call})
    a3 = lambda call: ccode("a3.js", ("fp",), {"__SCPROPS__": json.dumps(SC_PROPS), "__CALL__": call})
    a4 = lambda call: ccode("a4.js", (), {"__CALL__": call})
    nodes = [
        code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"),
               ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_SACreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            code("code_node_SACrejres", "Result (REJECTED_INPUT)", rej_body, RES),
            K.ret("return_node_SACrej", "Return (rejected input)", [(f, N("code_node_SACrejres", "data." + f)) for f in RES])]),
        K.parallel("condition_all_SACfacts", "Facts in parallel: the job (+ its request), its A step rows, its manifest, the Stock Adjustment's status and lock", [
            ("cai_SACjob", "Job", [K.sql("sql_node_SACjob", "The job (+ DB clock, lease flag, lease_until, due; request: prevStatus, action, source, edited, scId)", S["job"],
                ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                 "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted",
                 "line_count", "prev_status", "req_action", "req_source", "req_edited", "req_sc_id"])]),
            ("cai_SACsteps", "Steps", [K.sql("sql_node_SACsteps", "This job's A step rows (A0_ .. A4_, the A4_REORDER marker)", S["steps"], ["step_name", "step_status"])]),
            ("cai_SACpayload", "Manifest", [K.sql("sql_node_SACpayload", "The prepared manifest", S["payload"], ["prepared_payload"])]),
            ("cai_SACsa", "Stock Adjustment + lock", [K.sql("sql_node_SACsa", "The Stock Adjustment's status, its V2 job and its latest SAC| LOCK row", S["sa"],
                                                            ["sa_id", "stock_adjustment_status", "sa_v2_job_id", "adjustment_no", "lock_ref"])]),
        ]),
        code(CE, "Entry: what this run does (phase A: A0 A1 A2, SPLIT / PARK; phase B: A3 A4, COMPLETED), the lease claim", ccode("entry.js"),
               entry_fields, arrays=("jobRows", "unlockRows"), objects=("rowVersion", "attempts", "entryCount")),
        K.if_(ids, "if_SACnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_SACentryend", "IF the manifest is unusable or the Stock Adjustment lost its lock: FAILED (+ back) or REQUIRES_REVIEW",
              "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
                  gate(ids, "cor_SACefunlock", "Stock Adjustment lock to release?", CE, "needUnlock", [
                      unlock(ids, "update_node_SACefunlock", "Stock Adjustment back to its status before the completion", CE)]),
                  gate(ids, "cor_SACefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_SACefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows")]),
              ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_SACclaim", "Lease claim: job COMMITTING_SA, lease_owner = this run, lease_expires_at = now + 10 min", CE, "jobRows"),
        K.sql("sql_node_SACown", "Read-back: the job after the lease claim", S["own"], ["id", "job_status", "lease_owner", "row_version"]),
        code("code_node_SACown", "Own: COMMITTING_SA under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_SAClost", "IF another run took the job: stop", is_("code_node_SACown", "route", "LOST"), cres("lost", "code_node_SACown", "LOST")),
        # ---------------------------------------------------------------- A0
        K.if_(ids, "if_SACa0", "IF A0 REVALIDATE is due", is_(CE, "needA0", "YES"), [
            br("a0read", [("SA lines", sq("sql_node_SACa0lines", "A0: the stored Stock Adjustment lines (FP_SA_LINES: what saLineFingerprint reads)", "salines")),
                          ("SC lines", sq("sql_node_SACa0sc", "A0: the Stock Count's lines (FP_SC_LINES; REVIEW - a FORM job reads Stock Count 0)", "a0sclines")),
                          ("Other SAs", sq("sql_node_SACa0other", "A0: other Processing Stock Adjustments of the Stock Count", "scother", ["other"]))]),
            code(A0, "A0 REVALIDATE: FORM lines at the plan's fingerprints / REVIEW Stock Count lines at scFingerprint and no twin -> DONE; else FAILED + back", ccode("a0.js", ("fp",)),
                   chk, arrays=chk_arr),
            end_a(ids, "a0", A0, "IF the Stock Adjustment / Stock Count changed meanwhile (FAILED)"),
            V.step_done(ids, "SAC", "a0", A0, "A0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- A1
        K.if_(ids, "if_SACa1", "IF A1 SA LINES is due (REVIEW / edited COMPLETE)", is_(CE, "needA1", "YES"), [
            br("a1read", [("SALINES part", part("sql_node_SACa1part", "A1: the SALINES part", "SALINES")),
                          ("Lines", sq("sql_node_SACa1lines", "A1: the stored lines now (FP_SA_LINES)", "salines")),
                          ("Header", sq("sql_node_SACa1hdr", "A1: the Stock Adjustment header now", "sahdr")),
                          ("Platform error", gate(ids, "cor_SACa1err", "An earlier A1 write tried (A1_TRY)?", CE, "triedA1", [
                              sq("sql_node_SACa1err", "A1: the platform's error of the pass whose A1 write died (su_code_workflow_inst)", "a1err", ["current_node_id", "error_msg"])]))]),
            code(A1P, "A1 plan: before -> A1_TRY then the one whole-subform write; after -> done; before after an A1_TRY -> FAILED + back (the write died); partial -> review",
                   a1("commitA1Plan(%s, [%s][0], [%s][0], [%s][0], [%s][0])" % (E, N("sql_node_SACa1part", "data"), N("sql_node_SACa1lines", "data"), N("sql_node_SACa1hdr", "data"),
                                                                     N("sql_node_SACa1err", "data"))),
                   ["route", "row", "header", "expect", "hdrBefore", "needFull", "needLines", "lineCount", "markerRows", "needTry", "jobRows", "needJobUpd", "unlockRows", "needUnlock",
                    "result_code", "result_message", "job_status"], arrays=("expect", "markerRows", "jobRows", "unlockRows"), objects=("row", "header", "hdrBefore", "lineCount")),
            end_a(ids, "a1pl", A1P, "IF the lines cannot be written (FAILED + back / review)"),
            gate(ids, "cor_SACa1try", "A1_TRY marker to record before the write?", A1P, "needTry", [
                step_add(ids, "add_node_SACa1try", "A1_TRY marker (BEFORE the write: a later pass that finds it with the lines still at before knows the write died)", A1P, "markerRows")]),
            gate(ids, "cor_SACa1full", "COMPLETE: header + lines to write?", A1P, "needFull", [
                K.update(ids, "update_node_SACa1full", "A1 WRITE: the Stock Adjustment's header props + the whole stock_adjustment subform (update_node_bYNSsj0v's props minus status / number)", SA,
                         ("id", "in", N(A1P, "data.row.id")), [(p, N(A1P, "data.row." + p)) for p in ["id"] + SA_HDR + ["stock_adjustment"]])]),
            gate(ids, "cor_SACa1lines", "REVIEW: lines to write?", A1P, "needLines", [
                K.update(ids, "update_node_SACa1lines", "A1 WRITE: the whole stock_adjustment subform of the review's Stock Adjustment (rows without id: inserted)", SA,
                         ("id", "in", N(A1P, "data.row.id")), [(p, N(A1P, "data.row." + p)) for p in ["id", "stock_adjustment"]])]),
            br("a1back", [("Lines", sq("sql_node_SACa1linesB", "A1 read-back: the stored lines (FP_SA_LINES)", "salines")),
                          ("Header", sq("sql_node_SACa1hdrB", "A1 read-back: the Stock Adjustment header", "sahdr"))]),
            code(A1C, "A1 check: the lines read back at incomingFingerprint (+ the header props) -> DONE",
                   a1("commitA1Check(%s, %s, [%s][0], [%s][0])" % (E, pick(A1P, ["header", "expect", "hdrBefore"]), N("sql_node_SACa1linesB", "data"), N("sql_node_SACa1hdrB", "data"))),
                   chk, arrays=chk_arr),
            end_a(ids, "a1", A1C, "IF A1 did not complete (unchanged: FAILED + back; partial: review)"),
            V.step_done(ids, "SAC", "a1", A1C, "A1_SA_LINES"),
        ]),
        # ---------------------------------------------------------------- A2
        K.if_(ids, "if_SACa2", "IF A2 INVENTORY is due (phase A ends here: SPLIT / PARK)", is_(CE, "needA2", "YES"), [
            part("sql_node_SACa2part", "A2: the ENGINE part", "ENGINE"),
            code(A2I, "A2: the operation key and the movements (none -> no call)", ccode("a2_in.js"), ["ok", "needCall", "operationKey", "movements", "keys", "count", "why"],
                   arrays=("movements", "keys"), objects=("count",)),
            gate(ids, "cor_SACa2call", "Stock to move?", A2I, "needCall", [
                call(ids, "workflow_node_SACa2", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; SAC|<job> replays on a re-run)", ENGINE, [
                    ("operation_key", N(A2I, "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")),
                    ("movements", N(A2I, "data.movements"))])]),
            code(A2A, "A2: the engine's answer (409: read its intent rows; 400: read the LABELS part)", ccode("a2_ans.js"), ["code", "result_code", "message", "need409", "need400"]),
            gate(ids, "cor_SACa2ops", "409: the engine's intent rows to count?", A2A, "need409", [
                sq("sql_node_SACa2ops", "A2: this operation's engine intent rows (any = it may have written)", "intents", ["intents"])]),
            gate(ids, "cor_SACa2lab", "400: the LABELS part to read?", A2A, "need400", [part("sql_node_SACa2labels", "A2: the LABELS part (movement_key -> line, item, bin)", "LABELS")]),
            code(A2, "A2 check: 200 / no movement -> DONE + SPLIT or PARK; 409 -> wait, then FAILED + back (review with intent rows); 400 -> FAILED + back (mapped); else review",
                   ccode("a2.js", ("movekey",)), chk + ["splitRows", "needSplit", "path"], arrays=chk_arr + ("splitRows",)),
            end_a(ids, "a2", A2, "IF the stock did not move"),
            V.step_done(ids, "SAC", "a2", A2, "A2_INVENTORY"),
            gate(ids, "cor_SACsplit", "SPLIT / PARK hand-over to write?", A2, "needSplit", [
                job_update(ids, "update_node_SACsplit", "Job: SPLIT| hand-over lease (the worker calls phase B now) or PARK (due now, no lease: the next tick); attempt_count 0", A2, "splitRows")]),
        ] + cres("split", A2, "SPLIT")),
        # ---------------------------------------------------------------- A3 (REVIEW)
        K.if_(ids, "if_SACa3r", "IF A3 STOCK COUNT is due (REVIEW: the SC part's one update)", is_(CE, "needA3R", "YES"), [
            br("a3rread", [("SC part", part("sql_node_SACa3rpart", "A3: the SC part", "SC")),
                           ("SC lines", sq("sql_node_SACa3rlines", "A3: the Stock Count's lines now (FP_SC_LINES)", "sclines")),
                           ("SC header", sq("sql_node_SACa3rhdr", "A3: the Stock Count's statuses now", "schdr"))]),
            code(A3RP, "A3 plan: lines at beforeFingerprint -> the one update (update_node_sc's props minus the number); at after (+ statuses) -> done; else review",
                   a3("commitA3ReviewPlan(%s, [%s][0], [%s][0], [%s][0])" % (E, N("sql_node_SACa3rpart", "data"), N("sql_node_SACa3rlines", "data"), N("sql_node_SACa3rhdr", "data"))),
                   ["route", "row", "status", "expect", "needWrite", "lineCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("expect", "jobRows"), objects=("row", "status", "lineCount")),
            end_b(ids, "a3rpl", A3RP, "IF the Stock Count cannot be written"),
            gate(ids, "cor_SACa3rwrite", "Stock Count to write?", A3RP, "needWrite", [
                K.update(ids, "update_node_SACa3rwrite", "A3 WRITE: the Stock Count (update_node_sc's props minus stock_count_no / stock_count_no_type: header + the whole table_stock_count)",
                         SC, ("id", "in", N(A3RP, "data.row.id")), [(p, N(A3RP, "data.row." + p)) for p in SC_PROPS], labels=SC_LABELS)]),
            br("a3rback", [("SC lines", sq("sql_node_SACa3rlinesB", "A3 read-back: the Stock Count's lines", "sclines")),
                           ("SC header", sq("sql_node_SACa3rhdrB", "A3 read-back: the Stock Count's statuses", "schdr"))]),
            code(A3RC, "A3 check: the Stock Count reads back at the part's after-values -> DONE",
                   a3("commitA3ReviewCheck(%s, %s, [%s][0], [%s][0])" % (E, pick(A3RP, ["status", "expect"]), N("sql_node_SACa3rlinesB", "data"), N("sql_node_SACa3rhdrB", "data"))),
                   chk, arrays=chk_arr),
            end_b(ids, "a3r", A3RC, "IF A3 did not complete"),
            V.step_done(ids, "SAC", "a3r", A3RC, "A3_STOCK_COUNT"),
        ]),
        # ---------------------------------------------------------------- A3 (FORM with stock_count_id: classic parity)
        K.if_(ids, "if_SACa3p", "IF A3 STOCK COUNT is due (FORM with stock_count_id: every Approved line Adjusted, then the adjustment status)", is_(CE, "needA3P", "YES"), [
            br("a3pread", [("SC part", part("sql_node_SACa3ppart", "A3: the SC part (PARITY)", "SC")),
                           ("SC lines", sq("sql_node_SACa3plines", "A3: the Stock Count's lines now (id, line_status)", "sclines")),
                           ("SC header", sq("sql_node_SACa3phdr", "A3: the Stock Count's adjustment_status now", "schdr"))]),
            code(A3PP, "A3 plan: the Approved line ids -> Adjusted (slices of 250), the adjustment_status over every line (code_node_SZmrixfL)",
                   a3("commitA3ParityPlan(%s, [%s][0], [%s][0], [%s][0])" % (E, N("sql_node_SACa3ppart", "data"), N("sql_node_SACa3plines", "data"), N("sql_node_SACa3phdr", "data"))),
                   ["route", "lineSlices", "lineCount", "needLines", "headerRows", "needHeader", "status", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("lineSlices", "headerRows", "jobRows"), objects=("lineCount",)),
            end_b(ids, "a3ppl", A3PP, "IF the Stock Count cannot be marked"),
            V.slice_loop(ids, "SAC", "a3l", A3PP, "lineSlices", "A3 WRITE: Stock Count lines Approved -> Adjusted (update_node_ArYV2yrs's write, by id)", SCL, ["line_status"], slice_js),
            gate(ids, "cor_SACa3phdr", "Adjustment status to write?", A3PP, "needHeader", [
                K.update(ids, "update_node_SACa3phdr", "A3 WRITE: the Stock Count's adjustment_status (update_node_OoK68qFj's write)", SC, ("id", "in", N(A3PP, "data.headerRows.id")),
                         [(p, N(A3PP, "data.headerRows." + p)) for p in ["id", "adjustment_status"]], labels=SC_LABELS)]),
            br("a3pback", [("SC lines", sq("sql_node_SACa3plinesB", "A3 read-back: the Stock Count's lines", "sclines")),
                           ("SC header", sq("sql_node_SACa3phdrB", "A3 read-back: the Stock Count's adjustment_status", "schdr"))]),
            code(A3PC, "A3 check: no Approved line left, adjustment_status at the computed value -> DONE",
                   a3("commitA3ParityCheck(%s, %s, [%s][0], [%s][0])" % (E, pick(A3PP, ["lineCount"]), N("sql_node_SACa3plinesB", "data"), N("sql_node_SACa3phdrB", "data"))),
                   chk, arrays=chk_arr),
            end_b(ids, "a3p", A3PC, "IF A3 did not complete"),
            V.step_done(ids, "SAC", "a3p", A3PC, "A3_STOCK_COUNT"),
        ]),
        # ---------------------------------------------------------------- A4
        K.if_(ids, "if_SACa4", "IF A4 FINISH is due", is_(CE, "needA4", "YES"), [
            br("a4read", [("HDR part", part("sql_node_SACa4hdr", "A4: the HDR part", "HDR")), ("ITEMS part", part("sql_node_SACa4items", "A4: the ITEMS part", "ITEMS")),
                          ("REORDER part", part("sql_node_SACa4reorder", "A4: the REORDER part", "REORDER")),
                          ("Header", sq("sql_node_SACa4now", "A4: the Stock Adjustment's status now", "sahdr"))]),
            code(A4P, "A4 plan: Completed -> done; Processing -> Item dates in slices, the reorder call at most once (marker first), then stock_adjustment_status Completed",
                   a4("commitA4Plan(%s, [%s][0], [%s][0], [%s][0], [%s][0])" % (E, N("sql_node_SACa4hdr", "data"), N("sql_node_SACa4items", "data"), N("sql_node_SACa4reorder", "data"),
                                                                       N("sql_node_SACa4now", "data"))),
                   ["route", "after", "statusRows", "needStatus", "itemSlices", "itemCount", "reorderRows", "needReorder", "reorderLatest", "jobRows", "needJobUpd", "result_code",
                    "result_message", "job_status"], arrays=("statusRows", "itemSlices", "reorderRows", "reorderLatest", "jobRows"), objects=("after", "itemCount")),
            end_b(ids, "a4pl", A4P, "IF the Stock Adjustment cannot be finished"),
            V.slice_loop(ids, "SAC", "a4i", A4P, "itemSlices", "A4 WRITE: Item last_transaction_date (code_node_WFXy3gHI's value)", V.ITEM, ["last_transaction_date"], slice_js),
            gate(ids, "cor_SACa4reorder", "Reorder tracking to run (A4_REORDER not recorded yet)?", A4P, "needReorder", [
                step_add(ids, "add_node_SACa4marker", "A4_REORDER marker (written BEFORE the call: at most once; unique job / step)", A4P, "reorderRows"),
                call(ids, "workflow_node_SACa4reorder", "REORDER_SET_REDIS SA_COMPLETED (as workflow_node_ReorderSaCompleted) + organization_id", REORDER, [
                    ("document_type", "SA_COMPLETED", "value"), ("latest_data", N(A4P, "data.reorderLatest")), ("organization_id", N(CE, "data.organizationId"))])]),
            gate(ids, "cor_SACa4status", "Completed to write?", A4P, "needStatus", [
                K.update(ids, "update_node_SACa4status", "A4 WRITE: stock_adjustment_status Completed - the Processing lock ends", SA, ("id", "in", N(A4P, "data.statusRows.id")),
                         [(p, N(A4P, "data.statusRows." + p)) for p in ["id", "stock_adjustment_status"]], labels=SA_LABELS)]),
            sq("sql_node_SACa4back", "A4 read-back: the Stock Adjustment's status", "sahdr"),
            code(A4C, "A4 check: Completed -> DONE", a4("commitA4Check(%s, %s, [%s][0])" % (E, pick(A4P, ["after"]), N("sql_node_SACa4back", "data"))), chk, arrays=chk_arr),
            end_b(ids, "a4", A4C, "IF A4 did not complete"),
            V.step_done(ids, "SAC", "a4", A4C, "A4_FINISH"),
        ]),
        # ---------------------------------------------------------------- finish
        code(FIN, "FINISH: the job COMPLETED (A4's status write was the unlock)", ccode("finish.js"), ["jobRows", "result_message", "job_status"], arrays=("jobRows",)),
        job_update(ids, "update_node_SACdone", "Job COMPLETED (lease released)", FIN, "jobRows"),
    ] + cres("done", FIN, "DONE")
    doc = K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_SA job (READY_TO_COMMIT, or COMMITTING_SA to resume)")], RES, nodes)
    text = json.dumps(doc, ensure_ascii=False)
    left = re.findall(r"__[A-Z]+__", text)
    assert not left, left
    # nothing of the LOT template is left in code (code/shared's provenance comments name smv2 / lot_common.js, which is fine)
    stale = [w for w in ("SMLT", "stock_movement", "Location Transfer", "In Transit", "SAVE_LOT", "COMMITTING_LOT", "LOT_V2", "LOT|", "\"LOT_", "lot_v2_job_id") if w in text]
    stale += sorted(set(re.findall(r"\blot[A-Z][A-Za-z]*\(", text)))
    assert not stale, stale
    return doc


BUILDERS = [("SA_V2_COMMIT", build)]

if __name__ == "__main__":
    V.build(BUILDERS, OUT, "--write" in sys.argv)
