"""SA_V2_PREPARE builder (package A; CONTRACT.md sections 5, 9, 14, 16). build_sa.py imports BUILDERS.

Graph (smv2 / grv2 PREPARE shape): guard -> job read -> entry (NOOP answers) -> ONE fork-join of uncapped SQL reads (its plan
branch is a dependent chain: the job's S| parts -> the stored lines -> the review's id lists -> a nested fork-join of the review
reads) -> plan (adapter + the lifted bodies + the shared review chain + manifest parts) -> ready -> writes (parts, READY | unlock +
FAILED / REVIEW) -> read-back -> result.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402

# loaded by path under its own name: other packages' builders have a sql.py of their own
_spec = importlib.util.spec_from_file_location("sa_prepare_sql", os.path.join(HERE, "prepare", "sql.py"))
PSQL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PSQL)

SA_TABLE = "Stock Adjustment:Table:1902274108952006658"
NAME = "SA_V2_PREPARE"
RES = ["job_id", "job_status", "result_code", "result_message", "evidence"]
RV = list(PSQL.RSQL.REVIEW_READS)


def src(path):
    return V.raw(HERE, path)


def shared(name):
    return V.include_js(HERE, "code/shared/" + name)


def build_prepare():
    ids = K.Ids(1799600000000)
    N = V.N
    Gd, E, IDS, P, RD = "code_node_SPguard", "code_node_SPentry", "code_node_SPids", "code_node_SPplan", "code_node_SPready"
    assert (Gd, E, IDS) == (PSQL.GUARD, PSQL.ENTRY, PSQL.IDS)
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], "
                "evidence: JSON.stringify({ v: 1, workflow: \"SA_V2_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(Gd, "data.result_code"), N(Gd, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"SA_V2_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    sql = lambda k, title, pair: K.sql("sql_node_SP" + k, title, pair[0], pair[1])
    chain_js = "\n".join([src("lib/lift/runtime.js"), shared("sa_common.js"), shared("review_chain.js")])
    ids_fields = ["MID", "LID", "BMID", "BLID", "UID", "BID", "CMID", "ORG", "needReview", "why"]
    rv_titles = {"items": "Items (the build; LABELS item codes)", "balances": "Item balances (review: material IN + location IN)",
                 "batch_balances": "Item batch balances (review: material IN + location IN)", "bins": "Bins (the build; LABELS bin codes)",
                 "uoms": "UOMs (review)", "batches": "Batches (review)", "costs": "Current WA / FIFO costs (review: sql_review_costs)",
                 "prefix": "The SA numbering rule (review: get_sa_prefix)"}
    plan_branch = [
        sql("parts", "SUBMIT's payload parts of the job (S|..|DOC / S|..|SC)", PSQL.READS["parts"]),
        sql("lines", "The stored lines (FP_SA_LINES + every line column; line_index order)", PSQL.READS["lines"]),
        K.code(IDS, "Ids: the review's id lists (lifted prep over the S|..|SC record) / the lines' ids (LABELS)",
               chain_js + "\n" + src("code/prepare/ids.js"), ids_fields),
        K.parallel("condition_all_SPrv", "The review reads (code/shared/review_sql.py) in parallel",
                   [("cai_SPrv_" + k, rv_titles[k], [sql("rv_" + k, rv_titles[k], PSQL.REVIEW[k])]) for k in ("items", "bins")] +
                   [("cai_SPrv_review", "The review-only reads (a REVIEW job)", [
                       V.gate(ids, "cor_SPrv", "Review reads to run (REVIEW job)?", IDS, "needReview", [
                           K.parallel("condition_all_SPrvR", "The review-only reads in parallel",
                                      [("cai_SPrv_" + k, rv_titles[k], [sql("rv_" + k, rv_titles[k], PSQL.REVIEW[k])]) for k in RV if k not in ("items", "bins")])])])]),
    ]
    branches = [
        ("cai_SPhdr", "The Stock Adjustment header + its lock", [sql("hdr", "The Stock Adjustment header + its latest SAC| lock", PSQL.READS["hdr"])]),
        ("cai_SPsc", "The review's Stock Count lines", [sql("sclines", "The review's Stock Count lines (FP_SC_LINES)", PSQL.READS["sclines"])]),
        ("cai_SPplan", "Parts -> lines -> id lists -> the review reads", plan_branch),
    ]
    plan_tail = "\n".join([
        "const entry = [%s][0];" % N(E, "data"),
        "const S = { hdr: [%s][0], lines: [%s][0], parts: [%s][0], sclines: [%s][0], ids: [%s][0]," % (
            N("sql_node_SPhdr", "data"), N("sql_node_SPlines", "data"), N("sql_node_SPparts", "data"), N("sql_node_SPsclines", "data"), N(IDS, "data")),
        "  rv: { " + ", ".join("%s: [%s][0]" % (k, N("sql_node_SPrv_" + k, "data")) for k in RV) + " } };",
        "const own = { locked: 0 };",
        "let res;",
        "try {",
        "  res = saPrepPlan(entry, S, own);",
        "} catch (e) {",
        "  // unlock only when the throw came after the lock check passed",
        "  res = { route: \"FAIL\", code: \"SA_PLAN_BROKEN\", message: \"The save could not be prepared: \" + String((e && e.message) || e).slice(0, 200), payload: \"\", partRows: [],",
        "    lineCount: 0, movementCount: 0, unlockOk: own.locked === 1 ? 1 : 0 };",
        "}",
        "console.log(\"prepare plan\", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk }));",
        "return { route: res.route, code: res.code, message: res.message, payload: res.payload, partRows: res.partRows, lineCount: res.lineCount,",
        "  movementCount: res.movementCount, unlockOk: res.unlockOk };",
    ])
    plan_code = "\n".join([chain_js, shared("fingerprint.js"), src("lift/lifted_prepare.js"), src("code/prepare/adapter.js"), src("code/prepare/plan.js"), plan_tail])
    plan_fields = ["route", "code", "message", "payload", "partRows", "lineCount", "movementCount", "unlockOk"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needPark", "parkRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message",
                    "job_status"]
    ready_props = ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message", "error_details", "prepared_payload", "line_count"]
    unlock = V.status_unlock(SA_TABLE, "stock_adjustment_status", {"stock_adjustment_status": "Stock Adjustment Status"})
    nodes = [
        K.code(Gd, "Guard: job_id (digits), session tenant", src("code/prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_SPreject", "IF the input is invalid: answer, write nothing", V.is_(Gd, "route", "REJECT"), [
            K.code("code_node_SPrej", "Answer (rejected input)", rej_body, RES),
            K.ret("return_node_SPrej", "Return (rejected input)", [(f, N("code_node_SPrej", "data." + f)) for f in RES])]),
        K.sql("sql_node_SPjob", "The job (+ DB clock, lease flag, request; the SA an unlinked SUBMIT left Processing)", PSQL.JOB_SQL, PSQL.JOB_COLS),
        K.code(E, "Entry: a VALIDATING COMPLETE_SA job under a live lease; its correlation -> the Stock Adjustment; its request (source, action, prevStatus)",
               shared("sa_common.js") + "\n" + src("code/prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "saId", "scId", "idempotencyKey", "rowVersion", "attempts", "dbNow", "nonce", "request", "action", "source",
                "prevStatus", "saveAs", "unlockRows", "result_code", "result_message"], arrays=("unlockRows",), objects=("request", "rowVersion", "attempts")),
        K.if_(ids, "if_SPnoop", "IF the job is not this run's to prepare: answer, write nothing", V.is_(E, "route", "NOOP"), [
            K.code("code_node_SPnoop", "Answer (not prepared)", noop_body, RES),
            K.ret("return_node_SPnoop", "Return (not prepared)", [(f, N("code_node_SPnoop", "data." + f)) for f in RES])]),
        K.parallel("condition_all_SPread", "Set-based reads in parallel (no row limits)", branches),
        K.code(P, "Plan: the locked Stock Adjustment (+ SUBMIT's part) -> the classic v24 loop (lifted) / the shared review chain -> the manifest and its parts",
               plan_code, plan_fields, arrays=("partRows",), objects=("lineCount", "movementCount", "unlockOk")),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ the SA back to prevStatus) / REQUIRES_REVIEW",
               shared("sa_common.js") + "\n" + src("code/prepare/ready.js"), ready_fields, arrays=("readyRows", "parkRows", "jobRows", "unlockRows")),
        V.gate(ids, "cor_SPparts", "Manifest parts to write?", RD, "needParts", [
            K.add(ids, "add_node_SPparts", "Manifest parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", V.STEP,
                  [(p, N(P, "data.partRows." + p)) for p in V.PART_COLS], labels={"organization_id": "Organization"})]),
        V.gate(ids, "cor_SPready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_SPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", V.JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in ready_props])]),
        V.gate(ids, "cor_SPpark", "Job READY_TO_COMMIT parked (> 1,000 entries) to write?", RD, "needPark", [
            K.update(ids, "update_node_SPpark", "Job READY_TO_COMMIT + manifest, PARKED: lease cleared, due now (the next tick commits)", V.JOB,
                     ("id", "in", N(RD, "data.parkRows.id")), [(p, N(RD, "data.parkRows." + p)) for p in ready_props + ["lease_owner", "lease_expires_at", "next_attempt_at"]])]),
        V.gate(ids, "cor_SPunlock", "Stock Adjustment to release?", RD, "needUnlock", [
            unlock(ids, "update_node_SPunlock", "Stock Adjustment back to its status before the completion (nothing was moved)", RD)]),
        V.gate(ids, "cor_SPfail", "Job FAILED / REQUIRES_REVIEW to write?", RD, "needJobUpd", [
            V.job_update(ids, "update_node_SPfail", "Job FAILED / REQUIRES_REVIEW with the reason (lease released)", RD, "jobRows")]),
        K.sql("sql_node_SPback", "Read-back: the job after the write (the truth)", PSQL.BACK_SQL, PSQL.BACK_COLS),
        K.code("code_node_SPresult", "Result", src("code/prepare/result.js"), RES),
        K.ret("return_node_SPdone", "Return", [(f, N("code_node_SPresult", "data." + f)) for f in RES]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a VALIDATING COMPLETE_SA job the worker holds")], RES, nodes)


BUILDERS = [(NAME, build_prepare)]

if __name__ == "__main__":
    V.build(BUILDERS, os.path.join(HERE, "..", "..", "Stock Adjustment", "AsyncV2"), "--write" in sys.argv)
