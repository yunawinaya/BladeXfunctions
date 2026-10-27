"""Package F - Revert V2 for Item Assembly (CONTRACT.md part "Revert V2", RV1-RV10) and the guarded classic IA_REVERT v5 (RV9).

  IA_REVERT_V2_PREPARE  the job's IA (owned, IM1 unchanged) -> IA_REVERT v4's code_node_iaRvParams / _iaRvPrep / _iaRvBuild,
                        lifted verbatim (revert/lift), on uncapped SQL reads -> conflicts FAILED (+ Completed again) or the
                        manifest + parts ENGINE / COST / BATCH / HDR / LABELS -> INVENTORY_BULK_APPLY PLAN -> READY_TO_COMMIT
  IA_REVERT_V2_COMMIT   V0 revalidate, V1 the ONE engine operation IAV|<job> (SPLIT / PARK), V2 the assembled item's FIFO / WA
                        rows under COST|<item>|<plant> held as IAV|<job>|C (grrv R2's lock code; only after V1 is DONE), V3 the
                        Batch rows, V4 the header Draft (number kept), COMPLETED
  IA_REVERT_V2_WORKER   lib/v2build.build_worker on REVERT_IA (JS: tpl/sav2/code/worker made the revert's, code/revert/worker)
  IA_REVERT_V2_SUBMIT   the list's Revert: STATUS / BUSY / STALE / the lifted prep's refusals / min_picks / eligibility, then
                        LOCK|n+1 -> job -> header Processing -> read back -> due
  IA_REVERT             base/IA_REVERT.v4.json + the 250-live-row guard (revert/classic_v5.py) + RES-01 R5 (revert/classic_v6.py) + the output
                        split's WA batch match (revert/classic_v7.py)

usage: python3 scratchpad/iav2/build_revert.py [--write] [NAME ...]   (or scratchpad/iav2/build_ia.py, which imports BUILDERS)
Shell ids come from ids.json ("0" until the user creates the shells). Writes <repo>/Item Assembly & BOM/AsyncV2/<NAME>.json.
"""
import hashlib
import importlib.util
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


RSQL = _load(os.path.join(HERE, "revert", "sql.py"), "iarv_revert_sql")
CLASSIC = _load(os.path.join(HERE, "revert", "classic_v7.py"), "iarv_classic_v7")
# RES-01 R5 (scratchpad/iasc/res01): its holds read (RES_OWN_HOLD) and the shared core resRevertAdds
IASC_SQL = _load(os.path.join(HERE, "..", "iasc", "code", "shared", "sql.py"), "iasc_sql_for_revert")
RES_CODE = os.environ.get("HD_CODE") or os.path.join(HERE, "..", "iasc", "res01", "code")
SH = RSQL.SH
IDS = json.load(open(os.path.join(HERE, "ids.json")))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "Item Assembly & BOM", "AsyncV2")
N, gate, call, job_update, step_add, is_, sub = V.N, V.gate, V.call, V.job_update, V.step_add, V.is_, V.sub
ENGINE = ("INVENTORY_BULK_APPLY", IDS["INVENTORY_BULK_APPLY"])
TOKENS = ("INVENTORY_LOCK_TOKENS", IDS["INVENTORY_LOCK_TOKENS"])
IA_TABLE, BATCH_TABLE, FIFO_TABLE, WA_TABLE, LOCK_TABLE = RSQL.IA_TABLE, RSQL.BATCH_TABLE, RSQL.FIFO_TABLE, RSQL.WA_TABLE, RSQL.LOCK_TABLE
IA_LABELS = {"item_assembly_status": "Item Assembly Status"}
STATUS_UNLOCK = V.status_unlock(IA_TABLE, "item_assembly_status", IA_LABELS)
LIFT = ["revert/lift/runtime.js", "revert/lift/lifted_revert.js"]


def src(path):
    return V.raw(HERE, path)


def shared(name):
    return V.include_js(HERE, "code/shared/" + name)


def no_tokens(body, name):
    left = re.findall(r"__[A-Z]+__", body)
    assert not left, (name, left)
    return body


def code(nid, title, body, names, arrays=(), objects=()):
    """K.code, with a closing `return res;` spelled out as exactly the declared keys (the platform keeps only those; the linter then
    reads this return, not a helper's object literal, as the node's output - tpl/sav2 build_commit.py's code())"""
    body = body.rstrip()
    if body.endswith("\nreturn res;"):
        body = body[: -len("return res;")] + "return { " + ", ".join("%s: res.%s" % (n, n) for n in names) + " };"
    return K.code(nid, title, body, names, arrays=arrays, objects=objects)


def ret(nid, title, src_node, fields):
    return K.ret(nid, title, [(f, N(src_node, "data." + f)) for f in fields])


def lifted(*files):
    """a node body built on the lifted classic: runtime + lifted bodies + the shared helpers + the given files (no platform token in
    the lifted part, as build_grrv.body asserts)"""
    lift = [src(f) for f in LIFT]
    assert all("{{" not in x for x in lift), "a lifted body still holds a platform token"
    return "\n".join(lift + [shared("ia_common.js"), shared("fingerprint.js"), shared("movekey.js")] + [src(f) for f in files])


