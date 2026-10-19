"""IA_V2_COMMIT (package C; CONTRACT.md sections 3, 4, 5, 9, 10, 14): executes PREPARE's manifest as resumable steps, with
TWO engine operations per job (the first V2 COMMIT that does). Step framework copied from tpl/sav2 (build_commit.py +
code/commit) and tpl/grv2/commit (C1's batch insert, C2's stepWait).

Phase A (nothing moved until I2): I0 REVALIDATE (stored header Processing under the job, the plan's number, IF1 fingerprint),
I1 BATCH (batch parents: duplicate check, intent, ONE Batch row, read back, the receipt's re-PLAN with that batch_id), I2 ISSUE
(op 1 = INVENTORY_BULK_APPLY APPLY IAC|<job>|I), then the SPLIT / PARK hand-over (progress 75, attempt_count 0).
Phase B (never unlocks): I3 RECEIPT (op 1 DONE, its stored OUT rows counted and summed in SQL, the price, op 2 = APPLY
IAC|<job>|R; transient answers wait 10 s up to 30 min after I2), I4 FINISH (Item dates, the header Completed), COMPLETED.
Every step reads its part and the rows now, writes only what is still at its before-value, reads back and records an
<STEP> DONE row.

usage: python3 build_commit.py [--write]      (or through the controller's build_ia.py)
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


CSQL = _load(os.path.join(HERE, "commit", "sql.py"), "ia_commit_sql")
IDS = json.load(open(os.path.join(HERE, "ids.json")))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "Item Assembly & BOM", "AsyncV2")
N, gate, call, job_update, step_add, is_ = V.N, V.gate, V.call, V.job_update, V.step_add, V.is_
IA_TABLE = IDS["sources"]["sm_item_assembly"]
BATCH = IDS["sources"]["batch"]
ITEM = IDS["sources"]["item"]
IA_LABELS = {"item_assembly_status": "Item Assembly Status", "posted_status": "Posted Status"}
ENGINE = ("INVENTORY_BULK_APPLY", IDS["INVENTORY_BULK_APPLY"])
RES = V.RES_FIELDS
CG, CE = "code_node_IACguard", "code_node_IACentry"
# add_node_F9KqZLfd (ADD_INVENTORY v65): the Batch row's columns (CONTRACT section 5 BATCH); no parent_transaction_no
BATCH_COLS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3", "manufacturing_date", "expired_date"]
SHARED = {"common": "code/shared/ia_common.js", "fp": "code/shared/fingerprint.js", "movekey": "code/shared/movekey.js", "price": "code/shared/price.js"}


def ccode(name, shared=(), extra=(), subs=None):
    """a step node's body: code/shared/ia_common.js (+ the named shared files), commit/_common.js (+ extras), the step file"""
    parts = [V.include_js(HERE, SHARED["common"])] + [V.include_js(HERE, SHARED[x]) for x in shared]
    parts += [V.raw(HERE, "code/commit/_common.js")] + [V.raw(HERE, "code/commit/" + x) for x in extra] + [V.raw(HERE, "code/commit/" + name)]
    body = "\n".join(parts)
    for a, b in (subs or {}).items():
        assert a in body, (name, a)
        body = body.replace(a, b)
    left = re.findall(r"__[A-Z]+__", body)
    assert not left, (name, left)
    return body


RESULT_JS = "const s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\n"


def code(nid, title, body, names, arrays=(), objects=()):
    """K.code, with the closing `return res;` spelled out as exactly the declared keys (the platform keeps only those; the
    linter then reads this return, not a helper's object literal, as the node's output) - tpl/sav2 build_commit.code"""
    body = body.rstrip()
    assert body.endswith("\nreturn res;"), (nid, body[-60:])
    body = body[: -len("return res;")] + "return { " + ", ".join("%s: res.%s" % (n, n) for n in names) + " };"
    return K.code(nid, title, body, names, arrays=arrays, objects=objects)


