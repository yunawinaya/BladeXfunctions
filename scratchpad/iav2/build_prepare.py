"""IA_V2_PREPARE builder (package A; CONTRACT.md sections 5, 9, 14): guard -> job -> entry -> one fork-join of reads -> plan (lifted
IA_SAVE v11 bodies) -> two engine PLANs in parallel -> ready -> writes -> read-back. usage: python3 build_prepare.py [--write]"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402

# loaded by path under its own name: other packages' builders have a sql.py of their own
_spec = importlib.util.spec_from_file_location("ia_prepare_sql", os.path.join(HERE, "prepare", "sql.py"))
PSQL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PSQL)

NAME = "IA_V2_PREPARE"
IA_TABLE = "Item Assembly:Table:2098256587713404929"
RES = ["job_id", "job_status", "result_code", "result_message", "evidence"]
READS = [("owner", "The lock facts: status, ia_v2_job_id, the latest IAC| LOCK row (code/shared/sql.py OWNER)"),
         ("hdr", "The stored header (FP_HEADER_OS: + the output split's rows)"), ("lines", "The stored component lines (FP_LINES)"),
         ("items", "The parent + component items (ITEMS; ids from the stored rows)"), ("bins", "The bins of the header, every pick and every output split row (LABELS; the split's plant check)"),
         ("res", "RES-01: the IA's own holds, its running hold tickets, its hold status (scratchpad/iasc res01)")]
PLAN_FIELDS = ["route", "code", "message", "payload", "partRows", "lineCount", "pickCount", "movementCount", "unlockOk", "organizationId", "opKeyI", "opKeyR",
               "movementsI", "movementsR", "labels"]
READY_PROPS = ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message", "error_details", "prepared_payload", "line_count"]


def src(path):
    return V.raw(HERE, path)


def shared(name):
    return V.include_js(HERE, "code/shared/" + name)


def ids_json():
    return json.load(open(os.path.join(HERE, "ids.json"), encoding="utf-8"))


def build_prepare():
    ids = K.Ids(1799700000000)
    N = V.N
    Gd, E, P, RD = PSQL.GUARD, PSQL.ENTRY, "code_node_IPplan", "code_node_IPready"
    assert ids_json()["INVENTORY_BULK_APPLY"] == V.ENGINE[1]
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], "
                "evidence: JSON.stringify({ v: 1, workflow: \"IA_V2_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(Gd, "data.result_code"), N(Gd, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"IA_V2_PREPARE\", path: \"NOOP\" }) };") % N(E, "data")
    branches = [("cai_IP" + k, title, [K.sql("sql_node_IP" + k, title, PSQL.READS[k][0], PSQL.READS[k][1])]) for k, title in READS]
    plan_tail = "\n".join([
        "const entry = [%s][0];" % N(E, "data"),
        "const S = { " + ", ".join("%s: [%s][0]" % (k, N("sql_node_IP" + k, "data")) for k, _ in READS) + " };",
        "const own = { locked: 0 };",
        "let res;",
        "try {",
        "  res = iaPrepPlan(entry, S, own);",
        "} catch (e) {",
        "  // unlock only when the throw came after the lock check passed",
        "  res = { route: \"FAIL\", code: \"IA_PLAN_BROKEN\", message: \"The completion could not be prepared: \" + String((e && e.message) || e).slice(0, 200), payload: \"\",",
        "    partRows: [], lineCount: 0, pickCount: 0, movementCount: 0, unlockOk: own.locked === 1 ? 1 : 0, organizationId: \"\", opKeyI: \"\", opKeyR: \"\", movementsI: [],",
        "    movementsR: [], labels: {} };",
        "}",
        "console.log(\"prepare plan\", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, picks: res.pickCount,",
        "  movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk }));",
        "return { route: res.route, code: res.code, message: res.message, payload: res.payload, partRows: res.partRows, lineCount: res.lineCount, pickCount: res.pickCount,",
        "  movementCount: res.movementCount, unlockOk: res.unlockOk, organizationId: res.organizationId, opKeyI: res.opKeyI, opKeyR: res.opKeyR, movementsI: res.movementsI,",
        "  movementsR: res.movementsR, labels: res.labels };",
    ])
    plan_code = "\n".join([shared("ia_common.js"), shared("fingerprint.js"), shared("price.js"), src("lib/lift/runtime.js"), src("lift/lifted_prepare.js"),
                           src("code/prepare/adapter.js"), V.include_js(os.path.join(HERE, "..", "iasc", "res01", "code"), "shared/split.js"),
                           V.include_js(os.path.join(HERE, "..", "iasc", "code"), "shared/os_split.js"), src("code/prepare/plan.js"),
                           plan_tail])
    assert "{{" not in plan_code.replace(plan_tail, ""), "a platform token outside the plan tail"
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needLink", "linkRows", "needUnlock", "unlockRows", "result_code", "result_message",
                    "job_status"]
    unlock = V.status_unlock(IA_TABLE, "item_assembly_status", {"item_assembly_status": "Item Assembly Status"})

    def engine(tag, side, title):
        return V.call(ids, "workflow_node_IPplan" + tag, title, V.ENGINE, [
            ("operation_key", N(P, "data.opKey" + side)), ("mode", "PLAN", "value"), ("organization_id", N(P, "data.organizationId")),
            ("movements", N(P, "data.movements" + side))])

    nodes = [
        K.code(Gd, "Guard: job_id (digits), session tenant", src("code/prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_IPreject", "IF the input is invalid: answer, write nothing", V.is_(Gd, "route", "REJECT"), [
            K.code("code_node_IPrej", "Answer (rejected input)", rej_body, RES),
            K.ret("return_node_IPrej", "Return (rejected input)", [(f, N("code_node_IPrej", "data." + f)) for f in RES])]),
        K.sql("sql_node_IPjob", "The job (+ DB clock, lease flag, request; the IA an unlinked SUBMIT left Processing)", PSQL.JOB_SQL, PSQL.JOB_COLS),
        K.code(E, "Entry: a VALIDATING COMPLETE_IA job under a live lease; its correlation -> the Item Assembly; its request (action, prevStatus)",
               shared("ia_common.js") + "\n" + src("code/prepare/entry.js"),
               ["route", "jobId", "tenantId", "organizationId", "iaId", "idempotencyKey", "rowVersion", "attempts", "dbNow", "jsAt", "nonce", "request", "action",
                "prevStatus", "saveAs", "needRead", "unlockRows", "link", "result_code", "result_message"], arrays=("unlockRows",),
               objects=("request", "rowVersion", "attempts", "link")),
        K.if_(ids, "if_IPnoop", "IF the job is not this run's to prepare: answer, write nothing", V.is_(E, "route", "NOOP"), [
            K.code("code_node_IPnoop", "Answer (not prepared)", noop_body, RES),
            K.ret("return_node_IPnoop", "Return (not prepared)", [(f, N("code_node_IPnoop", "data." + f)) for f in RES])]),
        V.gate(ids, "cor_IPread", "Reads to run (the entry goes on)?", E, "needRead", [
            K.parallel("condition_all_IPread", "Set-based reads in parallel (no row limits)", branches)]),
        K.code(P, "Plan: the locked Item Assembly -> the classic IA_SAVE v11 issue / receipt code (lifted) -> the manifest, its parts, the two engine requests",
               plan_code, PLAN_FIELDS, arrays=("partRows", "movementsI", "movementsR"), objects=("lineCount", "pickCount", "movementCount", "unlockOk", "labels")),
        K.if_(ids, "if_IPengine", "IF planned: INVENTORY_BULK_APPLY in PLAN mode for both operations (no lock, writes nothing)", V.is_(P, "route", "PLAN"), [
            K.parallel("condition_all_IPplan", "The two PLAN calls in parallel", [
                ("cai_IPplanI", "Op 1: the component issue", [engine("I", "I", "INVENTORY_BULK_APPLY PLAN of op 1 (IAC|<job>|I): every pick checked and priced as one operation")]),
                ("cai_IPplanR", "Op 2: the receipt", [engine("R", "R", "INVENTORY_BULK_APPLY PLAN of op 2 (IAC|<job>|R): the receipt with unit_price 0 and no batch")])])]),
        K.code(RD, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ the IA back to Draft: nothing was moved) / REQUIRES_REVIEW",
               "\n".join([shared("ia_common.js"), shared("movekey.js"), src("code/prepare/ready.js")]), ready_fields, arrays=("readyRows", "jobRows", "linkRows", "unlockRows")),
        V.gate(ids, "cor_IPparts", "Manifest parts to write?", RD, "needParts", [
            K.add(ids, "add_node_IPparts", "Manifest parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", V.STEP,
                  [(p, N(P, "data.partRows." + p)) for p in V.PART_COLS], labels={"organization_id": "Organization"})]),
        V.gate(ids, "cor_IPready", "Job READY_TO_COMMIT to write?", RD, "needReady", [
            K.update(ids, "update_node_IPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", V.JOB, ("id", "in", N(RD, "data.readyRows.id")),
                     [(p, N(RD, "data.readyRows." + p)) for p in READY_PROPS])]),
        V.gate(ids, "cor_IPunlock", "Item Assembly to release?", RD, "needUnlock", [
            unlock(ids, "update_node_IPunlock", "Item Assembly back to Draft (nothing was moved)", RD)]),
        V.gate(ids, "cor_IPfail", "Job FAILED / REQUIRES_REVIEW to write?", RD, "needJobUpd", [
            V.job_update(ids, "update_node_IPfail", "Job FAILED / REQUIRES_REVIEW with the reason (lease released)", RD, "jobRows")]),
        V.gate(ids, "cor_IPlink", "Job FAILED + the link to write (an Add that stopped before link)?", RD, "needLink", [
            V.job_update(ids, "update_node_IPlink", "Job FAILED + correlation IA|<id>, causation, request iaId / iaNo (STATUS then answers the IA)", RD, "linkRows",
                         V.JOB_PROPS + ["correlation_id", "causation_id", "request_payload"])]),
        K.sql("sql_node_IPback", "Read-back: the job after the write (the truth)", PSQL.BACK_SQL, PSQL.BACK_COLS),
        K.code("code_node_IPresult", "Result", src("code/prepare/result.js"), RES),
        K.ret("return_node_IPdone", "Return", [(f, N("code_node_IPresult", "data." + f)) for f in RES]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a VALIDATING COMPLETE_IA job the worker holds")], RES, nodes)


BUILDERS = [(NAME, build_prepare)]

if __name__ == "__main__":
    V.build(BUILDERS, os.path.join(HERE, "..", "..", "Item Assembly & BOM", "AsyncV2"), "--write" in sys.argv)
