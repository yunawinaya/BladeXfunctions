"""Builds the Putaway Completion V2 workflows (PUTAWAY_ASYNC_SUBMIT / _WORKER, PUTAWAY_BULK_PREPARE / _COMMIT) as FlowGram JSON
into the repo's Putaway/AsyncV2/. Same machinery as GR Completion V2 (scratchpad/grv2/build_grv2.py, whose generic helpers
this imports); contract: PWV2_DESIGN.md + the plan core (prepare/sql.py, code/prepare/). Published with .dbtools/wf_upload.mjs.

usage: python3 build_pwv2.py [--write] [NAME ...]
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "grv2"))
sys.path.insert(0, os.path.join(HERE, "prepare"))
import wfkit as K  # noqa: E402
import build_grv2 as G  # noqa: E402
from sql import SQL as PSQL, SUBMIT_SQL, jcols, TOL as TOL_PHYS, TOR as TOR_PHYS  # noqa: E402

N, gate, call, job_update, step_add, sub, is_ = G.N, G.gate, G.call, G.job_update, G.step_add, G.sub, G.is_
JOB, STEP, ENGINE, JOB_PROPS, RES_FIELDS = G.JOB, G.STEP, G.ENGINE, G.JOB_PROPS, G.RES_FIELDS
OUT = G.R + "Putaway/AsyncV2/"
TO = "Transfer Order Putaway:Table:1937714890958053378"
TOL = "Putaway Items(Transfer Order Putaway):Table:1939915310509170690"
GR = G.GR
IT = G.IT
IT_UPD_COLS = ["transit_qty", "received_qty", "open_qty", "status", "received_date", "to_bin", "to_category", "target_doc_type", "target_doc_id", "target_doc_no",
               "target_doc_line_id"]
# add_node_ITsplit (PUTAWAY) + the rerun key
IT_ADD_COLS = G.IT_COLS + ["received_date", "job_line_key"]
PW_LINE_COLS = ["pending_process_qty", "putaway_qty", "line_status", "target_location", "remark", "is_split", "parent_or_child"]
# what COMMIT reads back: the line columns a completion may change (PREPARE refuses any other), the in-transit columns P0 / P3 compare
LINE7 = [("id", "id")] + [(c, "id" if c == "target_location" else "raw") for c in PW_LINE_COLS]
IT4 = [("id", "id"), ("status", "raw"), ("open_qty", "raw"), ("received_qty", "raw"), ("transit_qty", "raw")]
IT12 = [("id", "id")] + [(c, {"received_date": "dt", "to_bin": "id"}.get(c, "raw")) for c in IT_UPD_COLS]
IDS_FILE = os.path.join(HERE, "ids.json")
PW_IDS = json.load(open(IDS_FILE)) if os.path.exists(IDS_FILE) else {}


def raw(path):
    with open(os.path.join(HERE, path), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def code(path):
    return raw(os.path.join("code", path))


def to_unlock(ids, nid, title, src, field="unlockRows"):
    return K.update(ids, nid, title, TO, ("id", "in", N(src, "data.%s.id" % field)),
                    [("id", N(src, "data.%s.id" % field)), ("is_processing", N(src, "data.%s.is_processing" % field))])


def plan_sql(key, entry):
    return PSQL[key].replace("code_node_PPentry", entry)


# =============================================================================================== PUTAWAY_BULK_COMMIT
CG, CE = "code_node_PCguard", "code_node_PCentry"


def ccode(name, extra=()):
    return "\n".join([code("commit/_common.js"), code("commit/_cmp.js")] + [raw(x) for x in extra] + [code("commit/" + name)])


RESULT_JS = "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\n"


def cres(tag, src, path):
    body = RESULT_JS + code("commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [K.code("code_node_PC%sres" % tag, "Result (%s)" % path, body, RES_FIELDS),
            K.ret("return_node_PC%s" % tag, "Return (%s)" % path, [(f, N("code_node_PC%sres" % tag, "data." + f)) for f in RES_FIELDS])]


def end_a(ids, tag, src, title):
    """phase A (no stock moved yet): the putaway released, then the job row"""
    nodes = [gate(ids, "cor_PC%sunlock" % tag, "Putaway lock to release?", src, "needUnlock", [to_unlock(ids, "update_node_PC%sunlock" % tag, "Putaway released (is_processing 0; no stock was moved)", src)]),
             gate(ids, "cor_PC%sjob" % tag, "Job row to write?", src, "needJobUpd", [job_update(ids, "update_node_PC%sjob" % tag, "Job: wait / retry with backoff / FAILED (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_PC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def end_b(ids, tag, src, title):
    nodes = [gate(ids, "cor_PC%sjob" % tag, "Job row to write?", src, "needJobUpd", [job_update(ids, "update_node_PC%sjob" % tag, "Job: retry with backoff / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_PC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def step_done(ids, tag, src, step):
    return gate(ids, "cor_PC%sdone" % tag, "%s DONE to record?" % step, src, "needStep", [step_add(ids, "add_node_PC%sdone" % tag, "%s DONE (unique job / step)" % step, src, "stepRows")])


def slice_loop(ids, tag, src, field, title, table, props, add=False):
    loop_id = "loop_PC%s" % tag
    sl = "code_node_PC%sslice" % tag
    body = code("commit/slice.js").replace("__LOOP__", loop_id)
    write = (K.add(ids, "add_node_PC%swrite" % tag, title + " (<= 250 per call)", table, [(p, N(sl, "data.rows." + p)) for p in props]) if add else
             K.update(ids, "update_node_PC%swrite" % tag, title + " (<= 250 per call)", table, ("id", "in", N(sl, "data.rows.id")), [(p, N(sl, "data.rows." + p)) for p in ["id"] + props]))
    return K.loop(ids, loop_id, title, N(src, "data." + field), [K.code(sl, "This slice (the loop item: <= 250 rows)", body, ["n", "rows"], arrays=("rows",), objects=("n",)), write])


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
       j.row_version, j.error_code, j.error_message, j.error_details, j.idempotency_key, j.correlation_id, j.is_deleted
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB""", NEXT=dt("j.next_attempt_at"), LEASE=dt("j.lease_expires_at"), **TOK)
    S["steps"] = sub("SELECT st.step_name, st.step_status FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' AND st.step_name REGEXP '^P[0-9]_' "
                     "AND st.is_deleted = 0", **TOK)
    S["payload"] = sub("SELECT j.prepared_payload FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["to"] = sub("""SELECT t.is_processing, t.to_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('PWC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  JOIN transfer_order_putaway t ON t.tenant_id = j.tenant_id AND t.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND t.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.id = @JOB AND j.correlation_id REGEXP '^TO\\\\|[0-9]{1,20}$'""", **TOK)
    S["own"] = sub("SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.lease_owner, j.row_version FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.id = @JOB", **TOK)
    S["part"] = lambda name: sub("SELECT st.step_name, st.result_ref FROM gd_publish_step st WHERE st.tenant_id = '@T' AND st.job_id = '@JOB' "
                                 "AND st.step_name LIKE CONCAT('@PFX', '@NAME|%') AND st.is_deleted = 0 ORDER BY st.step_name", PFX=PFX, NAME=name, **TOK)
    TOID, GRID = N(CE, "data.toId"), N(CE, "data.grId")
    S["head"] = sub("""SELECT t.is_processing, t.to_status, SUBSTRING(DATE_FORMAT(t.update_time, '%Y-%m-%d %H:%i:%s.%f'), 1, 23) AS update_time
  FROM transfer_order_putaway t WHERE t.tenant_id = '@T' AND t.id = @TOID AND t.is_deleted = 0""", TOID=TOID, **TOK)
    S["itkeys"] = sub("""SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'job_line_key', i.job_line_key) AS j
  FROM in_transit_detail i
 WHERE i.tenant_id = '@T' AND i.doc_id = '@GRID' AND i.job_line_key LIKE CONCAT('@JOB', '|%') AND i.is_deleted = 0""", GRID=GRID, **TOK)
    ORG = N(CE, "data.organizationId")
    S["lines7"] = sub(f"SELECT {jcols('l', LINE7)} AS j\n  FROM {TOL_PHYS} l\n WHERE l.tenant_id = '@T' AND l.transfer_order_putaway_id = @TOID AND l.is_deleted = 0\n ORDER BY l.id",
                      TOID=TOID, **TOK)
    # ITmatch consumes open rows only: a consumed row missing here has moved, the answer reading every row gave
    S["transit4"] = sub(f"SELECT {jcols('t', IT4)} AS j\n  FROM in_transit_detail t\n WHERE t.tenant_id = '@T' AND t.doc_id = '@GRID' AND t.organization_id = '@ORG' "
                        "AND t.status = 'In Transit' AND t.is_deleted = 0\n ORDER BY t.id", GRID=GRID, ORG=ORG, **TOK)
    S["transitIds"] = sub(f"SELECT {jcols('t', IT12)} AS j\n  FROM in_transit_detail t\n WHERE t.tenant_id = '@T' AND t.doc_id = '@GRID' AND t.organization_id = '@ORG' AND t.is_deleted = 0\n"
                          "   AND t.id IN (SELECT x.id FROM JSON_TABLE('@IDS', '$[*]' COLUMNS (id BIGINT PATH '$')) x)\n ORDER BY t.id",
                          GRID=GRID, ORG=ORG, IDS=N("code_node_PCp3ids", "data.idsSql"), **TOK)
    S["recKeys"] = sub(f"SELECT JSON_OBJECT('id', CAST(r.id AS CHAR), 'job_line_key', r.job_line_key) AS j\n  FROM {TOR_PHYS} r\n"
                       " WHERE r.tenant_id = '@T' AND r.transfer_order_putaway_id = @TOID AND r.job_line_key LIKE CONCAT('@JOB', '|%') AND r.is_deleted = 0",
                       TOID=TOID, **TOK)
    for k in ("records", "gr", "others", "qi", "setup"):
        S[k] = plan_sql(k, CE)
    return S


def build_commit():
    ids = K.Ids(1798700000000)
    S = commit_sql()
    sq = lambda nid, title, key, cols=("j",): K.sql(nid, title, S[key], list(cols))
    part = lambda nid, title, name: K.sql(nid, title, S["part"](name), ["step_name", "result_ref"])
    br = lambda tag, items: K.parallel("condition_all_PC%s" % tag, "Reads in parallel", [("cai_PC%s%d" % (tag, i), t, [n]) for i, (t, n) in enumerate(items)])
    head_cols = ["is_processing", "to_status", "update_time"]
    entry_fields = ["route", "phase", "dbNow", "jobId", "tenantId", "organizationId", "toId", "toNo", "grId", "idempotencyKey", "jobStatus", "rowVersion", "attempts", "leaseUntil",
                    "unlockOk", "partPrefix", "manifest", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "needP0", "needP1", "needP2", "needP3", "needP4",
                    "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows")
    rej_body = RESULT_JS + code("commit/result.js") + "\nreturn commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");" % (
        N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    P4X = ("lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js")
    nodes = [
        K.code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_PCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            K.code("code_node_PCrejres", "Result (REJECTED_INPUT)", rej_body, RES_FIELDS),
            K.ret("return_node_PCrej", "Return (rejected input)", [(f, N("code_node_PCrejres", "data." + f)) for f in RES_FIELDS])]),
        K.parallel("condition_all_PCfacts", "Facts in parallel: the job, its step rows, its manifest, the putaway's lock", [
            ("cai_PCjob", "Job", [K.sql("sql_node_PCjob", "The job (+ DB clock, lease flag, lease_until, due)", S["job"],
                ["db_now", "lease_until", "id", "organization_id", "command", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
                 "lease_expires_at", "lease_live", "due", "row_version", "error_code", "error_message", "error_details", "idempotency_key", "correlation_id", "is_deleted"])]),
            ("cai_PCsteps", "Steps", [K.sql("sql_node_PCsteps", "This job's P step rows", S["steps"], ["step_name", "step_status"])]),
            ("cai_PCpayload", "Manifest", [K.sql("sql_node_PCpayload", "The prepared manifest", S["payload"], ["prepared_payload"])]),
            ("cai_PCto", "Putaway + lock", [K.sql("sql_node_PCto", "The putaway's is_processing and its latest completion lock", S["to"], ["is_processing", "to_status", "lock_ref"])]),
        ]),
        K.code(CE, "Entry: what this run does (phase A: P0 P1, SPLIT; phase B: P2 P3 P4, COMPLETED), the lease claim", ccode("entry.js"), entry_fields,
               arrays=("jobRows", "unlockRows"), objects=("rowVersion", "attempts", "manifest")),
        K.if_(ids, "if_PCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_PCentryend", "IF the manifest is unusable or the putaway lost its lock: FAILED (+ released) or REQUIRES_REVIEW", "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
            gate(ids, "cor_PCefunlock", "Putaway lock to release?", CE, "needUnlock", [to_unlock(ids, "update_node_PCefunlock", "Putaway released (is_processing 0)", CE)]),
            gate(ids, "cor_PCefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_PCefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows")]),
        ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_PCclaim", "Lease claim: job COMMITTING_PUTAWAY, lease_owner = this run, lease_expires_at = now + 10 min", CE, "jobRows"),
        K.sql("sql_node_PCown", "Read-back: the job after the lease claim", S["own"], ["id", "job_status", "lease_owner", "row_version"]),
        K.code("code_node_PCown", "Own: COMMITTING_PUTAWAY under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_PClost", "IF another run took the job: stop", is_("code_node_PCown", "route", "LOST"), cres("lost", "code_node_PCown", "LOST")),
        # ---------------------------------------------------------------- P0
        K.if_(ids, "if_PCp0", "IF P0 REVALIDATE is due", is_(CE, "needP0", "YES"), [
            br("p0read", [("TO part", part("sql_node_PCp0to", "P0: the TO part", "TO")), ("IT part", part("sql_node_PCp0it", "P0: the IT part", "IT")),
                          ("Header", sq("sql_node_PCp0head", "P0: the putaway header now", "head", head_cols)),
                          ("Lines", sq("sql_node_PCp0lines", "P0: the putaway's lines now (the 7 columns a completion changes)", "lines7")),
                          ("In transit", sq("sql_node_PCp0transit", "P0: the receipt's open in-transit rows now (the 4 columns P0 compares)", "transit4"))]),
            K.code("code_node_PCp0", "P0 REVALIDATE: the putaway, its lines and the consumed in-transit rows as PREPARE read them -> DONE; else FAILED + released", ccode("p0.js"), chk, arrays=chk_arr),
            end_a(ids, "p0", "code_node_PCp0", "IF the putaway changed meanwhile (FAILED)"),
            step_done(ids, "p0", "code_node_PCp0", "P0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- P1
        K.if_(ids, "if_PCp1", "IF P1 INVENTORY is due (phase A ends here: SPLIT)", is_(CE, "needP1", "YES"), [
            part("sql_node_PCp1part", "P1: the ENGINE part", "ENGINE"),
            K.code("code_node_PCp1in", "P1: the operation key and the movements", ccode("p1_in.js"), ["ok", "why", "operationKey", "movements"], arrays=("movements",)),
            call(ids, "workflow_node_PCp1", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; PWC|<job> replays on a re-run)", ENGINE, [
                ("operation_key", N("code_node_PCp1in", "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")),
                ("movements", N("code_node_PCp1in", "data.movements"))]),
            K.code("code_node_PCp1", "P1 check: 200 -> DONE + SPLIT; 409 -> wait; 400 -> FAILED + released; else review", ccode("p1.js"), chk + ["splitRows", "needSplit"], arrays=chk_arr + ("splitRows",)),
            end_a(ids, "p1", "code_node_PCp1", "IF the stock did not move"),
            step_done(ids, "p1", "code_node_PCp1", "P1_INVENTORY"),
            gate(ids, "cor_PCsplit", "SPLIT hand-over to write?", "code_node_PCp1", "needSplit", [job_update(ids, "update_node_PCsplit", "Job: SPLIT| hand-over lease (the next run does phase B)", "code_node_PCp1", "splitRows")]),
        ] + cres("split", "code_node_PCp1", "SPLIT")),
        # ---------------------------------------------------------------- P2
        K.if_(ids, "if_PCp2", "IF P2 THE PUTAWAY is due", is_(CE, "needP2", "YES"), [
            br("p2read", [("TO part", part("sql_node_PCp2part", "P2: the TO part", "TO")), ("Header", sq("sql_node_PCp2head", "P2: the header now", "head", head_cols)),
                          ("Lines", sq("sql_node_PCp2lines", "P2: the lines now (the 7 columns a completion changes)", "lines7")),
                          ("Records", sq("sql_node_PCp2records", "P2: the records now (every column)", "records"))]),
            K.code("code_node_PCp2plan", "P2 plan: changed lines by id (before / after), the records (stored + new by job_line_key), to_status", ccode("p2_plan.js"),
                   ["route", "lineSlices", "lineCount", "headerRow", "needHeader", "recordCount", "newRecords", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("lineSlices", "jobRows"), objects=("headerRow", "lineCount", "recordCount", "newRecords")),
            end_b(ids, "p2pl", "code_node_PCp2plan", "IF the putaway cannot be written"),
            slice_loop(ids, "p2", "code_node_PCp2plan", "lineSlices", "P2 WRITE: putaway lines", TOL, PW_LINE_COLS),
            gate(ids, "cor_PCp2head", "Records / status to write?", "code_node_PCp2plan", "needHeader", [
                K.update(ids, "update_node_PCp2head", "P2 WRITE: to_status + table_putaway_records (update_node_wYdL6wYD's whole-subform write)", TO,
                         ("id", "in", N("code_node_PCp2plan", "data.headerRow.id")),
                         [(p, N("code_node_PCp2plan", "data.headerRow." + p)) for p in ["id", "to_status", "table_putaway_records"]])]),
            br("p2back", [("Header", sq("sql_node_PCp2headB", "P2 read-back: the header", "head", head_cols)),
                          ("Lines", sq("sql_node_PCp2linesB", "P2 read-back: the lines (7 columns)", "lines7")),
                          ("Records", sq("sql_node_PCp2recordsB", "P2 read-back: this job's records (id + job_line_key)", "recKeys"))]),
            K.code("code_node_PCp2check", "P2 check: lines at after, every new record once, to_status -> DONE", ccode("p2_check.js"), chk, arrays=chk_arr),
            end_b(ids, "p2", "code_node_PCp2check", "IF P2 did not complete"),
            step_done(ids, "p2", "code_node_PCp2check", "P2_TO"),
        ]),
        # ---------------------------------------------------------------- P3
        K.if_(ids, "if_PCp3", "IF P3 THE IN-TRANSIT LEDGER is due", is_(CE, "needP3", "YES"), [
            part("sql_node_PCp3part", "P3: the IT part", "IT"),
            K.code("code_node_PCp3ids", "P3: the ids of the in-transit rows the confirmation consumes (the IT part's updates)", ccode("p3_ids.js"), ["idsSql", "n"], objects=("n",)),
            br("p3read", [("Rows", sq("sql_node_PCp3rows", "P3: the consumed in-transit rows now (by id; the columns P3 writes)", "transitIds")),
                          ("Keys", sq("sql_node_PCp3keys", "P3: this job's remainders (job_line_key)", "itkeys"))]),
            K.code("code_node_PCp3plan", "P3 plan: consumed rows by id (before / after), remainders by job_line_key", ccode("p3_plan.js"),
                   ["route", "updSlices", "updCount", "addSlices", "addCount", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("updSlices", "addSlices", "jobRows"), objects=("updCount", "addCount")),
            end_b(ids, "p3pl", "code_node_PCp3plan", "IF the in-transit ledger cannot be written"),
            slice_loop(ids, "p3u", "code_node_PCp3plan", "updSlices", "P3 WRITE: in-transit rows consumed (update_node_ITupd's columns)", IT, IT_UPD_COLS),
            slice_loop(ids, "p3a", "code_node_PCp3plan", "addSlices", "P3 WRITE: in-transit remainders (add_node_ITsplit's columns + job_line_key)", IT, IT_ADD_COLS, add=True),
            br("p3back", [("Rows", sq("sql_node_PCp3rowsB", "P3 read-back: the consumed in-transit rows (by id)", "transitIds")),
                          ("Keys", sq("sql_node_PCp3keysB", "P3 read-back: this job's remainders", "itkeys"))]),
            K.code("code_node_PCp3check", "P3 check: consumed rows at after, every remainder once -> DONE", ccode("p3_check.js"), chk, arrays=chk_arr),
            end_b(ids, "p3", "code_node_PCp3check", "IF P3 did not complete"),
            step_done(ids, "p3", "code_node_PCp3check", "P3_TRANSIT"),
        ]),
        # ---------------------------------------------------------------- P4
        K.if_(ids, "if_PCp4", "IF P4 THE RECEIPT is due", is_(CE, "needP4", "YES"), [
            br("p4read", [("GR part", part("sql_node_PCp4part", "P4: the GR part", "GR")), ("Header", sq("sql_node_PCp4head", "P4: this putaway now", "head", head_cols)),
                          ("GR", sq("sql_node_PCp4gr", "P4: the receipt now", "gr")), ("Others", sq("sql_node_PCp4others", "P4: the receipt's putaways now", "others")),
                          ("QI", sq("sql_node_PCp4qi", "P4: the receipt's QI lots now", "qi")), ("Setup", sq("sql_node_PCp4setup", "P4: putaway_setup", "setup"))]),
            K.code("code_node_PCp4plan", "P4 plan: code_node_ds7jurnq (lifted) on fresh reads -> the receipt's putaway_status / gr_status; the putaway released", ccode("p4_plan.js", P4X),
                   ["route", "grRows", "needGr", "unlockRows", "needUnlock", "grPutawayStatus", "grStatus", "jobRows", "needJobUpd", "result_code", "result_message", "job_status"],
                   arrays=("grRows", "unlockRows", "jobRows")),
            end_b(ids, "p4pl", "code_node_PCp4plan", "IF the receipt cannot be written"),
            gate(ids, "cor_PCp4gr", "Receipt status to write?", "code_node_PCp4plan", "needGr", [
                K.update(ids, "update_node_PCp4gr", "P4 WRITE: the receipt's putaway_status / gr_status (update_node_qBb4oUDj's columns)", GR, ("id", "in", N("code_node_PCp4plan", "data.grRows.id")),
                         [(p, N("code_node_PCp4plan", "data.grRows." + p)) for p in ["id", "putaway_status", "gr_status"]], labels=G.GR_LABELS)]),
            gate(ids, "cor_PCp4unlock", "Putaway to release?", "code_node_PCp4plan", "needUnlock", [to_unlock(ids, "update_node_PCp4unlock", "P4 WRITE: the putaway released (is_processing 0)", "code_node_PCp4plan")]),
            br("p4back", [("GR", sq("sql_node_PCp4grB", "P4 read-back: the receipt", "gr")), ("Header", sq("sql_node_PCp4headB", "P4 read-back: this putaway", "head", head_cols))]),
            K.code("code_node_PCp4check", "P4 check: the receipt at the recomputed status, the putaway released -> DONE", ccode("p4_check.js"), chk, arrays=chk_arr),
            end_b(ids, "p4", "code_node_PCp4check", "IF P4 did not complete"),
            step_done(ids, "p4", "code_node_PCp4check", "P4_FINISH"),
        ]),
        K.code("code_node_PCfinish", "FINISH: the job COMPLETED", ccode("finish.js"), ["jobRows", "result_message"], arrays=("jobRows",)),
        job_update(ids, "update_node_PCdone", "Job COMPLETED (lease released)", "code_node_PCfinish", "jobRows"),
    ] + cres("done", "code_node_PCfinish", "DONE")
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_PUTAWAY job (READY_TO_COMMIT, or COMMITTING_PUTAWAY to resume)")], RES_FIELDS, nodes)


# =============================================================================================== PUTAWAY_BULK_PREPARE
def plan_code():
    for f in ("lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js", "code/prepare/plan_tail.js"):
        assert os.path.exists(os.path.join(HERE, f)), f
    lifted = raw("lift/lifted_prepare.js")
    assert "{{" not in lifted, "a lifted body still holds a platform token"
    return "\n".join([raw("lift/runtime.js"), lifted, code("prepare/adapter.js"), code("prepare/chain.js"), code("prepare/plan.js"), code("prepare/plan_tail.js")])


def build_prepare():
    ids = K.Ids(1798800000000)
    Gd, E, P, RD = "code_node_PPguard", "code_node_PPentry", "code_node_PPplan", "code_node_PPready"
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
                "evidence: JSON.stringify({ v: 1, workflow: \"PUTAWAY_BULK_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(Gd, "data.result_code"), N(Gd, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"PUTAWAY_BULK_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    reads = [("hdr", "The putaway (every schema field)"), ("lines", "Its lines"), ("records", "Its records"), ("gr", "Its receipt"), ("items", "Items of its lines"),
             ("transit", "The receipt's in-transit rows (every status)"), ("others", "The receipt's putaways"), ("qi", "The receipt's QI lots"), ("setup", "putaway_setup"),
             ("bbal", "Source batch balances (the ADD's dates)"), ("lock", "Its latest completion lock")]
    sql_nodes = [("cai_PP" + k, k, [K.sql("sql_node_PP" + k, title, PSQL[k], ["step_name", "result_ref"] if k == "lock" else ["j"])]) for k, title in reads]
    plan_fields = ["route", "code", "message", "payload", "partRows", "lineCount", "movementCount", "toId", "unlockOk"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message", "job_status"]
    nodes = [
        K.code(Gd, "Guard: job_id (digits), session tenant", code("prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_PPreject", "IF the input is invalid: answer, write nothing", is_(Gd, "route", "REJECT"), [
            K.code("code_node_PPrej", "Answer (rejected input)", rej_body, res_fields),
            K.ret("return_node_PPrej", "Return (rejected input)", [(f, N("code_node_PPrej", "data." + f)) for f in res_fields])]),
        K.sql("sql_node_PPjob", "The job (+ DB clock, lease flag, request)", job,
              ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key", "correlation_id",
               "request_payload", "is_deleted"]),
        K.code(E, "Entry: a VALIDATING COMPLETE_PUTAWAY job under a live lease; its correlation -> the putaway; its request", code("prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "toId", "grId", "idempotencyKey", "rowVersion", "dbNow", "nonce", "request", "result_code", "result_message"],
               objects=("request", "rowVersion")),
        K.if_(ids, "if_PPnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(E, "route", "NOOP"), [
            K.code("code_node_PPnoop", "Answer (not prepared)", noop_body, res_fields),
            K.ret("return_node_PPnoop", "Return (not prepared)", [(f, N("code_node_PPnoop", "data." + f)) for f in res_fields])]),
        K.parallel("condition_all_PPread", "Set-based reads in parallel (no row limits)", sql_nodes),
        K.code(P, "Plan: the stored putaway + the confirmation -> PUTAWAY's Completed path (lifted) -> the manifest and its parts", plan_code(), plan_fields,
               arrays=("partRows",), objects=("lineCount", "movementCount", "unlockOk")),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ the putaway released when this job holds its lock)", code("prepare/ready.js"), ready_fields,
               arrays=("readyRows", "jobRows", "unlockRows")),
        gate(ids, "cor_PPparts", "Payload parts to write?", RD, "needParts", [
            K.add(ids, "add_node_PPparts", "Payload parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", STEP,
                  [(p, N(P, "data.partRows." + p)) for p in ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]], labels={"organization_id": "Organization"})]),
        gate(ids, "cor_PPready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_PPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message",
                                                                  "error_details", "prepared_payload", "line_count"]])]),
        gate(ids, "cor_PPunlock", "Putaway to release?", RD, "needUnlock", [to_unlock(ids, "update_node_PPunlock", "Putaway released (is_processing 0; nothing was written)", RD)]),
        gate(ids, "cor_PPfail", "Job FAILED to write?", RD, "needJobUpd", [job_update(ids, "update_node_PPfail", "Job FAILED with the reason (lease released)", RD, "jobRows")]),
        K.sql("sql_node_PPback", "Read-back: the job after the write (the truth)", back, ["id", "job_status", "progress_message", "error_code", "error_message"]),
        K.code("code_node_PPresult", "Result", code("prepare/result.js"), res_fields),
        K.ret("return_node_PPdone", "Return", [(f, N("code_node_PPresult", "data." + f)) for f in res_fields]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_PUTAWAY job the worker holds")], res_fields, nodes)


# =============================================================================================== PUTAWAY_ASYNC_WORKER
PW_LOCK_JOIN = """LEFT JOIN transfer_order_putaway g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^TO\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('PWC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
PW_ID_COL = "(CASE WHEN g.is_processing = 1 AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS to_id"


def build_worker():
    # GR_COMPLETE_WORKER's builder with the putaway's names, lock column and code (gen_worker_code.py); built by swapping
    # its module-level names, then renaming the GR-specific node ids and texts in the generated document
    saved = (G.GR_LOCK_JOIN, G.GR_ID_COL, G.PREV_COL, G.GR_IDS, G.HERE, G.gr_unlock)
    try:
        G.GR_LOCK_JOIN, G.GR_ID_COL, G.PREV_COL = PW_LOCK_JOIN, PW_ID_COL, "'' AS prev_status"
        G.GR_IDS = {"GR_COMPLETE_PREPARE": PW_IDS.get("PUTAWAY_BULK_PREPARE", "0"), "GR_COMPLETE_COMMIT": PW_IDS.get("PUTAWAY_BULK_COMMIT", "0")}
        G.HERE = HERE
        G.gr_unlock = lambda ids, nid, title, src, field="unlockRows": to_unlock(ids, nid, title, src, field)
        doc = G.build_worker()
    finally:
        G.GR_LOCK_JOIN, G.GR_ID_COL, G.PREV_COL, G.GR_IDS, G.HERE, G.gr_unlock = saved
    text = json.dumps(doc, ensure_ascii=False)
    for a, b in (("GR_COMPLETE_PREPARE", "PUTAWAY_BULK_PREPARE"), ("GR_COMPLETE_COMMIT", "PUTAWAY_BULK_COMMIT"), ("COMPLETE_GR", "COMPLETE_PUTAWAY"),
                 ("COMMITTING_GR", "COMMITTING_PUTAWAY"), ("code_node_RW", "code_node_PW"), ("sql_node_RW", "sql_node_PW"), ("get_cache_RW", "get_cache_PW"),
                 ("set_cache_RW", "set_cache_PW"), ("update_node_RW", "update_node_PW"), ("add_node_RW", "add_node_PW"), ("workflow_node_RW", "workflow_node_PW"),
                 ("cor_RW", "cor_PW"), ("cori_YRW", "cori_YPW"), ("cori_NRW", "cori_NPW"), ("if_RW", "if_PW"), ("ifBlock_TRW", "ifBlock_TPW"), ("ifBlock_FRW", "ifBlock_FPW"),
                 ("loop_RW", "loop_PW"), ("return_node_RW", "return_node_PW"), ("grc_wrk_", "pwc_wrk_"), ("gr_id", "to_id"), ("Goods Receiving", "Putaway"),
                 ("receipt lock", "putaway lock"), ("the receipt", "the putaway")):
        text = text.replace(a, b)
    left = [w for w in ("COMPLETE_GR", "_RW", "GR_COMPLETE") if w in text]
    assert not left, left
    return json.loads(text)


# =============================================================================================== PUTAWAY_ASYNC_SUBMIT
SUB_RES = ["route", "code", "message", "reason", "job_id", "job_status", "to_id", "to_no", "row_count", "progress_percent", "progress_message", "error_code", "error_message", "evidence"]


def scode(name, extra=()):
    return "\n".join([code("submit/_common.js")] + [raw(x) for x in extra] + [code("submit/" + name)])


def build_submit():
    ids = K.Ids(1798900000000)
    Gd, E, GT, PO = "code_node_PSguard", "code_node_PSentry", "code_node_PSgate", "code_node_PSpost"
    T, TOID, KEY = N(Gd, "data.tenantId"), N(Gd, "data.toId"), N(Gd, "data.key")
    open_list = "'QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PUTAWAY', 'REQUIRES_REVIEW'"
    jobobj = ("JSON_OBJECT('id', CAST(@A.id AS CHAR), 'job_status', @A.job_status, 'correlation_id', @A.correlation_id, 'progress_percent', @A.progress_percent, "
              "'progress_message', @A.progress_message, 'error_code', @A.error_code, 'error_message', @A.error_message)")
    facts = sub("""SELECT DATE_FORMAT(n.t0, '%Y-%m-%d %H:%i:%s') AS db_now,
       (SELECT CAST(@KJ AS CHAR) FROM gd_async_job k
         WHERE k.tenant_id = '@T' AND k.idempotency_key = '@KEY' AND k.is_deleted = 0 ORDER BY k.id DESC LIMIT 1) AS key_job,
       CAST(t.id AS CHAR) AS to_db_id, t.to_id AS to_no, t.gr_no, t.organization_id, CAST(t.plant_id AS CHAR) AS plant_id,
       (SELECT p.step_name FROM gd_publish_step p
         WHERE p.tenant_id = '@T' AND p.job_id = 'PWC|@TO' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS last_lock,
       (SELECT CAST(JSON_ARRAYAGG(@OJ) AS CHAR) FROM gd_async_job o
         WHERE o.tenant_id = '@T' AND o.is_deleted = 0 AND o.command = 'COMPLETE_PUTAWAY' AND o.correlation_id = 'TO|@TO' AND o.job_status IN (@OPEN)) AS open_jobs,
       (SELECT CAST(@XJ AS CHAR) FROM gd_async_job x
         WHERE x.tenant_id = '@T' AND x.is_deleted = 0 AND x.command = 'COMPLETE_PUTAWAY' AND x.correlation_id = 'TO|@TO' ORDER BY x.id DESC LIMIT 1) AS last_job
  FROM (SELECT NOW(3) AS t0) n
  LEFT JOIN transfer_order_putaway t
    ON t.tenant_id = '@T'
   AND t.id = @TO
   AND t.is_deleted = 0""", KJ=jobobj.replace("@A", "k"), OJ=jobobj.replace("@A", "o"), XJ=jobobj.replace("@A", "x"), OPEN=open_list, T=T, TO=TOID, KEY=KEY)
    back = sub("""SELECT CAST(j.id AS CHAR) AS job_id, j.job_status, t.is_processing,
       SUBSTRING(DATE_FORMAT(t.update_time, '%Y-%m-%d %H:%i:%s.%f'), 1, 23) AS update_time,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('PWC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0
         ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM gd_async_job j
  LEFT JOIN transfer_order_putaway t ON t.tenant_id = j.tenant_id AND t.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND t.is_deleted = 0
 WHERE j.tenant_id = '@T' AND j.idempotency_key = '@KEY' AND j.is_deleted = 0
 ORDER BY j.id DESC LIMIT 1""", T=T, KEY=KEY)

    def sres(tag, src, title, back_node=None):
        call_ = "submitResult([%s][0], %s, [%s][0], %s)" % (N(Gd, "data"), "null" if src == Gd else "[%s][0]" % N(E, "data"), N(src, "data"),
                                                          "[%s][0]" % N(back_node, "data") if back_node else "null")
        body = scode("result.js") + "\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, job: res.job_id }));\nreturn res;" % call_
        return [K.code("code_node_PS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_PS%s" % tag, "Return (%s)" % title, [(f, N("code_node_PS%sres" % tag, "data." + f)) for f in SUB_RES])]

    sub_cols = {"hdr": ["j", "lock_age_sec", "gr_status"]}
    read_nodes = [("cai_PS" + k, k, [K.sql("sql_node_PS" + k, title, SUBMIT_SQL[k], sub_cols.get(k, ["j"]))])
                  for k, title in (("hdr", "The putaway (+ its lock age, its receipt's status)"), ("lines", "Its lines"), ("items", "Items of its lines"),
                                   ("cost", "Costing rows of the lines' item / batch pairs (the engine's costing-migration refusal)"))]
    gate_body = "\n".join([raw("lift/runtime.js"), raw("lift/lifted_prepare.js"), code("prepare/adapter.js"), code("prepare/chain.js"), code("submit/_common.js"),
                           code("submit/gate.js"), code("submit/gate_tail.js")])
    entry_fields = ["route", "code", "message", "reason", "tenantId", "toId", "toNo", "grId", "organizationId", "plantId", "dbNow", "lockN", "jobId", "jobStatus",
                    "progressPercent", "progressMessage", "errorCode", "errorMessage"]
    nodes = [
        K.code(Gd, "Guard: operation, to_id, idempotency key, who confirms, the confirmation, session tenant + user", scode("guard.js"),
               ["route", "code", "message", "operation", "toId", "key", "tenantId", "uid", "confirmedBy", "request"], objects=("request",)),
        K.if_(ids, "if_PSreject", "IF the input is invalid: answer, write nothing", is_(Gd, "route", "REJECT"), sres("rej", Gd, "rejected input")),
        K.sql("sql_node_PSfacts", "Facts: the job of this key, the putaway, its latest lock, open / latest COMPLETE_PUTAWAY jobs, DB clock", facts,
              ["db_now", "key_job", "to_db_id", "to_no", "gr_no", "organization_id", "plant_id", "last_lock", "open_jobs", "last_job"]),
        K.code(E, "Entry: STATUS / this key's job; SUBMIT goes on for a putaway with no open job", scode("entry.js"), entry_fields, objects=("lockN", "progressPercent")),
        K.if_(ids, "if_PSanswer", "IF answered here (STATUS / BUSY / STOP): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"), sres("ans", E, "entry")),
        K.parallel("condition_all_PSread", "The gates' reads in parallel", read_nodes),
        K.code(GT, "Gate: pwGates (state, lock, contract, eligibility, PUTAWAY_LOOP's and PUTAWAY's gates lifted, on the stored pending)", gate_body,
               ["route", "code", "message", "reason", "rowCount", "lineCount"], objects=("rowCount", "lineCount")),
        K.if_(ids, "if_PSgateEnd", "IF the gate answered (NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"), sres("gate", GT, "gate")),
        K.code(PO, "Post: the queue rows (lock, the job QUEUED 2 minutes ahead, is_processing 1)", scode("post.js"),
               ["route", "code", "message", "lockRows", "jobRows", "toRows"], arrays=("lockRows", "jobRows", "toRows")),
        K.if_(ids, "if_PSpostEnd", "IF nothing to queue: answer, write nothing", "'%s' != 'QUEUE'" % N(PO, "data.route"), sres("post", PO, "post")),
        step_add(ids, "add_node_PSlock", "LOCK: gd_publish_step PWC|<to> / LOCK|<n> (unique tenant / job / step: a concurrent submit fails its run)", PO, "lockRows"),
        K.add(ids, "add_node_PSjob", "Job insert: COMPLETE_PUTAWAY QUEUED, due in 2 minutes (unique idempotency key)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in G.JOB_ADD_COLS], labels={"organization_id": "Organization"}),
        K.update(ids, "update_node_PSto", "Putaway locked: is_processing 1 (the lock every writer honours)", TO, ("id", "in", N(PO, "data.toRows.id")),
                 [("id", N(PO, "data.toRows.id")), ("is_processing", N(PO, "data.toRows.is_processing"))]),
        K.sql("sql_node_PSback", "Read-back: the job of this key, the putaway's lock flag + update_time, its latest lock", back,
              ["job_id", "job_status", "is_processing", "update_time", "lock_ref"]),
        K.code("code_node_PSdue", "Due: the putaway is locked under this job -> the job due now, with the putaway's update_time", scode("due.js"), ["dueRows", "needDue"], arrays=("dueRows",)),
        gate(ids, "cor_PSdue", "Job to make due?", "code_node_PSdue", "needDue", [
            K.update(ids, "update_node_PSdue", "Job due now + the recorded update_time (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_PSdue", "data.dueRows.id")),
                     [(p, N("code_node_PSdue", "data.dueRows." + p)) for p in ["id", "next_attempt_at", "request_payload"]])]),
    ] + sres("done", PO, "queued", "sql_node_PSback")
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"), ("to_id", "string", "transfer_order_putaway.id (digits)"),
                       ("idempotency_key", "string", "one per click and content (8-128 chars A-Z a-z 0-9 | : _ . -)"),
                       ("confirmed_by", "string", "the session nickname ({{global:nickname}} is null inside a workflow)"),
                       ("request", "any", "{ source, lines: [{ id | parent_id, qty, target_location, target_inv_category, remark, storage_location }] }")], SUB_RES, nodes)


BUILDERS = [("PUTAWAY_BULK_PREPARE", build_prepare), ("PUTAWAY_BULK_COMMIT", build_commit), ("PUTAWAY_ASYNC_WORKER", build_worker), ("PUTAWAY_ASYNC_SUBMIT", build_submit)]

if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, fn in BUILDERS:
        if want and name not in want:
            continue
        doc = G.wrap_doc_sql(fn())
        K.check_ids(doc)
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        path = os.path.join(OUT, name + ".json")
        print(f"{name}: {len(text)} chars, {len(K.check_ids(doc))} nodes" + (f" -> {path}" if "--write" in sys.argv else " (dry; --write to save)"))
        if "--write" in sys.argv:
            os.makedirs(OUT, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text + "\n")
