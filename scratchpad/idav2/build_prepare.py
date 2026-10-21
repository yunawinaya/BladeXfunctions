"""IDA_V2_PREPARE builder (package A; CONTRACT.md sections 5, 9, 14): guard -> job -> entry -> ONE fork-join of the seven stored reads ->
plan (lifted IDA_SAVE v6 bodies) -> the two engine PLANs in ONE fork-join -> ready -> writes -> read-back.
usage: python3 build_prepare.py [--write]   (or build_ida.py, which imports BUILDERS)"""
import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402

# loaded by path under its own name: other packages' builders have a sql.py of their own
_spec = importlib.util.spec_from_file_location("ida_prepare_sql", os.path.join(HERE, "prepare", "sql.py"))
PSQL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PSQL)

NAME = "IDA_V2_PREPARE"
IDA_TABLE = "Item Disassembly:Table:2106937624568991746"
RES = ["job_id", "job_status", "result_code", "result_message", "evidence"]
READS = [("owner", "The lock facts: status, ida_v2_job_id, the latest IDC| LOCK row (code/shared/sql.py OWNER)"),
         ("hdr", "The stored header with the source picks (FP_HEADER)"), ("lines", "The stored recovery lines (FP_LINES)"),
         ("items", "The source item + every line's item (ITEMS_STORED; ids from the stored rows)"),
         ("bins", "The bins of the source picks and of every line (BINS_STORED, LABELS)"),
         ("typed", "Live Batch rows of the organization holding a stored line's typed number (BATCH_TYPED_STORED; code_validate's search_batches)"),
         ("storage", "The stored lines' storage location (code_validate's line rule; FP_LINES does not carry it)")]
PLAN_FIELDS = ["route", "code", "message", "payload", "partRows", "lineCount", "pickCount", "moveCount", "movementCountI", "movementCountR", "unlockOk", "organizationId",
               "opKeyI", "opKeyR", "movementsI", "movementsR", "labels"]
READY_PROPS = ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message", "error_details", "prepared_payload", "line_count"]


def src(path):
    return V.raw(HERE, path)


def shared(name):
    return V.include_js(HERE, "code/shared/" + name)


def ids_json():
    return json.load(open(os.path.join(HERE, "ids.json"), encoding="utf-8"))