# =============================================================================================== IA_REVERT_V2_SUBMIT
SUB_RES = ["route", "code", "message", "reason", "action", "job_id", "job_status", "terminal", "ia_id", "ia_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "evidence"]
SG, SE, SGT, SP, SR = "code_node_IVSguard", "code_node_IVSentry", "code_node_IVSgate", "code_node_IVSpost", "code_node_IVSiarow"


def scode(name):
    return "\n".join([shared("ia_common.js"), src("code/revert/submit/_common.js"), src("code/revert/submit/" + name)])


def build_submit():
    K._rng.seed(20261023)
    ids = K.Ids(1798810000000)
    T, IA, KEY, ORG = N(SG, "data.tenantId"), N(SG, "data.iaId"), N(SG, "data.key"), N(SG, "data.formOrg")

    def sres(tag, src_node, title, back=False):
        call_ = "submitResult([%s][0], %s, [%s][0], %s)" % (N(SG, "data"), "null" if src_node == SG else "[%s][0]" % N(SE, "data"), N(src_node, "data"),
                                                          "{ owner: [%s][0], job: [%s][0] }" % (N("sql_node_IVSbackia", "data"), N("sql_node_IVSbackjob", "data")) if back else "null")
        body = scode("result.js") + "\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, job: res.job_id }));\nreturn res;" % call_
        return [code("code_node_IVS%sres" % tag, "Result (%s)" % title, body, SUB_RES), ret("return_node_IVS%s" % tag, "Return (%s)" % title, "code_node_IVS%sres" % tag, SUB_RES)]

    facts = SH.facts(sub, T, IA, KEY, ORG)
    reads = [("cai_IVShdr", "Header", [K.sql("sql_node_IVShdr", "The stored Item Assembly header (FP_HEADER: what code_node_iaRvPrep reads)", sub(SH.FP_HEADER, T=T, IA=IA), ["j"])]),
             ("cai_IVSmoves", "Movements", [K.sql("sql_node_IVSmoves", "Its stock movement rows (RV_MOVES = sql_node_iaRvMovs, tenant-scoped)", sub(SH.RV_MOVES, T=T, IA=IA), SH.RV_MOVES_COLS)]),
             ("cai_IVSbatch", "Batches", [K.sql("sql_node_IVSbatch", "Its Batch rows (search_node_iaRvBatch: transaction_no + organization)", sub(RSQL.BATCH_ROWS, T=T, IA=IA), ["j"])]),
             ("cai_IVSserial", "Serial items", [K.sql("sql_node_IVSserial", "The serial-numbered items among its movement rows' items (eligibility)", sub(RSQL.SERIAL, T=T, IA=IA), ["id"])])]
    entry_fields = ["route", "code", "message", "reason", "errorCode", "action", "tenantId", "iaId", "iaNo", "storedStatus", "organizationId", "plantId", "dbNow", "lockN", "jobId",
                    "jobStatus", "jobAction", "progressPercent", "progressMessage", "jobErrorCode", "errorMessage", "lineCount"]
    gate_fields = ["route", "code", "message", "reason", "errorCode", "liveRows", "liveOut", "liveIn", "movesFingerprint", "prevStatus"]
    nodes = [
        code(SG, "Guard: operation, ia_id, idempotency key, source, min_picks, the list row, session tenant + user", scode("guard.js"),
             ["route", "code", "message", "operation", "iaId", "key", "tenantId", "uid", "source", "minPicks", "formStatus", "formOrg", "nonce", "errorCode"], objects=("minPicks",)),
        K.if_(ids, "if_IVSreject", "IF the input is invalid: answer, write nothing", is_(SG, "route", "REJECT"), sres("rej", SG, "rejected input")),
        K.sql("sql_node_IVSfacts", "Facts: the job of this key, the stored IA, its latest lock, open / latest / linked jobs of either command, DB clock (code/shared FACTS)",
              facts, SH.FACTS_COLS),
        code(SE, "Entry: STATUS / this key's job; SUBMIT goes on for an IA with no open job, not Processing, at the list row's status (BUSY / STALE / STOP otherwise)",
             scode("entry.js"), entry_fields, objects=("lockN", "progressPercent", "lineCount")),
        K.if_(ids, "if_IVSanswer", "IF answered here (STATUS / BUSY / STALE / STOP): answer, write nothing", "'%s' != 'GO'" % N(SE, "data.route"), sres("ans", SE, "entry")),
        K.parallel("condition_all_IVSread", "The gate's reads in parallel (no row limits)", reads),
        code(SGT, "Gate: code_node_iaRvParams + code_node_iaRvPrep (lifted) - the classic's refusals, min_picks, what the background revert does not take (-> classic / STOP)",
             _gate_body(), gate_fields, objects=("liveRows", "liveOut", "liveIn")),
        K.if_(ids, "if_IVSgateEnd", "IF the gate answered (NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(SGT, "data.route"), sres("gate", SGT, "gate")),
        code(SP, "Post: the queue rows (the IA's lock LOCK|n+1, the REVERT_IA job QUEUED 2 minutes ahead)", scode("post.js"), ["route", "code", "message", "errorCode", "lockRows", "jobRows"],
             arrays=("lockRows", "jobRows")),
        K.if_(ids, "if_IVSpostEnd", "IF nothing to queue: answer, write nothing", "'%s' != 'QUEUE'" % N(SP, "data.route"), sres("post", SP, "post")),
        step_add(ids, "add_node_IVSlock", "LOCK: gd_publish_step IAC|<ia> / LOCK|<n+1> (unique tenant / job / step: a concurrent submit fails its run)", SP, "lockRows"),
        K.add(ids, "add_node_IVSjob", "Job insert: REVERT_IA QUEUED, due in 2 minutes (unique idempotency key: a twin click fails its run)", V.JOB,
              [(p, N(SP, "data.jobRows." + p)) for p in V.JOB_ADD_COLS], labels={"organization_id": "Organization"}),
        code(SR, "Item Assembly row: Processing under the new job", scode("iarow.js"), ["ok", "jobId", "iaRows"], arrays=("iaRows",)),
        gate(ids, "cor_IVSia", "Item Assembly to lock?", SR, "ok", [
            K.update(ids, "update_node_IVSia", "Item Assembly Processing + ia_v2_job_id (the lock every writer honours)", IA_TABLE, ("id", "in", N(SR, "data.iaRows.id")),
                     [(p, N(SR, "data.iaRows." + p)) for p in ["id", "item_assembly_status", "ia_v2_job_id"]], labels=IA_LABELS)]),
        K.parallel("condition_all_IVSback", "Read-back in parallel: the IA's status / job link / latest lock, the job of this key", [
            ("cai_IVSbackia", "Item Assembly", [K.sql("sql_node_IVSbackia", "Read-back: the IA's status, its V2 job and its latest IAC| lock (code/shared OWNER)", sub(SH.OWNER, T=T, IA=IA),
                                                     ["db_now", "ia_id", "item_assembly_status", "ia_v2_job_id", "stock_movement_no", "lock_ref", "lock_step"])]),
            ("cai_IVSbackjob", "Job", [K.sql("sql_node_IVSbackjob", "Read-back: the job of this key", sub(RSQL.KEY_JOB, T=T, KEY=KEY), RSQL.KEY_JOB_COLS)])]),
        code("code_node_IVSdue", "Due: the IA is Processing under this job's lock -> the job due now", scode("due.js"), ["dueRows", "needDue"], arrays=("dueRows",)),
        gate(ids, "cor_IVSdue", "Job to make due?", "code_node_IVSdue", "needDue", [
            K.update(ids, "update_node_IVSdue", "Job due now (it was inserted 2 minutes ahead)", V.JOB, ("id", "in", N("code_node_IVSdue", "data.dueRows.id")),
                     [("id", N("code_node_IVSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_IVSdue", "data.dueRows.next_attempt_at"))])]),
    ] + sres("done", SP, "queued", back=True)
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"), ("ia_id", "string", "sm_item_assembly.id (digits)"),
                       ("idempotency_key", "string", "IAV:<org>:<ia>:<click token> (8-128 chars A-Z a-z 0-9 | : _ . -)"), ("source", "string", "LIST (default)"),
                       ("min_picks", "string", "digits: live rows at or below it -> NOT_ELIGIBLE classic (the list sends 50; absent / 0 = no effect)"),
                       ("form", "any", "the list row { id, item_assembly_status, stock_movement_no, organization_id }; {} for STATUS")], SUB_RES, nodes)


def _gate_body():
    """the gate on the lifted classic + the adapter + the submit helpers (s, list, digits, answer)"""
    return lifted("code/revert/prepare/adapter.js", "code/revert/submit/_common.js", "code/revert/submit/gate.js", "code/revert/submit/gate_tail.js")


# =============================================================================================== IA_REVERT_V2_PREPARE
PG, PE, PP, PL, PRD = "code_node_IVPguard", "code_node_IVPentry", "code_node_IVPprep", "code_node_IVPplan", "code_node_IVPready"
P_RES = ["job_id", "job_status", "result_code", "result_message", "evidence"]


