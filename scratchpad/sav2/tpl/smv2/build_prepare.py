"""LOT_V2_PREPARE builder (package A; CONTRACT.md sections 5, 9, 14). build_lot.py imports BUILDERS.

Graph (grv2 / pwv2 PREPARE shape): guard -> job read -> entry (NOOP answers) -> ONE fork-join of uncapped SQL reads ->
plan (adapter + the lifted v82 bodies + fold + manifest parts) -> ready -> writes (parts, READY | unlock + FAILED / REVIEW) ->
read-back -> result.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402

# loaded by path under its own name: other packages' builders have a sql.py of their own
_spec = importlib.util.spec_from_file_location("lot_prepare_sql", os.path.join(HERE, "prepare", "sql.py"))
PSQL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PSQL)

LOT_TABLE = "Location Transfer:Table:2013791389687349250"
NAME = "LOT_V2_PREPARE"
RES = ["job_id", "job_status", "result_code", "result_message", "evidence"]


def src(path):
    return V.raw(HERE, path)


def shared(name):
    return V.include_js(HERE, "code/shared/" + name)


def build_prepare():
    ids = K.Ids(1799100000000)
    N = V.N
    Gd, E, P, RD = "code_node_LPguard", "code_node_LPentry", "code_node_LPplan", "code_node_LPready"
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], "
                "evidence: JSON.stringify({ v: 1, workflow: \"LOT_V2_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(Gd, "data.result_code"), N(Gd, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"LOT_V2_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    reads = [("parts", "SUBMIT's payload parts of the job (S|..|LINES)"), ("hdr", "The Location Transfer header"), ("lines", "Its stored lines (line_index order)"),
             ("transit", "Its In Transit rows (every status)"), ("items", "Items of its lines"), ("bins", "The plant's bins (LABELS)"), ("lock", "Its latest document lock")]
    branches = [("cai_LP" + k, title, [K.sql("sql_node_LP" + k, title, PSQL.READS[k][0], PSQL.READS[k][1])]) for k, title in reads]
    plan_tail = "\n".join([
        "const entry = [%s][0];" % N(E, "data"),
        "const S = { " + ", ".join("%s: [%s][0]" % (k, N("sql_node_LP" + k, "data")) for k, _ in reads) + " };",
        "const own = { locked: 0 };",
        "let res;",
        "try {",
        "  res = lotPrepPlan(entry, S, own);",
        "} catch (e) {",
        "  // unlock only when the throw came after the lock-owner check passed",
        "  res = { route: \"FAIL\", code: \"LOT_PLAN_BROKEN\", message: \"The save could not be prepared: \" + String((e && e.message) || e).slice(0, 200), payload: \"\", partRows: [],",
        "    lineCount: 0, movementCount: 0, unlockOk: own.locked === 1 ? 1 : 0 };",
        "}",
        "console.log(\"prepare plan\", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk }));",
        "return { route: res.route, code: res.code, message: res.message, payload: res.payload, partRows: res.partRows, lineCount: res.lineCount,",
        "  movementCount: res.movementCount, unlockOk: res.unlockOk };",
    ])
    plan_code = "\n".join([shared("lot_common.js"), src("lib/lift/runtime.js"), src("lift/lifted_prepare.js"), src("code/prepare/adapter.js"), src("code/prepare/plan.js"), plan_tail])
    plan_fields = ["route", "code", "message", "payload", "partRows", "lineCount", "movementCount", "unlockOk"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message", "job_status"]
    unlock = V.status_unlock(LOT_TABLE, "stock_movement_status", {"stock_movement_status": "Stock Movement Status"})
    nodes = [
        K.code(Gd, "Guard: job_id (digits), session tenant", src("code/prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_LPreject", "IF the input is invalid: answer, write nothing", V.is_(Gd, "route", "REJECT"), [
            K.code("code_node_LPrej", "Answer (rejected input)", rej_body, RES),
            K.ret("return_node_LPrej", "Return (rejected input)", [(f, N("code_node_LPrej", "data." + f)) for f in RES])]),
        K.sql("sql_node_LPjob", "The job (+ DB clock, lease flag, request; the LOT an unlinked SUBMIT left Processing)", PSQL.JOB_SQL, PSQL.JOB_COLS),
        K.code(E, "Entry: a VALIDATING SAVE_LOT job under a live lease; its correlation -> the LOT; its request (prevStatus, action)",
               shared("lot_common.js") + "\n" + src("code/prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "lotId", "idempotencyKey", "rowVersion", "attempts", "dbNow", "nonce", "request", "action", "prevStatus", "saveAs",
                "unlockRows", "result_code", "result_message"], arrays=("unlockRows",), objects=("request", "rowVersion", "attempts")),
        K.if_(ids, "if_LPnoop", "IF the job is not this run's to prepare: answer, write nothing", V.is_(E, "route", "NOOP"), [
            K.code("code_node_LPnoop", "Answer (not prepared)", noop_body, RES),
            K.ret("return_node_LPnoop", "Return (not prepared)", [(f, N("code_node_LPnoop", "data." + f)) for f in RES])]),
        K.parallel("condition_all_LPread", "Set-based reads in parallel (no row limits)", branches),
        K.code(P, "Plan: the stored LOT (+ SUBMIT's lines) -> the classic v82 compute (lifted) -> the manifest and its parts", plan_code, plan_fields,
               arrays=("partRows",), objects=("lineCount", "movementCount", "unlockOk")),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ the LOT back to prevStatus) / REQUIRES_REVIEW",
               shared("lot_common.js") + "\n" + src("code/prepare/ready.js"), ready_fields, arrays=("readyRows", "jobRows", "unlockRows")),
        V.gate(ids, "cor_LPparts", "Manifest parts to write?", RD, "needParts", [
            K.add(ids, "add_node_LPparts", "Manifest parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", V.STEP,
                  [(p, N(P, "data.partRows." + p)) for p in V.PART_COLS], labels={"organization_id": "Organization"})]),
        V.gate(ids, "cor_LPready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_LPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", V.JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message",
                                                                  "error_details", "prepared_payload", "line_count"]])]),
        V.gate(ids, "cor_LPunlock", "Location Transfer to release?", RD, "needUnlock", [
            unlock(ids, "update_node_LPunlock", "Location Transfer back to its status before the save (nothing was moved)", RD)]),
        V.gate(ids, "cor_LPfail", "Job FAILED / REQUIRES_REVIEW to write?", RD, "needJobUpd", [
            V.job_update(ids, "update_node_LPfail", "Job FAILED / REQUIRES_REVIEW with the reason (lease released)", RD, "jobRows")]),
        K.sql("sql_node_LPback", "Read-back: the job after the write (the truth)", PSQL.BACK_SQL, PSQL.BACK_COLS),
        K.code("code_node_LPresult", "Result", src("code/prepare/result.js"), RES),
        K.ret("return_node_LPdone", "Return", [(f, N("code_node_LPresult", "data." + f)) for f in RES]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a VALIDATING SAVE_LOT job the worker holds")], RES, nodes)


BUILDERS = [(NAME, build_prepare)]

if __name__ == "__main__":
    V.build(BUILDERS, os.path.join(HERE, "..", "..", "Stock Movement", "Location Transfer", "AsyncV2"), "--write" in sys.argv)