def cres(tag, src, path):
    body = RESULT_JS + V.raw(HERE, "code/commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [code("code_node_IAC%sres" % tag, "Result (%s)" % path, body, RES),
            K.ret("return_node_IAC%s" % tag, "Return (%s)" % path, [(f, N("code_node_IAC%sres" % tag, "data." + f)) for f in RES])]


def unlock(ids, nid, title, src, field="unlockRows"):
    return V.status_unlock(IA_TABLE, "item_assembly_status", {"item_assembly_status": IA_LABELS["item_assembly_status"]})(ids, nid, title, src, field)


def batch_del(ids, nid, title, src):
    return K.update(ids, nid, title, BATCH, ("id", "in", N(src, "data.batchDelRows.id")),
                    [("id", N(src, "data.batchDelRows.id")), ("is_deleted", N(src, "data.batchDelRows.is_deleted"))])


def end_a_nodes(ids, tag, src):
    # unlock FIRST: once the IA is back to Draft a resumed pass fails at the entry and never re-runs the engine, so a crash
    # between these writes can never leave a received item on a soft-deleted Batch row
    return [gate(ids, "cor_IAC%sunlock" % tag, "Item Assembly lock to release?", src, "needUnlock", [
                unlock(ids, "update_node_IAC%sunlock" % tag, "Item Assembly back to Draft (its status before the completion; no stock was moved)", src)]),
            gate(ids, "cor_IAC%sbatch" % tag, "This job's Batch row to remove?", src, "needBatchDel", [
                batch_del(ids, "update_node_IAC%sbatch" % tag, "This job's Batch row soft-deleted (I1's; no stock was moved)", src)]),
            gate(ids, "cor_IAC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
                job_update(ids, "update_node_IAC%sjob" % tag, "Job: wait / retry with backoff / FAILED / REQUIRES_REVIEW (lease released)", src, "jobRows")])]


def end_a(ids, tag, src, title):
    """phase A (no stock moved yet): the IA back to Draft, this job's Batch row removed, then the job row"""
    return K.if_(ids, "if_IAC%send" % tag, title, is_(src, "route", "END"), end_a_nodes(ids, tag, src) + cres(tag, src, tag.upper() + "_END"))