def build_prepare():
    K._rng.seed(20261024)
    ids = K.Ids(1798820000000)
    T, IA = N(PG, "data.tenantId"), N(PE, "data.iaId")
    rej_body = ("return { job_id: \"\", job_status: \"\", result_code: [%s][0], result_message: [%s][0], "
                "evidence: JSON.stringify({ v: 1, workflow: \"IA_REVERT_V2_PREPARE\", path: \"REJECTED_INPUT\" }) };") % (N(PG, "data.result_code"), N(PG, "data.result_message"))
    noop_body = ("const e = [%s][0] || {};\nreturn { job_id: e.jobId || \"\", job_status: \"\", result_code: e.result_code || \"\", result_message: e.result_message || \"\", "
                 "evidence: JSON.stringify({ v: 1, workflow: \"IA_REVERT_V2_PREPARE\", path: \"NOOP\" }) };") % N(PE, "data")
    C = RSQL.classic_sql()
    PR = lambda f: N(PP, "data." + f)
    r2 = dict(T=T, ORG=PR("orgSql"), PLANT=PR("plantIdSql"))
    round1 = [
        ("cai_IVPown", "Lock", [K.sql("sql_node_IVPown", "The IA's status, its V2 job and its latest IAC| lock (code/shared OWNER)", sub(SH.OWNER, T=T, IA=IA),
                                      ["db_now", "ia_id", "item_assembly_status", "ia_v2_job_id", "stock_movement_no", "lock_ref", "lock_step"])]),
        ("cai_IVPhdr", "Header", [K.sql("sql_node_IVPhdr", "The IA header (FP_HEADER: what code_node_iaRvPrep reads)", sub(SH.FP_HEADER, T=T, IA=IA), ["j"])]),
        ("cai_IVPmoves", "Movements", [K.sql("sql_node_IVPmoves", "Its stock movement rows (RV_MOVES = sql_node_iaRvMovs, tenant-scoped)", sub(SH.RV_MOVES, T=T, IA=IA), SH.RV_MOVES_COLS)]),
        ("cai_IVPbatch", "Batches", [K.sql("sql_node_IVPbatch", "Its Batch rows (search_node_iaRvBatch: transaction_no + organization)", sub(RSQL.BATCH_ROWS, T=T, IA=IA), ["j"])]),
        ("cai_IVPres", "Holds", [K.sql("sql_node_IVPres", "RES-01: its hold status, open and Delivered holds, running hold tickets (RES_REVERT_OWN_HOLD)",
                                       sub(IASC_SQL.RES_REVERT_OWN_HOLD, T=T, IA=IA, IAQ=IA, ORG=N(PE, "data.organizationId")), ["j"])]),
    ]
    round2 = [
        ("cai_IVPfifo", "FIFO", [K.sql("sql_node_IVPfifo", "FIFO layers of the assembled item (sql_node_iaRvFifo + tenant)",
                                       sub(C["FIFO"][0], IASQL=PR("iaIdSql"), ASSEMBLED=PR("assembledIdsCsv"), **r2), C["FIFO"][1])]),
        ("cai_IVPwa", "WA", [K.sql("sql_node_IVPwa", "Weighted-average rows (sql_node_iaRvWa + tenant)", sub(C["WA"][0], IASQL=PR("iaIdSql"), ASSEMBLED=PR("assembledIdsCsv"), **r2),
                                   C["WA"][1])]),
        ("cai_IVPcostcounts", "Cost counts", [K.sql("sql_node_IVPcostcounts", "Costing row counts per item (sql_node_iaRvCostCounts + tenant)",
                                                    sub(C["COSTCOUNTS"][0], ITEMS=PR("itemIdsCsv"), **r2), C["COSTCOUNTS"][1])]),
        ("cai_IVPitembal", "Item balances", [K.sql("sql_node_IVPitembal", "Item balances of the assembled item (search_node_iaRvItemBal, uncapped)",
                                                   sub(RSQL.ITEM_BAL, ASSEMBLED=PR("assembledIdsCsv"), **r2), ["j"])]),
        ("cai_IVPbatchbal", "Batch balances", [K.sql("sql_node_IVPbatchbal", "Batch balances of its batches (search_node_iaRvBatchBal, uncapped)",
                                                     sub(RSQL.BATCH_BAL, BATCHES=PR("batchIdsCsv"), **r2), ["j"])]),
        ("cai_IVPitems", "Items", [K.sql("sql_node_IVPitems", "The live rows' items (code/shared ITEMS: what code_node_iaRvBuild reads, uncapped)", sub(SH.ITEMS, T=T, ITEMS=PR("itemIdsCsv")),
                                         ["j"])]),
        ("cai_IVPbins", "Bins", [K.sql("sql_node_IVPbins", "The live rows' bins (LABELS)", sub(RSQL.BINS, T=T, BINS=PR("binIdsCsv")), ["j"])]),
    ]
    prep_fields = ["route", "code", "message", "unlockOk", "details", "iaNo", "liveRows", "liveOut", "liveIn", "movesFingerprint", "iaIdSql", "orgSql", "plantIdSql", "assembledIdsCsv",
                   "itemIdsCsv", "batchIdsCsv", "binIdsCsv"]
    plan_fields = ["route", "code", "message", "payload", "partRows", "lineCount", "movementCount", "unlockOk", "details", "needPlan", "operationKey", "organizationId", "movements",
                   "labels", "keys"]
    ready_fields = ["route", "needParts", "needReady", "readyRows", "needJobUpd", "jobRows", "needUnlock", "unlockRows", "result_code", "result_message", "job_status"]
    ready_props = ["id", "job_status", "progress_percent", "progress_message", "row_version", "error_code", "error_message", "error_details", "prepared_payload", "line_count"]
    pick = lambda node, keys: "{ " + ", ".join("%s: [%s][0]" % (k, N(node, "data." + k)) for k in keys) + " }"

    def ready_tail(tag, plan_js, engine_js):
        rd, back = PRD + tag, "sql_node_IVPback" + tag
        body = "\n".join([shared("ia_common.js"), shared("movekey.js"), src("code/revert/prepare/ready.js")]).replace("__PLAN__", plan_js).replace("__ENGINE__", engine_js)
        rbody = src("code/revert/prepare/result.js").replace("__READY__", N(rd, "data")).replace("__BACK__", back)
        parts = [] if tag == "P" else [
            gate(ids, "cor_IVPparts", "Payload parts to write?", rd, "needParts", [
                K.add(ids, "add_node_IVPparts", "Payload parts: gd_publish_step P|<run nonce>|<PART>|<nnn>", V.STEP, [(p, N(PL, "data.partRows." + p)) for p in V.PART_COLS],
                      labels={"organization_id": "Organization"})]),
            gate(ids, "cor_IVPready", "Job READY_TO_COMMIT to write?", rd, "needReady", [
                K.update(ids, "update_node_IVPready", "Job READY_TO_COMMIT + manifest (the worker's lease is kept)", V.JOB, ("id", "in", N(rd, "data.readyRows.id")),
                         [(p, N(rd, "data.readyRows." + p)) for p in ready_props])])]
        return [code(rd, "Ready: READY_TO_COMMIT (+ manifest, parts) or FAILED (+ the IA back to Completed when this job holds its lock) / REQUIRES_REVIEW", no_tokens(body, rd),
                     ready_fields, arrays=("readyRows", "jobRows", "unlockRows"))] + parts + [
            gate(ids, "cor_IVPunlock" + tag, "Item Assembly to put back?", rd, "needUnlock", [
                STATUS_UNLOCK(ids, "update_node_IVPunlock" + tag, "Item Assembly back to its status before the revert (Completed; nothing was written)", rd)]),
            gate(ids, "cor_IVPfail" + tag, "Job FAILED / REQUIRES_REVIEW to write?", rd, "needJobUpd", [
                job_update(ids, "update_node_IVPfail" + tag, "Job FAILED / REQUIRES_REVIEW with the reason (lease released)", rd, "jobRows")]),
            K.sql(back, "Read-back: the job after the write (the truth)", sub(RSQL.P_BACK, T=T, JOB=N(PG, "data.jobId")), RSQL.P_BACK_COLS),
            code("code_node_IVPresult" + tag, "Result", no_tokens(rbody, "result"), P_RES),
            ret("return_node_IVPdone" + tag, "Return", "code_node_IVPresult" + tag, P_RES),
        ]

    plan_pick = pick(PL, ["route", "code", "message", "payload", "lineCount", "movementCount", "unlockOk", "details", "needPlan", "labels", "keys"])
    engine_pick = pick("workflow_node_IVPengine", ["code", "result_code", "message", "msg", "results"])
    nodes = [
        code(PG, "Guard: job_id (digits), session tenant", src("code/revert/prepare/guard.js"), ["route", "jobId", "tenantId", "result_code", "result_message"]),
        K.if_(ids, "if_IVPreject", "IF the input is invalid: answer, write nothing", is_(PG, "route", "REJECT"), [
            K.code("code_node_IVPrej", "Answer (rejected input)", rej_body, P_RES), ret("return_node_IVPrej", "Return (rejected input)", "code_node_IVPrej", P_RES)]),
        K.sql("sql_node_IVPjob", "The job (+ DB clock, lease flag, request)", sub(RSQL.P_JOB, T=T, JOB=N(PG, "data.jobId")), RSQL.P_JOB_COLS),
        code(PE, "Entry: a VALIDATING REVERT_IA job under a live lease; its correlation -> the Item Assembly; its request (IM1, prevStatus Completed)",
             "\n".join([shared("ia_common.js"), src("code/revert/prepare/entry.js")]),
             ["route", "jobId", "tenantId", "organizationId", "iaId", "idempotencyKey", "rowVersion", "dbNow", "jsAt", "nonce", "request", "prevStatus", "result_code", "result_message"],
             objects=("request", "rowVersion")),
        K.if_(ids, "if_IVPnoop", "IF the job is not this run's to prepare: answer, write nothing", is_(PE, "route", "NOOP"), [
            K.code("code_node_IVPnoop", "Answer (not prepared)", noop_body, P_RES), ret("return_node_IVPnoop", "Return (not prepared)", "code_node_IVPnoop", P_RES)]),
        K.parallel("condition_all_IVPread1", "Round 1 reads in parallel (no row limits): the lock, the header, the movement rows, the Batch rows", round1),
        code(PP, "Prep: the lock -> IM1 -> code_node_iaRvParams + code_node_iaRvPrep (lifted, status = prevStatus): refusals, eligibility, the ids round 2 reads (digits only)",
             lifted("code/revert/prepare/adapter.js", "code/revert/prepare/prep.js", "code/revert/prepare/prep_tail.js"), prep_fields,
             objects=("unlockOk", "liveRows", "liveOut", "liveIn")),
        K.if_(ids, "if_IVPprepEnd", "IF the Item Assembly is refused / not V2's / not locked under this job: FAILED, read nothing more", "'%s' == 'FAIL'" % N(PP, "data.route"),
              ready_tail("P", "[%s][0]" % N(PP, "data"), "{}")),
        K.parallel("condition_all_IVPread2", "Round 2 reads in parallel (no row limits): costing rows, balances, items, bins", round2),
        code(PL, "Plan: code_node_iaRvBuild (lifted): conflicts -> FAILED with the classic's list; else the manifest (ENGINE, COST, BATCH, HDR, LABELS) and its parts",
             lifted("code/revert/prepare/adapter.js", "code/revert/prepare/prep.js", "code/revert/prepare/plan.js", "code/revert/prepare/plan_tail.js")
             .replace("// IA_REVERT_V2_PREPARE - Plan:", V.include_js(RES_CODE, "shared/revert.js") + "\n// IA_REVERT_V2_PREPARE - Plan:", 1), plan_fields,
             arrays=("partRows", "movements", "keys"), objects=("lineCount", "movementCount", "unlockOk", "labels")),
        K.if_(ids, "if_IVPengine", "IF planned with movements: INVENTORY_BULK_APPLY in PLAN mode (writes nothing)", is_(PL, "needPlan", "YES"), [
            call(ids, "workflow_node_IVPengine", "INVENTORY_BULK_APPLY PLAN of IAV|<job>: every reverse movement checked as one operation", ENGINE, [
                ("operation_key", N(PL, "data.operationKey")), ("mode", "PLAN", "value"), ("organization_id", N(PL, "data.organizationId")), ("movements", N(PL, "data.movements"))])]),
    ] + ready_tail("", plan_pick, engine_pick)
    return K.workflow([("job_id", "string", "gd_async_job.id (digits) of a VALIDATING REVERT_IA job the worker holds")], P_RES, nodes)