def build_prepare():
    ids = K.Ids(1801100000000)
    N = V.N
    Gd, E, P, RD = PSQL.GUARD, PSQL.ENTRY, "code_node_DPplan", "code_node_DPready"
    assert ids_json()["INVENTORY_BULK_APPLY"] == V.ENGINE[1]
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], "
                "evidence: JSON.stringify({ v: 1, workflow: \"IDA_V2_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(Gd, "data.result_code"), N(Gd, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"IDA_V2_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    branches = [("cai_DP" + k, title, [K.sql("sql_node_DP" + k, title, PSQL.READS[k][0], PSQL.READS[k][1])]) for k, title in READS]
    plan_tail = "\n".join([
        "const entry = [%s][0];" % N(E, "data"),
        "const S = { " + ", ".join("%s: [%s][0]" % (k, N("sql_node_DP" + k, "data")) for k, _ in READS) + " };",
        "const own = { locked: 0 };",
        "let res;",
        "try {",
        "  res = idaPrepPlan(entry, S, own);",
        "} catch (e) {",
        "  // unlock only when the throw came after the lock check passed",
        "  res = { route: \"FAIL\", code: \"IDA_PLAN_BROKEN\", message: IDA_TEXT.planFailed(String((e && e.message) || e).slice(0, 200)), payload: \"\", partRows: [], lineCount: 0,",
        "    pickCount: 0, moveCount: 0, movementCountI: 0, movementCountR: 0, unlockOk: own.locked === 1 ? 1 : 0, organizationId: \"\", opKeyI: \"\", opKeyR: \"\", movementsI: [],",
        "    movementsR: [], labels: {} };",
        "}",
        "console.log(\"prepare plan\", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, picks: res.pickCount,",
        "  movementsI: res.movementCountI, movementsR: res.movementCountR, parts: res.partRows.length, unlock: res.unlockOk }));",
        "return { route: res.route, code: res.code, message: res.message, payload: res.payload, partRows: res.partRows, lineCount: res.lineCount, pickCount: res.pickCount,",
        "  moveCount: res.moveCount, movementCountI: res.movementCountI, movementCountR: res.movementCountR, unlockOk: res.unlockOk, organizationId: res.organizationId,",
        "  opKeyI: res.opKeyI, opKeyR: res.opKeyR, movementsI: res.movementsI, movementsR: res.movementsR, labels: res.labels };",
    ])
    plan_code = "\n".join([shared("ida_common.js"), shared("fingerprint.js"), shared("price.js"), src("lib/lift/runtime.js"), src("lift/lifted_prepare.js"),
                           src("code/prepare/adapter.js"), src("code/prepare/plan.js"), plan_tail])
    assert "{{" not in plan_code.replace(plan_tail, ""), "a platform token outside the plan tail"
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needLink", "linkRows", "needUnlock", "unlockRows", "result_code", "result_message",
                    "job_status"]
    unlock = V.status_unlock(IDA_TABLE, "item_disassembly_status", {"item_disassembly_status": "Item Disassembly Status"})

    def engine(side, title):
        return V.call(ids, "workflow_node_DPplan" + side, title, V.ENGINE, [
            ("operation_key", N(P, "data.opKey" + side)), ("mode", "PLAN", "value"), ("organization_id", N(P, "data.organizationId")),
            ("movements", N(P, "data.movements" + side))])

    nodes = [
        K.code(Gd, "Guard: job_id (digits), session tenant", src("code/prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_DPreject", "IF the input is invalid: answer, write nothing", V.is_(Gd, "route", "REJECT"), [
            K.code("code_node_DPrej", "Answer (rejected input)", rej_body, RES),
            K.ret("return_node_DPrej", "Return (rejected input)", [(f, N("code_node_DPrej", "data." + f)) for f in RES])]),
        K.sql("sql_node_DPjob", "The job (+ DB clock, lease flag, request; the IDA an unlinked SUBMIT left Processing)", PSQL.JOB_SQL, PSQL.JOB_COLS),
        K.code(E, "Entry: a VALIDATING COMPLETE_IDA job under a live lease; its correlation -> the Item Disassembly; its request (action, prevStatus)",
               shared("ida_common.js") + "\n" + src("code/prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "idaId", "idempotencyKey", "rowVersion", "attempts", "dbNow", "jsAt", "nonce", "request", "action",
                "prevStatus", "saveAs", "needRead", "unlockRows", "link", "result_code", "result_message"], arrays=("unlockRows",),
               objects=("request", "rowVersion", "attempts", "link")),
        K.if_(ids, "if_DPnoop", "IF the job is not this run's to prepare: answer, write nothing", V.is_(E, "route", "NOOP"), [
            K.code("code_node_DPnoop", "Answer (not prepared)", noop_body, RES),
            K.ret("return_node_DPnoop", "Return (not prepared)", [(f, N("code_node_DPnoop", "data." + f)) for f in RES])]),
        V.gate(ids, "cor_DPread", "Reads to run (the entry goes on)?", E, "needRead", [
            K.parallel("condition_all_DPread", "The seven stored reads in parallel (keyed by the job's IDA; no row limits, no dependent read)", branches)]),
        K.code(P, "Plan: the locked Item Disassembly -> the classic IDA_SAVE v6 gate (code_validate on fresh rows) and issue / receipt / batch code (lifted) -> the manifest, "
                  "its parts, the two engine requests",
               plan_code, PLAN_FIELDS, arrays=("partRows", "movementsI", "movementsR"),
               objects=("lineCount", "pickCount", "moveCount", "movementCountI", "movementCountR", "unlockOk", "labels")),
        K.if_(ids, "if_DPengine", "IF planned: INVENTORY_BULK_APPLY in PLAN mode for both operations (no lock, writes nothing)", V.is_(P, "route", "PLAN"), [
            K.parallel("condition_all_DPplan", "The two PLAN calls in parallel", [
                ("cai_DPplanI", "Op 1: the source issue", [engine("I", "INVENTORY_BULK_APPLY PLAN of op 1 (IDC|<job>|I): every source pick checked and priced")]),
                ("cai_DPplanR", "Op 2: the receipt", [engine("R", "INVENTORY_BULK_APPLY PLAN of op 2 (IDC|<job>|R): every stock line's receipt at unit_price 0, no batch")])])]),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ the IDA back to Draft: nothing was moved) / REQUIRES_REVIEW",
               "\n".join([shared("ida_common.js"), shared("movekey.js"), src("code/prepare/ready.js")]), ready_fields, arrays=("readyRows", "jobRows", "linkRows", "unlockRows")),
        V.gate(ids, "cor_DPparts", "Manifest parts to write?", RD, "needParts", [
            K.add(ids, "add_node_DPparts", "Manifest parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", V.STEP,
                  [(p, N(P, "data.partRows." + p)) for p in V.PART_COLS], labels={"organization_id": "Organization"})]),
        V.gate(ids, "cor_DPready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_DPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", V.JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in READY_PROPS])]),
        V.gate(ids, "cor_DPunlock", "Item Disassembly to release?", RD, "needUnlock", [
            unlock(ids, "update_node_DPunlock", "Item Disassembly back to Draft (nothing was moved)", RD)]),
        V.gate(ids, "cor_DPfail", "Job FAILED / REQUIRES_REVIEW to write?", RD, "needJobUpd", [
            V.job_update(ids, "update_node_DPfail", "Job FAILED / REQUIRES_REVIEW with the reason (lease released)", RD, "jobRows")]),
        V.gate(ids, "cor_DPlink", "Job FAILED + the link to write (an Add that stopped before link)?", RD, "needLink", [
            V.job_update(ids, "update_node_DPlink", "Job FAILED + correlation IDA|<id>, causation, request idaId / idaNo / issuedNo (STATUS then answers the IDA)", RD,
                         "linkRows", V.JOB_PROPS + ["correlation_id", "causation_id", "request_payload"])]),
        K.sql("sql_node_DPback", "Read-back: the job after the write (the truth)", PSQL.BACK_SQL, PSQL.BACK_COLS),
        K.code("code_node_DPresult", "Result", src("code/prepare/result.js"), RES),
        K.ret("return_node_DPdone", "Return", [(f, N("code_node_DPresult", "data." + f)) for f in RES]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a VALIDATING COMPLETE_IDA job the worker holds")], RES, nodes)


BUILDERS = [(NAME, build_prepare)]

if __name__ == "__main__":
    V.build(BUILDERS, os.path.join(HERE, "..", "..", "Item Disassembly", "AsyncV2"), "--write" in sys.argv)