def end_b(ids, tag, src, title):
    """phase B (op 1 moved stock): wait / retry with backoff or REQUIRES_REVIEW - never back"""
    nodes = [gate(ids, "cor_IAC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
        job_update(ids, "update_node_IAC%sjob" % tag, "Job: wait / retry with backoff / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
    return K.if_(ids, "if_IAC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))


def build():
    K._rng.seed(20261019)  # this workflow's response_json keys do not depend on what else was built before it
    ids = K.Ids(1799800000000)
    S = CSQL.commit_sql(V.sub, N(CG, "data.tenantId"), N(CG, "data.jobId"), N(CE, "data.iaId"), N(CE, "data.parentItemId"), N(CE, "data.organizationId"),
                        N(CE, "data.oursItem"), N(CE, "data.oursOrg"), N(CE, "data.partPrefix"))
    sq = lambda nid, title, key, cols=("j",): K.sql(nid, title, S[key], list(cols))
    part = lambda nid, title, name: K.sql(nid, title, S["part"](name), ["step_name", "result_ref"])
    br = lambda tag, items: K.parallel("condition_all_IAC%s" % tag, "Reads in parallel", [("cai_IAC%s%d" % (tag, i), t, [n]) for i, (t, n) in enumerate(items)])
    entry_fields = ["route", "phase", "dbNow", "jsAt", "jobId", "tenantId", "organizationId", "plantId", "iaId", "iaNo", "parentItemId", "prevStatus", "idempotencyKey", "jobStatus",
                    "rowVersion", "attempts", "leaseUntil", "progress", "progressMessage", "unlockOk", "partPrefix", "batchMode", "movementsI", "lineFingerprint", "batchId", "batchNumber",
                    "i2DoneAt", "i2Called", "op1Wrote", "waitFrom", "intent", "hasIntent", "needOursRead", "oursItem", "oursOrg", "jobRows", "needJobUpd", "unlockRows", "needUnlock",
                    "batchDelRows", "needBatchDel",
                    "needI0", "needI1", "needI2", "needI3", "needI4", "result_code", "result_message", "job_status"]
    chk = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "batchDelRows", "needBatchDel", "result_code", "result_message", "job_status"]
    chk_arr = ("stepRows", "jobRows", "unlockRows", "batchDelRows")
    rej_body = RESULT_JS + V.raw(HERE, "code/commit/result.js") + "\nconst res = commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");\nreturn res;" % (
        N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    EE = "code_node_IACefend"
    I0 = "code_node_IACi0"
    I1D, I1C, I1A, I1 = "code_node_IACi1decide", "code_node_IACi1check", "code_node_IACi1ans", "code_node_IACi1"
    I2I, I2A, I2 = "code_node_IACi2in", "code_node_IACi2ans", "code_node_IACi2"
    I3P, I3A, I3 = "code_node_IACi3plan", "code_node_IACi3ans", "code_node_IACi3"
    I4P, I4C, FIN = "code_node_IACi4plan", "code_node_IACi4check", "code_node_IACfinish"
    E = "[%s][0]" % N(CE, "data")
    slice_js = V.raw(HERE, "code/commit/slice.js")
    i4 = lambda call_: ccode("i4.js", (), (), {"__CALL__": call_})
    nodes = [
        code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"),
             ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_IACreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            code("code_node_IACrejres", "Result (REJECTED_INPUT)", rej_body, RES),
            K.ret("return_node_IACrej", "Return (rejected input)", [(f, N("code_node_IACrejres", "data." + f)) for f in RES])]),
        K.parallel("condition_all_IACfacts", "Facts in parallel: the job (+ its request), its I step rows, the I1 intent, its manifest, the Item Assembly's status and lock, op 1's engine rows", [
            ("cai_IACjob", "Job", [K.sql("sql_node_IACjob", "The job (+ DB clock, lease flag, lease_until, due; request: prevStatus, action)", S["job"], CSQL.JOB_COLS)]),
            ("cai_IACsteps", "Steps", [K.sql("sql_node_IACsteps", "This job's I step rows (I0_ .. I4_: status, note, finished_at)", S["steps"], CSQL.STEPS_COLS)]),
            ("cai_IACintent", "Intent", [K.sql("sql_node_IACintent", "This job's I1|I|001 intent (the planned Batch row's identity)", S["intent"], ["step_name", "result_ref"])]),
            ("cai_IACpayload", "Manifest", [K.sql("sql_node_IACpayload", "The prepared manifest", S["payload"], ["prepared_payload"])]),
            ("cai_IACia", "Item Assembly + lock", [K.sql("sql_node_IACia", "The Item Assembly's status, its V2 job, its parent item and its latest IAC| LOCK row", S["ia"], CSQL.IA_COLS)]),
            ("cai_IACop1", "Op 1", [K.sql("sql_node_IACop1", "Op 1's engine rows (IAC|<job>|I: intents, IBA|REVIEW, the IBA|DONE summary): no clean failure once it wrote; I3's checks",
                                          S["op1"], ["intents", "review", "done_summary"])]),
        ]),
        code(CE, "Entry: what this run does (phase A: I0 I1 I2, SPLIT / PARK; phase B: I3 I4, COMPLETED), the lease claim", ccode("entry.js"),
             entry_fields, arrays=("jobRows", "unlockRows", "batchDelRows"), objects=("rowVersion", "attempts", "progress", "movementsI", "intent")),
        K.if_(ids, "if_IACnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_IACentryend", "IF the manifest is unusable or the Item Assembly lost its lock: FAILED (+ back to Draft) or REQUIRES_REVIEW",
              "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), [
                  gate(ids, "cor_IACefours", "An I1 insert without its DONE row: its Batch row to find?", CE, "needOursRead", [
                      sq("sql_node_IACefours", "Entry: the intent item's live Batch rows inserted after the job (BATCH_ROWS, id > job)", "oursrows")]),
                  code(EE, "Entry end: the entry's job / unlock / Batch rows (+ the intent-identified Batch row)", ccode("entry_end.js", (), ("_i1.js",)),
                       ["route", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "batchDelRows", "needBatchDel", "result_code", "result_message", "job_status"],
                       arrays=("jobRows", "unlockRows", "batchDelRows")),
              ] + end_a_nodes(ids, "ef", EE) + cres("ef", EE, "ENTRY_END")),
        job_update(ids, "update_node_IACclaim", "Lease claim: job COMMITTING_IA, lease_owner = this run, lease_expires_at = now + 10 min", CE, "jobRows"),
        K.sql("sql_node_IACown", "Read-back: the job after the lease claim", S["own"], CSQL.OWN_COLS),
        code("code_node_IACown", "Own: COMMITTING_IA under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_IAClost", "IF another run took the job: stop", is_("code_node_IACown", "route", "LOST"), cres("lost", "code_node_IACown", "LOST")),
        # ---------------------------------------------------------------- I0
        K.if_(ids, "if_IACi0", "IF I0 REVALIDATE is due", is_(CE, "needI0", "YES"), [
            br("i0read", [("Header", sq("sql_node_IACi0hdr", "I0: the stored header (FP_HEADER)", "hdr")),
                          ("Lines", sq("sql_node_IACi0lines", "I0: the stored component lines (FP_LINES: what iaLineFingerprint reads)", "lines"))]),
            code(I0, "I0 REVALIDATE: Processing under this job, the plan's number and IF1 fingerprint -> DONE; else FAILED + back to Draft", ccode("i0.js", ("fp",)), chk, arrays=chk_arr),
            end_a(ids, "i0", I0, "IF the Item Assembly changed meanwhile (FAILED)"),
            V.step_done(ids, "IAC", "i0", I0, "I0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- I1
        K.if_(ids, "if_IACi1", "IF I1 BATCH is due (a batch-managed assembled item, batch number system-generated)", is_(CE, "needI1", "YES"), [
            br("i1read", [("BATCH part", part("sql_node_IACi1part", "I1: the BATCH part (the planned Batch row)", "BATCH")),
                          ("ENGINE_R part", part("sql_node_IACi1engr", "I1: the ENGINE_R part (the receipt to re-PLAN)", "ENGINE_R")),
                          ("Batch rows", sq("sql_node_IACi1rows", "I1: the organization's live Batch rows of the assembled item (BATCH_ROWS)", "batchrows"))]),
            code(I1D, "I1 decide: ours -> adopt; the number held by another row -> FAILED IA_BATCH_DUPLICATE; else the intent + ONE Batch row",
                 ccode("i1_decide.js", (), ("_i1.js",), {"__BATCHCOLS__": json.dumps(BATCH_COLS)}),
                 chk + ["identity", "ours", "intentRows", "needIntent", "insertRows", "needInsert", "r1", "opKeyR"], arrays=chk_arr + ("ours", "intentRows", "insertRows"),
                 objects=("identity", "r1")),
            end_a(ids, "i1de", I1D, "IF the Batch row cannot be planned (FAILED)"),
            gate(ids, "cor_IACi1intent", "Intent to record (BEFORE the insert)?", I1D, "needIntent", [
                step_add(ids, "add_node_IACi1intent", "I1 INTENT: I1|I|001 = the planned Batch row's identity (unique job / step)", I1D, "intentRows")]),
            gate(ids, "cor_IACi1add", "Batch row to insert?", I1D, "needInsert", [
                K.add(ids, "add_node_IACi1add", "I1 WRITE: the Batch row (ADD_INVENTORY's add_node_F9KqZLfd columns)", BATCH, [(p, N(I1D, "data.insertRows." + p)) for p in BATCH_COLS])]),
            gate(ids, "cor_IACi1back", "Inserted: read it back?", I1D, "needInsert", [
                sq("sql_node_IACi1back", "I1 read-back: the assembled item's live Batch rows inserted after the job (BATCH_ROWS, id > job)", "batchback")]),
            code(I1C, "I1 check: exactly one Batch row of ours -> the receipt re-PLAN with its batch_id; two -> FAILED; none -> retry", ccode("i1_check.js", (), ("_i1.js",)),
                 chk + ["ours", "batchId", "batchNumber", "needPlan", "planKey", "planMovements", "keys"], arrays=chk_arr + ("ours", "planMovements", "keys")),
            end_a(ids, "i1ck", I1C, "IF the Batch row did not read back (retry / FAILED)"),
            gate(ids, "cor_IACi1plan", "Receipt re-PLAN to run?", I1C, "needPlan", [
                call(ids, "workflow_node_IACi1plan", "INVENTORY_BULK_APPLY PLAN of the receipt (IAC|<job>|R, our batch_id, unit_price 0; writes nothing)", ENGINE, [
                    ("operation_key", N(I1C, "data.planKey")), ("mode", "PLAN", "value"), ("organization_id", N(CE, "data.organizationId")), ("movements", N(I1C, "data.planMovements"))])]),
            code(I1A, "I1: the re-PLAN's answer (R1's code; LABELS to read for a refusal?)", ccode("i1_ans.js"), ["code", "result_code", "message", "r1Code", "r1Message", "needLabels"]),
            gate(ids, "cor_IACi1lab", "A refusal: the LABELS part to read?", I1A, "needLabels", [part("sql_node_IACi1labels", "I1: the LABELS part (movement_key -> line, item, bin)", "LABELS")]),
            code(I1, "I1 BATCH: 200 + R1 200 -> DONE {batch_id, batch_number}; a refusal -> FAILED + back to Draft + our Batch row soft-deleted",
                 ccode("i1.js", ("movekey",)), chk + ["batchId"], arrays=chk_arr),
            end_a(ids, "i1", I1, "IF the receipt would be refused (FAILED)"),
            V.step_done(ids, "IAC", "i1", I1, "I1_BATCH"),
        ]),
        # ---------------------------------------------------------------- I2
        K.if_(ids, "if_IACi2", "IF I2 ISSUE is due (phase A ends here: SPLIT / PARK)", is_(CE, "needI2", "YES"), [
            part("sql_node_IACi2part", "I2: the ENGINE_I part (one SUBTRACT per stock pick)", "ENGINE_I"),
            code(I2I, "I2: the operation key and the movements (none -> no call)", ccode("i2_in.js"), ["ok", "needCall", "operationKey", "movements", "keys", "count", "why"],
                 arrays=("movements", "keys"), objects=("count",)),
            gate(ids, "cor_IACi2call", "Stock to issue?", I2I, "needCall", [
                call(ids, "workflow_node_IACi2", "INVENTORY_BULK_APPLY APPLY op 1 (IAC|<job>|I; all-or-nothing, replayed on a re-run)", ENGINE, [
                    ("operation_key", N(I2I, "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")), ("movements", N(I2I, "data.movements"))])]),
            code(I2A, "I2: op 1's answer (409 / none: read its intent rows; 400: read the LABELS part)", ccode("i2_ans.js"), ["code", "result_code", "message", "summary", "need409", "need400"],
                 objects=("summary",)),
            gate(ids, "cor_IACi2ops", "409 / no answer: op 1's intent rows to count?", I2A, "need409", [
                sq("sql_node_IACi2ops", "I2: op 1's engine rows (intents: any = it may have written)", "op1", ["intents", "review", "done_summary"])]),
            gate(ids, "cor_IACi2lab", "400: the LABELS part to read?", I2A, "need400", [part("sql_node_IACi2labels", "I2: the LABELS part (movement_key -> line, item, bin)", "LABELS")]),
            code(I2, "I2 check: 200 / no movement -> DONE + SPLIT or PARK; 409 -> wait, then FAILED (review with intent rows); 400 -> FAILED (mapped); else review",
                 ccode("i2.js", ("movekey",)), chk + ["splitRows", "needSplit", "path"], arrays=chk_arr + ("splitRows",)),
            end_a(ids, "i2", I2, "IF the components were not issued"),
            V.step_done(ids, "IAC", "i2", I2, "I2_ISSUE"),
            gate(ids, "cor_IACsplit", "SPLIT / PARK hand-over to write?", I2, "needSplit", [
                job_update(ids, "update_node_IACsplit", "Job: SPLIT| hand-over lease (the worker calls phase B now) or PARK (due now, no lease: the next tick); progress 75, attempt_count 0", I2,
                           "splitRows")]),
        ] + cres("split", I2, "SPLIT")),
        # ---------------------------------------------------------------- I3
        K.if_(ids, "if_IACi3", "IF I3 RECEIPT is due (op 2: the assembled item, priced from op 1's stored rows)", is_(CE, "needI3", "YES"), [
            # op 1's engine rows come from the entry's read of this pass (nothing writes them in phase B)
            br("i3read", [("ENGINE_R part", part("sql_node_IACi3engr", "I3: the ENGINE_R part (R1, receiptBaseQty, assemblyCost)", "ENGINE_R")),
                          ("OUT totals", K.sql("sql_node_IACi3out", "I3: op 1's stored OUT rows, counted and summed (OUT_TOTALS: id > job, operation_effect_key IAC|<job>|I|%)", S["out"], ["n", "total"]))]),
            code(I3P, "I3 plan: op 1 DONE, no review, stored rows = its code-200 results; the price; R1 with it and I1's batch_id", ccode("i3_plan.js", ("price",)),
                 ["route", "needCall", "operationKey", "movements", "price", "outCount", "outTotal", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "batchDelRows",
                  "needBatchDel", "result_code", "result_message", "job_status"], arrays=("movements", "stepRows", "jobRows", "unlockRows", "batchDelRows"), objects=("price", "outCount")),
            end_b(ids, "i3pl", I3P, "IF op 2 may not start (REQUIRES_REVIEW)"),
            gate(ids, "cor_IACi3call", "Receipt to apply?", I3P, "needCall", [
                call(ids, "workflow_node_IACi3", "INVENTORY_BULK_APPLY APPLY op 2 (IAC|<job>|R: R1 at the computed price; replayed on a re-run)", ENGINE, [
                    ("operation_key", N(I3P, "data.operationKey")), ("mode", "APPLY", "value"), ("organization_id", N(CE, "data.organizationId")), ("movements", N(I3P, "data.movements"))])]),
            code(I3A, "I3: op 2's answer (R1's code; transient -> read op 2's intent rows)", ccode("i3_ans.js"), ["code", "result_code", "message", "r1Code", "r1Message", "r1Price", "needOps"]),
            gate(ids, "cor_IACi3ops", "Transient: op 2's intent rows to read?", I3A, "needOps", [
                sq("sql_node_IACi3op2", "I3: op 2's engine rows (intents, IBA|REVIEW, the IBA|DONE summary)", "op2", ["intents", "review", "done_summary"])]),
            code(I3, "I3 check: 200 + R1 200 -> DONE + progress 80; transient -> wait 10 s until 30 min after I2, then review; else review", ccode("i3.js"),
                 chk + ["progressRows", "needProgress"], arrays=chk_arr + ("progressRows",)),
            end_b(ids, "i3", I3, "IF the assembled item was not received"),
            V.step_done(ids, "IAC", "i3", I3, "I3_RECEIPT"),
            gate(ids, "cor_IACi3prog", "Progress 80 to write (both operations moved stock)?", I3, "needProgress", [
                job_update(ids, "update_node_IACi3prog", "Job: progress 80 'Assembled item received; finishing' (lease kept)", I3, "progressRows",
                           ["id", "progress_percent", "progress_message"])]),
        ]),
        # ---------------------------------------------------------------- I4
        K.if_(ids, "if_IACi4", "IF I4 FINISH is due", is_(CE, "needI4", "YES"), [
            br("i4read", [("ITEMS part", part("sql_node_IACi4items", "I4: the ITEMS part (parent + component item ids)", "ITEMS")),
                          ("Owner", K.sql("sql_node_IACi4own", "I4: the Item Assembly's status, job link and latest lock now (OWNER)", S["owner"], CSQL.OWNER_COLS))]),
            code(I4P, "I4 plan: Completed -> done; Processing under this job -> Item dates in slices, then the header Completed / Unposted; else review",
                 i4("commitI4Plan(%s, [%s][0], [%s][0])" % (E, N("sql_node_IACi4items", "data"), N("sql_node_IACi4own", "data"))),
                 chk + ["statusRows", "needStatus", "itemSlices", "itemCount"], arrays=chk_arr + ("statusRows", "itemSlices"), objects=("itemCount",)),
            end_b(ids, "i4pl", I4P, "IF the Item Assembly cannot be finished"),
            V.slice_loop(ids, "IAC", "i4i", I4P, "itemSlices", "I4 WRITE: Item last_transaction_date (code_item_txn's value)", ITEM, ["last_transaction_date"], slice_js),
            gate(ids, "cor_IACi4status", "Completed to write?", I4P, "needStatus", [
                K.update(ids, "update_node_IACi4status", "I4 WRITE: item_assembly_status Completed, posted_status Unposted - the Processing lock ends", IA_TABLE, ("id", "in", N(I4P, "data.statusRows.id")),
                         [(p, N(I4P, "data.statusRows." + p)) for p in ["id", "item_assembly_status", "posted_status"]], labels=IA_LABELS)]),
            K.sql("sql_node_IACi4back", "I4 read-back: the Item Assembly (OWNER)", S["owner"], CSQL.OWNER_COLS),
            code(I4C, "I4 check: Completed under this job -> DONE", i4("commitI4Check(%s, [%s][0])" % (E, N("sql_node_IACi4back", "data"))), chk, arrays=chk_arr),
            end_b(ids, "i4", I4C, "IF I4 did not complete"),
            V.step_done(ids, "IAC", "i4", I4C, "I4_FINISH"),
        ]),
        # ---------------------------------------------------------------- finish
        code(FIN, "FINISH: the job COMPLETED (I4's status write was the unlock)", ccode("finish.js"), ["jobRows", "result_message", "job_status"], arrays=("jobRows",)),
        job_update(ids, "update_node_IACdone", "Job COMPLETED (lease released)", FIN, "jobRows"),
    ] + cres("done", FIN, "DONE")
    doc = K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_IA job (READY_TO_COMMIT, or COMMITTING_IA to resume)")], RES, nodes)
    text = json.dumps(doc, ensure_ascii=False)
    left = re.findall(r"__[A-Z]+__", text)
    assert not left, left
    # nothing of the templates is left (code/shared's provenance comments may name them)
    stale = [w for w in ("COMMITTING_SA", "COMPLETE_SA", "SA_V2", "SAC|", "\"SA_", "sa_v2_job_id", "stock_adjustment", "COMMITTING_GR", "GRC|", "\"GRC_", "Goods Receiving", "COMMITTING_LOT")
             if w in text]
    assert not stale, stale
    return doc


BUILDERS = [("IA_V2_COMMIT", build)]

if __name__ == "__main__":
    V.build(BUILDERS, OUT, "--write" in sys.argv)