# =============================================================================================== IA_REVERT_V2_COMMIT
CG, CE = "code_node_IVCguard", "code_node_IVCentry"
C_RES = V.RES_FIELDS


def ccode(name, extra=()):
    parts = [shared("ia_common.js")] + [shared(x) for x in extra] + [src("code/revert/commit/_common.js"), src("code/revert/commit/" + name)]
    return "\n".join(parts)


def cres(tag, src_node, path, path_js=None):
    pj = path_js or json.dumps(path)
    body = ccode("result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src_node, "data") if src_node else "null", pj)
    return [code("code_node_IVC%sres" % tag, "Result (%s)" % path, body, C_RES), ret("return_node_IVC%s" % tag, "Return (%s)" % path, "code_node_IVC%sres" % tag, C_RES)]


def end_a(ids, tag, src_node, title):
    """phase A (no stock moved yet): the IA back to Completed, then the job row"""
    nodes = [gate(ids, "cor_IVC%sunlock" % tag, "Item Assembly lock to release?", src_node, "needUnlock", [
                 STATUS_UNLOCK(ids, "update_node_IVC%sunlock" % tag, "Item Assembly back to its status before the revert (Completed; no stock was moved)", src_node)]),
             gate(ids, "cor_IVC%sjob" % tag, "Job row to write?", src_node, "needJobUpd", [
                 job_update(ids, "update_node_IVC%sjob" % tag, "Job: wait / retry with backoff / FAILED / REQUIRES_REVIEW (lease released)", src_node, "jobRows")])]
    return K.if_(ids, "if_IVC%send" % tag, title, is_(src_node, "route", "END"), nodes + cres(tag, src_node, tag.upper() + "_END"))


def end_b(ids, tag, src_node, title):
    """phase B (the stock moved): retry with backoff, wait, or REQUIRES_REVIEW - never back"""
    nodes = [gate(ids, "cor_IVC%sjob" % tag, "Job row to write?", src_node, "needJobUpd", [
        job_update(ids, "update_node_IVC%sjob" % tag, "Job: retry with backoff / wait / REQUIRES_REVIEW (lease released)", src_node, "jobRows")])]
    return K.if_(ids, "if_IVC%send" % tag, title, is_(src_node, "route", "END"), nodes + cres(tag, src_node, tag.upper() + "_END"))


def commit_sql():
    T, JOB, PFX, IA, ORG = N(CG, "data.tenantId"), N(CG, "data.jobId"), N(CE, "data.partPrefix"), N(CE, "data.iaId"), N(CE, "data.organizationId")
    S = {"job": sub(RSQL.C_JOB, T=T, JOB=JOB), "steps": sub(RSQL.C_STEPS, T=T, JOB=JOB), "payload": sub(RSQL.C_PAYLOAD, T=T, JOB=JOB), "ia": sub(RSQL.C_IA, T=T, JOB=JOB),
         "own": sub(RSQL.C_OWN, T=T, JOB=JOB), "intents": sub(RSQL.C_INTENTS, T=T, JOB=JOB), "ops": sub(RSQL.C_OPS, T=T, JOB=JOB), "moves": sub(SH.RV_MOVES, T=T, IA=IA), "ianow": sub(RSQL.C_IA_NOW, T=T, IA=IA)}
    S["part"] = lambda name: sub(RSQL.C_PART, T=T, JOB=JOB, PFX=PFX, NAME=name)
    S["fifo"] = lambda node: sub(RSQL.C_FIFO, T=T, IDS=N(node, "data.fifoIdsSql"))
    S["wa"] = lambda node: sub(RSQL.C_WA, T=T, IDS=N(node, "data.waIdsSql"))
    S["batch"] = lambda node: sub(RSQL.C_BATCH, T=T, IDS=N(node, "data.idsSql"))
    KEYS = N("code_node_IVCv2lkeys", "data.keysJson")
    S["lk1"], S["lk2"], S["lk3"] = (sub(RSQL.LK1, T=T, ORG=ORG, KEYS=KEYS), sub(RSQL.LK2, T=T, ORG=ORG, KEYS=KEYS), sub(RSQL.LK3, T=T, ORG=ORG, KEYS=KEYS))
    S["lkrel"] = sub(RSQL.LK_RELEASE, T=T, ORG=ORG, JOB=JOB)
    return S


def build_commit():
    K._rng.seed(20261021)
    ids = K.Ids(1798830000000)
    lk = K.Ids(1798835000000)
    S = commit_sql()
    sq = lambda nid, title, text, cols=("j",): K.sql(nid, title, text, list(cols))
    part = lambda nid, title, name: K.sql(nid, title, S["part"](name), ["step_name", "result_ref"])
    br = lambda tag, items: K.parallel("condition_all_IVC%s" % tag, "Reads in parallel", [("cai_IVC%s%d" % (tag, i), t, [n]) for i, (t, n) in enumerate(items)])
    slice_js = src("code/revert/commit/slice.js")
    entry_fields = ["route", "phase", "dbNow", "jsAt", "jobId", "tenantId", "organizationId", "iaId", "iaNo", "plantId", "prevStatus", "idempotencyKey", "movesFingerprint", "movementCount",
                    "costCount", "batchCount", "v1FinishedAt", "opWrote", "v2WaitFrom", "progress", "progressMessage", "jobStatus", "rowVersion", "attempts", "leaseUntil", "unlockOk", "partPrefix", "jobRows",
                    "needJobUpd", "unlockRows", "needUnlock", "needV0", "needV1", "needV2", "needV3", "needV4", "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows")
    plan_end = ["jobRows", "needJobUpd", "result_code", "result_message", "job_status"]
    rej_body = ccode("result.js") + "\nconst res = commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");\nreturn res;" % (
        N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    V0, V1I, V1A, V1 = "code_node_IVCv0", "code_node_IVCv1in", "code_node_IVCv1ans", "code_node_IVCv1"
    V2I, V2K, V2LS, V2LC, V2LV, V2P, V2C = ("code_node_IVCv2in", "code_node_IVCv2lkeys", "code_node_IVCv2lseed", "code_node_IVCv2lclaim", "code_node_IVCv2lverify",
                                            "code_node_IVCv2plan", "code_node_IVCv2check")
    V3I, V3P, V3C, V4P, V4C, FIN = "code_node_IVCv3in", "code_node_IVCv3plan", "code_node_IVCv3check", "code_node_IVCv4plan", "code_node_IVCv4check", "code_node_IVCfinish"
    rel_cols = RSQL.LK_RELEASE_COLS

    def release(tag, check=()):
        """the COST locks IAV|<job>|C holds given back as INVENTORY_BULK_APPLY releases: owner cleared, then INVENTORY_LOCK_TOKENS GIVE"""
        rs, rp = "sql_node_IVC%srel" % tag, "code_node_IVC%srel" % tag
        give = [V.slice_loop(lk, "IVC", tag + "rel", rp, "clearSlices", "COST lock release step 1: owner cleared, last owner = IAV|<job>|C", LOCK_TABLE,
                             ["owner_operation_id", "last_owner_operation_id", "last_released_at", "lock_version"], slice_js),
                call(lk, "workflow_node_IVC%sgive" % tag, "COST lock release step 2: INVENTORY_LOCK_TOKENS GIVE", TOKENS, [
                    ("mode", "GIVE", "value"), ("operation_id", N(rp, "data.opKey")), ("organization_id", N(CE, "data.organizationId")), ("claimed_at", "", "value"),
                    ("ids", N(rp, "data.plusIds"))])]
        return [K.sql(rs, "COST locks IAV|<job>|C still holds (or cleared without the GIVE)", S["lkrel"], rel_cols),
                code(rp, "COST lock release plan: owner cleared first, then GIVE adds the token back", ccode("v2_lock_release.js").replace("__REL_SQL__", rs),
                     ["opKey", "clearSlices", "plusIds", "needRelease"], arrays=("clearSlices", "plusIds")),
                K.if_(lk, "if_IVC%sgive" % tag, "IF COST locks to give back", is_(rp, "needRelease", "YES"), give + list(check)) if check else
                gate(lk, "cor_IVC%srel" % tag, "COST locks to give back?", rp, "needRelease", give)]

    def end_rel(n, tag):
        """a V2 exit that gives the COST locks back before the job row"""
        n["blocks"][0]["blocks"][0:0] = release(tag)
        return n

    v2_lock = [
        code(V2K, "V2 COST locks: COST|<material>|<plant> of the assembled item's costing rows, sorted (INVENTORY_BULK_APPLY's keys), owner IAV|<job>|C", ccode("v2_lock_keys.js"),
             ["need", "keys", "keysJson", "opKey"], arrays=("keys",)),
        K.if_(lk, "if_IVCv2lock", "IF V2 writes costing rows: hold their COST locks before reading them (V1 is DONE: the engine gave its own back)", is_(V2K, "need", "YES"), [
            K.sql("sql_node_IVCv2lk1", "Lock seed: the lock rows of the keys", S["lk1"], RSQL.LK1_COLS),
            code(V2LS, "Lock seed: the missing rows (free_token 1)", ccode("v2_lock_seed.js"), ["addSlices", "needSeed"], arrays=("addSlices",)),
            gate(lk, "cor_IVCv2lseed", "Lock rows to seed?", V2LS, "needSeed", [
                V.slice_loop(lk, "IVC", "v2lsd", V2LS, "addSlices", "Lock seed insert (unique tenant / organization / lock_key: a twin insert fails the run)", LOCK_TABLE,
                             ["organization_id", "lock_key", "balance_type", "free_token", "lock_version", "owner_operation_id", "last_owner_operation_id"], slice_js, add=True)]),
            K.sql("sql_node_IVCv2lk2", "Lock claim: the lock rows before the take", S["lk2"], RSQL.LK2_COLS),
            code(V2LC, "Lock claim: BUSY / TAKE / HELD", ccode("v2_lock_claim.js"), ["route", "needTake", "ids", "claimedAt", "busy"], arrays=("ids",)),
            gate(lk, "cor_IVCv2ltake", "Keys to take?", V2LC, "needTake", [
                call(lk, "workflow_node_IVCv2ltake", "Lock take: INVENTORY_LOCK_TOKENS TAKE, in lock order", TOKENS, [
                    ("mode", "TAKE", "value"), ("operation_id", N(V2K, "data.opKey")), ("organization_id", N(CE, "data.organizationId")),
                    ("claimed_at", N(V2LC, "data.claimedAt")), ("ids", N(V2LC, "data.ids"))])]),
            K.sql("sql_node_IVCv2lk3", "Lock verify: the lock rows after the take", S["lk3"], RSQL.LK3_COLS),
            code(V2LV, "Lock verify: every key held by IAV|<job>|C -> on; busy or not taken -> wait 5 s, not counted (REQUIRES_REVIEW 1,800 s after V1)", ccode("v2_lock_verify.js"),
                 chk, arrays=chk_arr),
            K.if_(lk, "if_IVCv2lkend", "IF the COST locks are not held: wait (what this revert holds is given back first)", is_(V2LV, "route", "END"), release("v2lk") + [
                gate(lk, "cor_IVCv2lkjob", "Job row to write?", V2LV, "needJobUpd", [
                    job_update(lk, "update_node_IVCv2lkjob", "Job: wait for the COST locks, due in 5 s (lease released) / REQUIRES_REVIEW", V2LV, "jobRows")])]
                  + cres("v2lk", V2LV, "V2_LOCK_WAIT")),
        ]),
    ]
    # after V2 (this run, or a run that died between V2 DONE and the release): nothing of IAV|<job>|C may stay held
    v2_free = release("v2fin", [
        K.sql("sql_node_IVCv2finback", "Read-back: COST locks of IAV|<job>|C still at token 0", S["lkrel"], rel_cols),
        code("code_node_IVCv2finchk", "Release check: none left -> on; else retry with backoff", ccode("v2_lock_released.js"), chk, arrays=chk_arr),
        end_b(lk, "v2fin", "code_node_IVCv2finchk", "IF a COST lock was not given back: retry")])
    nodes = [
        code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_IVCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            code("code_node_IVCrejres", "Result (REJECTED_INPUT)", rej_body, C_RES), ret("return_node_IVCrej", "Return (rejected input)", "code_node_IVCrejres", C_RES)]),
        K.parallel("condition_all_IVCfacts", "Facts in parallel: the job (+ prevStatus), its V step rows, its manifest, the Item Assembly's status and lock, the engine operation's rows", [
            ("cai_IVCjob", "Job", [K.sql("sql_node_IVCjob", "The job (+ DB clock, lease flag, lease_until, due, prevStatus)", S["job"], RSQL.C_JOB_COLS)]),
            ("cai_IVCsteps", "Steps", [K.sql("sql_node_IVCsteps", "This job's V step rows (+ when each finished)", S["steps"], RSQL.C_STEPS_COLS)]),
            ("cai_IVCpayload", "Manifest", [K.sql("sql_node_IVCpayload", "The prepared manifest", S["payload"], ["prepared_payload"])]),
            ("cai_IVCia", "Item Assembly + lock", [K.sql("sql_node_IVCia", "The Item Assembly's status, its V2 job and its latest IAC| LOCK row", S["ia"], RSQL.C_IA_COLS)]),
            ("cai_IVCops", "Engine operation", [K.sql("sql_node_IVCops", "The engine operation IAV|<job>: its intent / DONE rows (any -> a phase-A failure is a review)", S["ops"],
                                                      ["op_rows"])]),
        ]),
        code(CE, "Entry: what this run does (phase A: V0 V1, SPLIT / PARK; phase B: V2 V3 V4, COMPLETED), the lease claim", ccode("entry.js"), entry_fields,
             arrays=("jobRows", "unlockRows"), objects=("rowVersion", "attempts", "movementCount", "costCount", "batchCount", "progress")),
        K.if_(ids, "if_IVCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_IVCentryend", "IF the manifest is unusable or the Item Assembly lost its lock: FAILED (+ Completed again) or REQUIRES_REVIEW",
              "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
                  gate(ids, "cor_IVCefunlock", "Item Assembly lock to release?", CE, "needUnlock", [
                      STATUS_UNLOCK(ids, "update_node_IVCefunlock", "Item Assembly back to its status before the revert (Completed)", CE)]),
                  gate(ids, "cor_IVCefjob", "Job row to write?", CE, "needJobUpd", [job_update(ids, "update_node_IVCefjob", "Job: FAILED / REQUIRES_REVIEW (lease released)", CE, "jobRows")]),
              ] + cres("ef", CE, "ENTRY_END")),
        job_update(ids, "update_node_IVCclaim", "Lease claim: job COMMITTING_REVERT, lease_owner = this run, lease_expires_at = now + 10 min", CE, "jobRows"),
        K.sql("sql_node_IVCown", "Read-back: the job after the lease claim", S["own"], ["id", "job_status", "lease_owner", "row_version"]),
        code("code_node_IVCown", "Own: COMMITTING_REVERT under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_IVClost", "IF another run took the job: stop", is_("code_node_IVCown", "route", "LOST"), cres("lost", "code_node_IVCown", "LOST")),
        # ---------------------------------------------------------------- V0
        K.if_(ids, "if_IVCv0", "IF V0 REVALIDATE is due", is_(CE, "needV0", "YES"), [
            sq("sql_node_IVCv0moves", "V0: the IA's movement rows now (RV_MOVES: what IM1 fingerprints)", S["moves"], SH.RV_MOVES_COLS),
            code(V0, "V0 REVALIDATE: Processing under this job (entry) and the movement rows PREPARE planned from (IM1) -> DONE; else FAILED + Completed again", ccode("v0.js", ("fingerprint.js",)),
                 chk, arrays=chk_arr),
            end_a(ids, "v0", V0, "IF the Item Assembly changed meanwhile (FAILED)"),
            V.step_done(ids, "IVC", "v0", V0, "V0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- V1
        K.if_(ids, "if_IVCv1", "IF V1 INVENTORY is due (phase A ends here: SPLIT / PARK)", is_(CE, "needV1", "YES"), [
            part("sql_node_IVCv1part", "V1: the ENGINE part", "ENGINE"),
            code(V1I, "V1: the operation key IAV|<job> and the reverse movements (none -> no call)", ccode("v1_in.js"), ["ok", "needCall", "operationKey", "movements", "keys", "count", "why"],
                 arrays=("movements", "keys"), objects=("count",)),
            gate(ids, "cor_IVCv1call", "Stock to take back?", V1I, "needCall", [
                call(ids, "workflow_node_IVCv1", "INVENTORY_BULK_APPLY APPLY (all-or-nothing; IAV|<job> replays on a re-run)", ENGINE, [
                    ("operation_key", N(V1I, "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")), ("movements", N(V1I, "data.movements"))])]),
            code(V1A, "V1: the engine's answer (409 / none: read its intent rows; 400: read the LABELS part)", ccode("v1_ans.js"), ["code", "result_code", "message", "need409", "need400"]),
            gate(ids, "cor_IVCv1ops", "409 / no answer: the engine's intent rows to count?", V1A, "need409", [
                sq("sql_node_IVCv1ops", "V1: the intent rows of IAV|<job> (any = the engine may have written)", S["intents"], ["intents"])]),
            gate(ids, "cor_IVCv1lab", "400: the LABELS part to read?", V1A, "need400", [part("sql_node_IVCv1labels", "V1: the LABELS part (movement_key -> item, bin)", "LABELS")]),
            code(V1, "V1 check: 200 / no movement -> DONE + SPLIT or PARK; 409 -> wait, then FAILED + Completed (review with intents); 400 -> FAILED + Completed (mapped); else review",
                 ccode("v1.js", ("movekey.js",)), chk + ["splitRows", "needSplit", "path"], arrays=chk_arr + ("splitRows",)),
            end_a(ids, "v1", V1, "IF the stock was not taken back"),
            V.step_done(ids, "IVC", "v1", V1, "V1_INVENTORY"),
            gate(ids, "cor_IVCsplit", "SPLIT / PARK hand-over to write?", V1, "needSplit", [
                job_update(ids, "update_node_IVCsplit", "Job: SPLIT| hand-over lease (the worker calls phase B now) or PARK (due now, no lease: the next tick); attempt_count 0", V1, "splitRows")]),
        ] + cres("split", V1, "SPLIT", "[%s][0] || \"SPLIT\"" % N(V1, "data.path"))),
        # ---------------------------------------------------------------- V2
        K.if_(ids, "if_IVCv2", "IF V2 COST is due (the assembled item's FIFO / weighted-average rows)", is_(CE, "needV2", "YES"), [
            part("sql_node_IVCv2part", "V2: the COST part", "COST"),
            code(V2I, "V2 input: the costing rows to read fresh, their materials (digits only)", ccode("v2_in.js"), ["ok", "why", "fifoIdsSql", "waIdsSql", "fifo", "waDelete", "waRestate",
                                                                                                                  "materials"], arrays=("fifo", "waDelete", "waRestate", "materials")),
        ] + v2_lock + [
            br("v2fresh", [("FIFO", sq("sql_node_IVCv2fifo", "V2: the FIFO layers now", S["fifo"](V2I))), ("WA", sq("sql_node_IVCv2wa", "V2: the weighted-average rows now", S["wa"](V2I)))]),
            code(V2P, "V2 plan: at after -> done; at before -> the classic's write (FIFO / WA batch rows removed, the weighted average restated); else review", ccode("v2_plan.js"),
                 ["route", "fifoSlices", "fifoCount", "waDelSlices", "waDelCount", "waSetSlices", "waSetCount"] + plan_end,
                 arrays=("fifoSlices", "waDelSlices", "waSetSlices", "jobRows"), objects=("fifoCount", "waDelCount", "waSetCount")),
            end_rel(end_b(ids, "v2pl", V2P, "IF the costing cannot be restored"), "v2pl"),
            V.slice_loop(ids, "IVC", "v2f", V2P, "fifoSlices", "V2 WRITE: FIFO layers removed (update_node_iaRvFifoDel's write)", FIFO_TABLE, ["is_deleted"], slice_js),
            V.slice_loop(ids, "IVC", "v2d", V2P, "waDelSlices", "V2 WRITE: weighted-average batch rows removed (update_node_iaRvWaDel's write)", WA_TABLE, ["is_deleted"], slice_js),
            V.slice_loop(ids, "IVC", "v2s", V2P, "waSetSlices", "V2 WRITE: weighted averages restated (update_node_iaRvWaUpd's columns)", WA_TABLE, ["wa_quantity", "wa_cost_price"], slice_js),
            br("v2back", [("FIFO", sq("sql_node_IVCv2fifoB", "V2 read-back: the FIFO layers", S["fifo"](V2I))), ("WA", sq("sql_node_IVCv2waB", "V2 read-back: the weighted-average rows", S["wa"](V2I)))]),
            code(V2C, "V2 check: every layer / batch row removed, every weighted average at its after-values -> DONE", ccode("v2_check.js"), chk, arrays=chk_arr),
            end_rel(end_b(ids, "v2", V2C, "IF V2 did not complete"), "v2"),
            V.step_done(ids, "IVC", "v2", V2C, "V2_COST"),
        ]),
    ] + v2_free + [
        # ---------------------------------------------------------------- V3
        K.if_(ids, "if_IVCv3", "IF V3 BATCH is due (the Batch rows this assembly minted)", is_(CE, "needV3", "YES"), [
            part("sql_node_IVCv3part", "V3: the BATCH part", "BATCH"),
            code(V3I, "V3 input: the Batch row ids (digits only)", ccode("v3_in.js"), ["ok", "why", "ids", "idsSql"], arrays=("ids",)),
            sq("sql_node_IVCv3batch", "V3: the Batch rows now", S["batch"](V3I)),
            code(V3P, "V3 plan: what is not removed yet -> is_deleted 1 (update_node_iaRvBatchDel's write); a row gone -> review", ccode("v3_plan.js"),
                 ["route", "batchSlices", "batchCount"] + plan_end, arrays=("batchSlices", "jobRows"), objects=("batchCount",)),
            end_b(ids, "v3pl", V3P, "IF the batches cannot be removed"),
            V.slice_loop(ids, "IVC", "v3b", V3P, "batchSlices", "V3 WRITE: Batch rows removed (update_node_iaRvBatchDel's write)", BATCH_TABLE, ["is_deleted"], slice_js),
            sq("sql_node_IVCv3batchB", "V3 read-back: the Batch rows", S["batch"](V3I)),
            code(V3C, "V3 check: every Batch row removed -> DONE", ccode("v3_check.js"), chk, arrays=chk_arr),
            end_b(ids, "v3", V3C, "IF V3 did not complete"),
            V.step_done(ids, "IVC", "v3", V3C, "V3_BATCH"),
        ]),
        # ---------------------------------------------------------------- V4
        K.if_(ids, "if_IVCv4", "IF V4 FINISH is due (the header back to Draft, the number kept)", is_(CE, "needV4", "YES"), [
            br("v4read", [("HDR part", part("sql_node_IVCv4part", "V4: the HDR part", "HDR")), ("Item Assembly", sq("sql_node_IVCv4now", "V4: the Item Assembly now", S["ianow"], RSQL.C_IA_NOW_COLS))]),
            code(V4P, "V4 plan: Draft -> done; Processing under this job -> the HDR part's write; else review", ccode("v4_plan.js"),
                 ["route", "headerRows", "needHeader", "after", "markRows", "needMark"] + plan_end, arrays=("headerRows", "jobRows", "markRows"), objects=("after",)),
            end_b(ids, "v4pl", V4P, "IF the Item Assembly cannot be written"),
            gate(ids, "cor_IVCv4head", "Item Assembly to write?", V4P, "needHeader", [
                K.update(ids, "update_node_IVCv4head", "V4 WRITE: item_assembly_status Draft, posted_status blank (update_node_iaRvIa's write) - the Processing lock ends", IA_TABLE,
                         ("id", "in", N(V4P, "data.headerRows.id")), [(p, N(V4P, "data.headerRows." + p)) for p in ["id", "item_assembly_status", "posted_status"]], labels=IA_LABELS)]),
            gate(ids, "cor_IVCv4mark", "RES-01: an IA that reserves to mark RESERVING?", V4P, "needMark", [
                K.update(ids, "update_node_IVCv4mark", "RES-01 WRITE: material_hold_status RESERVING (the next open or save reserves again)", IA_TABLE,
                         ("id", "in", N(V4P, "data.markRows.id")), [(p, N(V4P, "data.markRows." + p)) for p in ["id", "material_hold_status"]], labels=IA_LABELS)]),
            sq("sql_node_IVCv4back", "V4 read-back: the Item Assembly", S["ianow"], RSQL.C_IA_NOW_COLS),
            code(V4C, "V4 check: Draft (posted_status blank) -> DONE", ccode("v4_check.js"), chk, arrays=chk_arr),
            end_b(ids, "v4", V4C, "IF V4 did not complete"),
            V.step_done(ids, "IVC", "v4", V4C, "V4_FINISH"),
        ]),
        # ---------------------------------------------------------------- finish
        code(FIN, "FINISH: the job COMPLETED (V4's write to Draft was the unlock)", ccode("finish.js"), ["jobRows", "result_message", "job_status"], arrays=("jobRows",)),
        job_update(ids, "update_node_IVCdone", "Job COMPLETED (lease released)", FIN, "jobRows"),
    ] + cres("done", FIN, "DONE")
    doc = K.workflow([("job_id", "string", "gd_async_job.id (digits) of a REVERT_IA job (READY_TO_COMMIT, or COMMITTING_REVERT to resume)")], C_RES, nodes)
    text = json.dumps(doc, ensure_ascii=False)
    no_tokens(text, "IA_REVERT_V2_COMMIT")
    return doc


# =============================================================================================== IA_REVERT_V2_WORKER
WSRC = os.path.join(HERE, "tpl", "sav2", "code", "worker")
WDST = os.path.join(HERE, "code", "revert", "worker")
HARD_SA = ('["SA_INVALID_REQUEST", "SA_INVALID_DATA", "SA_NOT_FOUND", "SA_SC_NOT_FOUND", "SA_NOT_LOCKED", "SA_NOT_ELIGIBLE", "SA_LINES_CHANGED", "SA_SC_CHANGED", '
           '"SA_SPLIT_REQUIRED", "SA_PLAN_BROKEN", "SA_REVIEW_BUILD_FAILED", "JOB_ILLEGAL_TRANSITION"]')
HARD_RV = ('["IA_RV_INVALID_REQUEST", "IA_RV_INVALID_DATA", "IA_RV_NOT_FOUND", "IA_RV_NOT_LOCKED", "IA_RV_NOT_ELIGIBLE", "IA_RV_REFUSED", "IA_RV_ROWS_CHANGED", '
           '"IA_RV_CONFLICTS", "IA_RV_SPLIT_REQUIRED", "IA_RV_PLAN_BROKEN", "IA_RV_PLAN_SKIPPED", "JOB_ILLEGAL_TRANSITION"]')
COMMON_CUT = "// SA V2 / SC Review V2 - helpers every package uses"
RELEASE_JS = r'''// the Item Assembly back to the status before the revert: only when this job owns it (ia id not "0") and prevStatus is Completed
// (CONTRACT.md RV1); an owned Item Assembly whose prevStatus is anything else keeps its lock and the job goes to REQUIRES_REVIEW
// IA_RV_PREV_STATUS_UNKNOWN (no default)
const iarvWorkerRelease = function iarvWorkerRelease(iaId, prevStatus) {
  const id = String(iaId === undefined || iaId === null ? "" : iaId).trim();
  const rel = { unlockRows: [], result_code: "" };
  if (!/^[0-9]{1,20}$/.test(id) || id === "0") return rel;
  if (!iaRvPrevStatusOk(prevStatus)) return Object.assign(rel, { result_code: "IA_RV_PREV_STATUS_UNKNOWN" });
  return Object.assign(rel, { unlockRows: [{ id: id, item_assembly_status: iaS(prevStatus) }] });
};
const IARV_REVIEW_PREV = { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: IA_TEXT.prevUnknown, error_code: "IA_RV_PREV_STATUS_UNKNOWN",
  error_message: IA_TEXT.prevUnknown };'''
WSUBS = [
    ("SA_V2_WORKER", "IA_REVERT_V2_WORKER"),
    ("SA_V2_PREPARE", "IA_REVERT_V2_PREPARE"),
    ("SA_V2_COMMIT", "IA_REVERT_V2_COMMIT"),
    ("COMPLETE_SA", "REVERT_IA"),
    ("COMMITTING_SA", "COMMITTING_REVERT"),
    (HARD_SA, HARD_RV),
    ("saWorkerRelease", "iarvWorkerRelease"),
    ("SA_REVIEW_PREV", "IARV_REVIEW_PREV"),
    ("SA_", "IA_RV_"),
    ("the Stock Adjustment back to its status before the completion", "the Item Assembly back to its status before the revert"),
    ("the Stock Adjustment stays Processing", "the Item Assembly stays Processing"),
    ("the run completing this Stock Adjustment died", "the run reverting this Item Assembly died"),
    ("before the Stock Adjustment was completed", "before the Item Assembly was reverted"),
    ("for the Stock Count, the items and the Stock Adjustment", "for the costing rows, the batches and the Item Assembly"),
    ("the completion could not be prepared", "the revert could not be prepared"),
    ("Not completed: the completion could not be finished", "Not reverted: the revert could not be finished"),
    ("Not completed: temporary failures persisted", "Not reverted: temporary failures persisted"),
    ("Not completed: ", "Not reverted: "),
    ('progress_message: "Under review: the completion stopped half-way"', 'progress_message: "Under review: the revert stopped half-way"'),
    ('error_message: "Under review: the completion stopped half-way. Please contact support."', "error_message: IA_TEXT.rvReview"),
    ('"Temporary failures persisted; not completed."', "IA_TEXT.rvNotReverted"),
]
WLEFT = ("SA_", "Stock Adjustment", "Stock Count", "COMPLETE_SA", "COMMITTING_SA", "saWorker", "saS(", "saPrev", "stock_adjustment", "SC Review", "not completed.",
         "the completion stopped")


def gen_worker():
    """code/revert/worker/*.js from tpl/sav2/code/worker/*.js (SA V2's de-LOT'd worker, CONTRACT.md RV5; never edits the template)"""
    os.makedirs(WDST, exist_ok=True)
    names = sorted(n for n in os.listdir(WSRC) if n.endswith(".js"))
    assert names == ["_common.js", "after_prepare.js", "after_publish.js", "callee.js", "claim.js", "guard.js", "mid.js", "own.js", "pick.js", "plan.js", "result.js", "split.js"], names
    for name in names:
        body = open(os.path.join(WSRC, name), encoding="utf-8").read()
        if name == "_common.js":
            assert body.count(COMMON_CUT) == 1, name
            body = body[: body.index(COMMON_CUT)]
            assert body.count(HARD_SA) == 1, name
        for a, b in WSUBS:
            body = body.replace(a, b)
        left = [w for w in WLEFT if w in body]
        assert not left, (name, left)
        assert not re.search(r"prevStatus\)?\s*\|\|\s*\"", body), (name, "a prevStatus default")
        if name == "_common.js":
            assert body.count(HARD_RV) == 1 and '"COMMITTING_REVERT"' in body and "PKC" in body, name
            body = body.rstrip("\n") + "\n" + shared("ia_common.js") + "\n" + RELEASE_JS + "\n"
        path = os.path.join(WDST, name)
        if not os.path.exists(path) or open(path, encoding="utf-8").read() != body:
            open(path, "w", encoding="utf-8").write(body)
    return names


# CONTRACT.md section 8 (verbatim, with ruling 5's g.is_deleted = 0): the IA lock join, the owner column and the prevStatus column
# - shared by both workers (RV5); a soft-deleted IA reads as not owned ('0'), so no unlock path writes a status onto it
IA_LOCK_JOIN = """LEFT JOIN sm_item_assembly g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^IA\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
   AND g.is_deleted = 0
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('IAC|', SUBSTRING(j.correlation_id, 4))
                   AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
IA_ID_COL = "(CASE WHEN g.item_assembly_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
IA_PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status"
WRENAMES = [("code_node_RW", "code_node_IVW"), ("sql_node_RW", "sql_node_IVW"), ("get_cache_RW", "get_cache_IVW"), ("set_cache_RW", "set_cache_IVW"),
            ("update_node_RW", "update_node_IVW"), ("add_node_RW", "add_node_IVW"), ("workflow_node_RW", "workflow_node_IVW"), ("cor_RW", "cor_IVW"),
            ("cori_YRW", "cori_YIVW"), ("cori_NRW", "cori_NIVW"), ("if_RW", "if_IVW"), ("ifBlock_TRW", "ifBlock_TIVW"), ("ifBlock_FRW", "ifBlock_FIVW"),
            ("loop_RW", "loop_IVW"), ("return_node_RW", "return_node_IVW"), ("gr_id", "ia_id"), ("grId", "iaId"),
            ("(phase A: revalidate, batches, inventory; or phase B on a resume)", "(phase A: revalidate, inventory; or phase B on a resume)"),
            ("(purchase orders, putaway, the receipt)", "(phase B: the costing rows, the batches, the Item Assembly)"),
            ("Goods Receiving back to its status before the submit", "Item Assembly back to its status before the revert"),
            ("Receipt lock", "Item Assembly lock"), ("receipt lock", "Item Assembly lock")]
JSAT_NODES = ("code_node_IVWpick", "code_node_IVWafterPrep", "code_node_IVWpubAfter", "code_node_IVWpub2After")


def declare_field(doc, node_id, name, after):
    """adds the string output `name` to a built code node's response_json right after `after`, with a key derived from the node id
    (no draw from wfkit's key stream) - tpl/sav2 build_worker.py's helper"""
    found, keys = [], set()

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


def build_worker():
    gen_worker()
    K._rng.seed(20261022)
    cfg = V.worker_config(name="IA_REVERT_V2_WORKER", code_dir=WDST, ids_base=1798840000000, command="REVERT_IA",
                          states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_REVERT"], lock_join=IA_LOCK_JOIN, id_col=IA_ID_COL, prev_col=IA_PREV_COL,
                          corr_offset=4, id_alias="gr_id", prepare=("IA_REVERT_V2_PREPARE", IDS["IA_REVERT_V2_PREPARE"]), commit=("IA_REVERT_V2_COMMIT", IDS["IA_REVERT_V2_COMMIT"]),
                          unlock=STATUS_UNLOCK, cache_prefix="iarv_wrk_", renames=WRENAMES, one_commit_per_run=True)
    doc = V.build_worker(cfg)
    for nid in JSAT_NODES:
        declare_field(doc, nid, "jsAt", "dbNow")
    text = json.dumps(doc, ensure_ascii=False)
    left = [w for w in ("GR_COMPLETE", "COMPLETE_GR", "COMMITTING_GR", "GRC_", "_RW", "gr_id", "grId", "gr_status", "Goods Receiving", "receipt", "grc_wrk_", "SA_", "COMPLETE_SA",
                        "COMMITTING_SA", "Stock Adjustment", "SUBSTRING(j.correlation_id, 5)") if w in text]
    assert not left, left
    assert text.count("SUBSTRING(j.correlation_id, 4)") >= 10, "correlation offset"
    assert text.count("'REVERT_IA'") == 1 and "COMMITTING_REVERT" in text and "iarv_wrk_" in text
    return doc


# =============================================================================================== IA_REVERT (classic v5)
def build_classic():
    return CLASSIC.build()


BUILDERS = [("IA_REVERT_V2_PREPARE", build_prepare), ("IA_REVERT_V2_COMMIT", build_commit), ("IA_REVERT_V2_WORKER", build_worker), ("IA_REVERT_V2_SUBMIT", build_submit),
            ("IA_REVERT", build_classic)]

if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    V.build(BUILDERS, OUT, "--write" in sys.argv, want)
