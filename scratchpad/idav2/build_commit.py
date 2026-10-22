"""IDA_V2_COMMIT (package C; CONTRACT.md sections 1-5, 9, 10, 14): executes PREPARE's manifest as resumable steps with TWO engine
operations per job (tpl/iav2 IA_V2_COMMIT with the legs mirrored: op 2 is the big one) and GR V2 C1 / C1B's multi-row batch step.

Phase A (nothing moved until D2): D0 REVALIDATE (stored header Processing under the job, the plan's number, the DF1 fingerprint), D1 BATCH
(the D1 decision table rows 1-14: intent before any write, configs only forward, Batch rows by add-node in slices of 250, read-back, the
controller's post-insert re-check, the re-PLAN of op 2 with the real batch ids), D2 ISSUE (op 1 = INVENTORY_BULK_APPLY APPLY IDC|<job>|I),
then the SPLIT / PARK hand-over (progress 75, attempt_count 0; PARK when either leg holds more than 1,000 movements).
Phase B (never unlocks): D3 RECEIPT (op 1 DONE, its stored OUT rows counted and summed in SQL, idaAllocate, batch_id = ours, op 2 =
APPLY IDC|<job>|R, transient answers wait 10 s up to 30 min after D3's first one), D4 FINISH (AUTO numbers into the lines, Item dates,
the header Completed / Unposted LAST), COMPLETED. Every step reads its part and the rows now, writes only what is still at its
before-value, reads back and records a <STEP> DONE row. A phase-A failure: unlock -> our Batch rows soft-deleted -> the job row. D1's
renumber (a number another writer took is only one this job generated): our Batch rows -> the D1|I| intent retired -> the job due in 5 s
(its colliding row the oldest) or 20-30 s.

usage: python3 build_commit.py [--write]      (or through the controller's build_ida.py)
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


CSQL = _load(os.path.join(HERE, "commit", "sql.py"), "ida_commit_sql")
IDS = json.load(open(os.path.join(HERE, "ids.json")))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "Item Disassembly", "AsyncV2")
N, gate, call, job_update, step_add, is_ = V.N, V.gate, V.call, V.job_update, V.step_add, V.is_
TB = IDS["tables"]
IDA_TABLE = "Item Disassembly:Table:" + TB["sm_item_disassembly"]
LINE_TABLE = "Stock movement(Item Disassembly):Table:" + TB["sm_item_disassembly_tlm8ve69_sub"]
BATCH = "Batch:Table:" + TB["batch"]
BNC = "Batch Number Configuration:Table:" + TB["batch_number_config"]
ITEM = "Item:Table:" + TB["item"]
IDA_LABELS = {"item_disassembly_status": "Item Disassembly Status", "posted_status": "Posted Status"}
ENGINE = ("INVENTORY_BULK_APPLY", IDS["INVENTORY_BULK_APPLY"])
RES = V.RES_FIELDS
CG, CE = "code_node_DCguard", "code_node_DCentry"
# add_node_F9KqZLfd (ADD_INVENTORY v65): the Batch row's 11 columns (CONTRACT.md section 5 BATCH_COLS); no parent_transaction_no
BATCH_COLS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3", "manufacturing_date", "expired_date"]
SHARED = {"common": "code/shared/ida_common.js", "fp": "code/shared/fingerprint.js", "movekey": "code/shared/movekey.js", "price": "code/shared/price.js",
          "batchnum": "code/shared/batchnum.js", "bnadapter": "code/shared/batchnum_adapter.js"}
CHK = ["route", "stepRows", "needStep", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "batchDelSlices", "needBatchDel", "intentDelSlices", "needIntentDel", "needOursRead",
       "result_code", "result_message", "job_status"]
CHK_ARR = ("stepRows", "jobRows", "unlockRows", "batchDelSlices", "intentDelSlices")
EXIT = ["route", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "batchDelSlices", "needBatchDel", "intentDelSlices", "needIntentDel", "result_code", "result_message", "job_status"]
EXIT_ARR = ("jobRows", "unlockRows", "batchDelSlices", "intentDelSlices")


def ccode(name, shared=(), extra=(), subs=None):
    """a step node's body: code/shared/ida_common.js (+ the named shared files), commit/_common.js (+ extras), the step file"""
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
    """K.code, with the closing `return res;` spelled out as exactly the declared keys (the platform keeps only those; the linter then
    reads this return, not a helper's object literal, as the node's output) - tpl/iav2 build_commit.code"""
    body = body.rstrip()
    assert body.endswith("\nreturn res;"), (nid, body[-60:])
    body = body[: -len("return res;")] + "return { " + ", ".join("%s: res.%s" % (n, n) for n in names) + " };"
    return K.code(nid, title, body, names, arrays=arrays, objects=objects)


def cres(tag, src, path):
    body = RESULT_JS + V.raw(HERE, "code/commit/result.js") + "\nconst res = commitResult([%s][0], [%s][0], [%s][0], %s);\nconsole.log(\"commit result\", JSON.stringify(res));\nreturn res;" % (
        N(CG, "data"), N(CE, "data"), N(src, "data") if src else "null", json.dumps(path))
    return [code("code_node_DC%sres" % tag, "Result (%s)" % path, body, RES),
            K.ret("return_node_DC%s" % tag, "Return (%s)" % path, [(f, N("code_node_DC%sres" % tag, "data." + f)) for f in RES])]


def unlock(ids, nid, title, src, field="unlockRows"):
    return V.status_unlock(IDA_TABLE, "item_disassembly_status", {"item_disassembly_status": IDA_LABELS["item_disassembly_status"]})(ids, nid, title, src, field)


def build():
    K._rng.seed(20261021)  # this workflow's response_json keys do not depend on what else was built before it
    ids = K.Ids(1801100000000)
    D1P = "code_node_DCd1plan"
    S = CSQL.commit_sql(V.sub, N(CG, "data.tenantId"), N(CG, "data.jobId"), N(CE, "data.idaId"), N(CE, "data.organizationId"), N(CE, "data.partPrefix"), N(D1P, "data.hexSql"))
    sq = lambda nid, title, key, cols=("j",): K.sql(nid, title, S[key], list(cols))
    part = lambda nid, title, name: K.sql(nid, title, S["part"](name), CSQL.PART_COLS)
    br = lambda tag, items: K.parallel("condition_all_DC%s" % tag, "Reads in parallel", [("cai_DC%s%d" % (tag, i), t, [n]) for i, (t, n) in enumerate(items)])
    slice_js = V.raw(HERE, "code/commit/slice.js")
    E = "[%s][0]" % N(CE, "data")

    def end_a_nodes(tag, src, ours=None):
        """the phase-A exit: [ours read + the exit rows], the unlock, our Batch rows soft-deleted in slices of 250, D1's renumber: the D1|I| intent
        rows retired (renamed D1|X|<id> + soft-deleted), the job row (IA ruling 5)"""
        nodes, fin = [], src
        if ours:
            intent_node = "sql_node_DCintent"
            reads = [("BATCH part", part("sql_node_DC%sopart" % tag, "Exit: the BATCH part (the planned Batch rows)", "BATCH"))]
            if ours == "fresh":
                intent_node = "sql_node_DC%soint" % tag
                reads.append(("Intent", K.sql(intent_node, "Exit: the D1|I| intent now (D1 may have written it in this pass)", S["intent"], CSQL.INTENT_COLS)))
            reads.append(("Ours", sq("sql_node_DC%soours" % tag, "Exit: the Batch rows this job may have inserted (BATCH_OURS: id > job, the IDA's number)", "ours")))
            nodes.append(gate(ids, "cor_DC%sours" % tag, "FAILED with a D1 intent: this job's Batch rows to find?", src, "needOursRead", [br(tag + "ours", reads)]))
            fin = "code_node_DC%send" % tag
            nodes.append(code(fin, "Exit rows: the job / unlock rows + ours (the D1 intent's planned identities among BATCH_OURS) in slices of 250",
                              ccode("ours_end.js", subs={"__SRC__": src, "__PART__": "sql_node_DC%sopart" % tag, "__INTENT__": intent_node, "__OURS__": "sql_node_DC%soours" % tag}),
                              EXIT, arrays=EXIT_ARR))
        nodes += [gate(ids, "cor_DC%sunlock" % tag, "Item Disassembly lock to release?", fin, "needUnlock", [
                      unlock(ids, "update_node_DC%sunlock" % tag, "Item Disassembly back to Draft (its status before the completion; nothing was moved)", fin)]),
                  V.slice_loop(ids, "DC", tag + "bd", fin, "batchDelSlices", "This job's Batch rows soft-deleted (nothing was moved)", BATCH, ["is_deleted"], slice_js),
                  gate(ids, "cor_DC%six" % tag, "D1 renumber: the D1|I| intent rows to retire?", fin, "needIntentDel", [
                      V.slice_loop(ids, "DC", tag + "ix", fin, "intentDelSlices", "The D1|I| intent rows renamed D1|X|<id> and soft-deleted (the next pass numbers afresh)", V.STEP,
                                   ["step_name", "is_deleted"], slice_js)]),
                  gate(ids, "cor_DC%sjob" % tag, "Job row to write?", fin, "needJobUpd", [
                      job_update(ids, "update_node_DC%sjob" % tag, "Job: wait / retry with backoff / FAILED / REQUIRES_REVIEW (lease released)", fin, "jobRows")])]
        return nodes, fin

    def end_a(tag, src, title, ours=None):
        nodes, fin = end_a_nodes(tag, src, ours)
        return K.if_(ids, "if_DC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, fin, tag.upper() + "_END"))

    def end_b(tag, src, title):
        """phase B (op 1 moved stock): wait / retry with backoff or REQUIRES_REVIEW - never back"""
        nodes = [gate(ids, "cor_DC%sjob" % tag, "Job row to write?", src, "needJobUpd", [
            job_update(ids, "update_node_DC%sjob" % tag, "Job: wait / retry with backoff / REQUIRES_REVIEW (lease released)", src, "jobRows")])]
        return K.if_(ids, "if_DC%send" % tag, title, is_(src, "route", "END"), nodes + cres(tag, src, tag.upper() + "_END"))

    def engine(nid, title, src, mode, key_field, moves_field):
        return call(ids, nid, title, ENGINE, [("operation_key", N(src, "data." + key_field)), ("mode", mode, "value"), ("organization_id", N(CE, "data.organizationId")),
                                              ("movements", N(src, "data." + moves_field))])

    entry_fields = ["route", "phase", "dbNow", "jsAt", "jobId", "tenantId", "organizationId", "plantId", "idaId", "idaNo", "prevStatus", "idempotencyKey", "jobStatus", "rowVersion",
                    "attempts", "leaseUntil", "progress", "progressMessage", "unlockOk", "partPrefix", "batchMode", "needBatchRead", "movementsI", "movementsR", "lineFingerprint",
                    "d2DoneAt", "op1Wrote", "op2Wrote", "opWrote", "waitFrom", "hasIntent", "skipNote", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "batchDelSlices", "needBatchDel",
                    "intentDelSlices", "needIntentDel", "needOursRead", "stepRows", "needStep", "needD0", "needD1", "needD2", "needD3", "needD4", "result_code", "result_message",
                    "job_status"]
    rej_body = RESULT_JS + V.raw(HERE, "code/commit/result.js") + "\nconst res = commitResult([%s][0], {}, { job_status: \"\", result_code: [%s][0], result_message: [%s][0] }, \"REJECTED_INPUT\");\nreturn res;" % (
        N(CG, "data"), N(CG, "data.result_code"), N(CG, "data.result_message"))
    D0 = "code_node_DCd0"
    D1D, D1W, D1C, D1A, D1 = "code_node_DCd1decide", "code_node_DCd1word", "code_node_DCd1check", "code_node_DCd1ans", "code_node_DCd1"
    D2I, D2A, D2 = "code_node_DCd2in", "code_node_DCd2ans", "code_node_DCd2"
    D3P, D3A, D3 = "code_node_DCd3plan", "code_node_DCd3ans", "code_node_DCd3"
    D4P, D4C, FIN = "code_node_DCd4plan", "code_node_DCd4check", "code_node_DCfinish"
    d4 = lambda call_: ccode("d4.js", (), (), {"__CALL__": call_})
    ef_nodes, ef_fin = end_a_nodes("ef", CE, "entry")
    nodes = [
        code(CG, "Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>", ccode("guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_DCreject", "IF the input is invalid: answer, write nothing", is_(CG, "route", "REJECT"), [
            code("code_node_DCrejres", "Result (REJECTED_INPUT)", rej_body, RES),
            K.ret("return_node_DCrej", "Return (rejected input)", [(f, N("code_node_DCrejres", "data." + f)) for f in RES])]),
        K.parallel("condition_all_DCfacts", "Facts in parallel: the job (+ its request), its D step rows, the D1 intent, its manifest, the Item Disassembly's status and lock, both operations' engine rows", [
            ("cai_DCjob", "Job", [K.sql("sql_node_DCjob", "The job (+ DB clock, the 10-minute lease end, lease flag, due; request: prevStatus, action)", S["job"], CSQL.JOB_COLS)]),
            ("cai_DCsteps", "Steps", [K.sql("sql_node_DCsteps", "This job's D step rows (D0_ .. D4_: status, note, finished_at)", S["steps"], CSQL.STEPS_COLS)]),
            ("cai_DCintent", "Intent", [K.sql("sql_node_DCintent", "This job's D1|I|nnn intent (the generated numbers and the configs before / after)", S["intent"], CSQL.INTENT_COLS)]),
            ("cai_DCpayload", "Manifest", [K.sql("sql_node_DCpayload", "The prepared manifest", S["payload"], ["prepared_payload"])]),
            ("cai_DCida", "Item Disassembly + lock", [K.sql("sql_node_DCida", "The Item Disassembly's status, its V2 job and its latest IDC| LOCK row (OWNER via the job's correlation)", S["ida"], CSQL.IDA_COLS)]),
            ("cai_DCop1", "Op 1", [K.sql("sql_node_DCop1", "Op 1's engine rows (IDC|<job>|I: intents, IBA|REVIEW, the IBA|DONE summary): D3's checks; no clean failure once it wrote", S["op1"],
                                         CSQL.SH.OP_STATE_COLS)]),
            ("cai_DCop2", "Op 2", [K.sql("sql_node_DCop2", "Op 2's engine rows (IDC|<job>|R): no clean failure once it wrote", S["op2"], CSQL.SH.OP_STATE_COLS)]),
        ]),
        code(CE, "Entry: what this run does (phase A: D0 D1 D2, SPLIT / PARK; phase B: D3 D4, COMPLETED), the job-sized lease claim", ccode("entry.js"), entry_fields,
             arrays=("jobRows", "unlockRows", "batchDelSlices", "intentDelSlices", "stepRows"), objects=("rowVersion", "attempts", "progress", "movementsI", "movementsR")),
        K.if_(ids, "if_DCnowrite", "IF this run may not write: answer only", is_(CE, "route", "NO_WRITE"), cres("nw", CE, "NO_WRITE")),
        K.if_(ids, "if_DCentryend", "IF the manifest is unusable or the Item Disassembly lost its lock: FAILED (+ back to Draft, + our Batch rows removed) or REQUIRES_REVIEW",
              "%s || %s" % (is_(CE, "route", "FAIL"), is_(CE, "route", "REVIEW")), ef_nodes + cres("ef", ef_fin, "ENTRY_END")),
        job_update(ids, "update_node_DCclaim", "Lease claim: job COMMITTING_IDA, lease_owner = this run, lease_expires_at = the job-sized lease (idaLeaseSeconds)", CE, "jobRows"),
        K.sql("sql_node_DCown", "Read-back: the job after the lease claim", S["own"], CSQL.OWN_COLS),
        code("code_node_DCown", "Own: COMMITTING_IDA under this run's lease, else LOST", ccode("own.js"), ["route", "result_code", "result_message"]),
        K.if_(ids, "if_DClost", "IF another run took the job: stop", is_("code_node_DCown", "route", "LOST"), cres("lost", "code_node_DCown", "LOST")),
        # ---------------------------------------------------------------- D0
        K.if_(ids, "if_DCd0", "IF D0 REVALIDATE is due", is_(CE, "needD0", "YES"), [
            br("d0read", [("Header", sq("sql_node_DCd0hdr", "D0: the stored header (FP_HEADER: status, job, number, picks)", "hdr")),
                          ("Lines", sq("sql_node_DCd0lines", "D0: the stored recovery lines (FP_LINES: what idaLineFingerprint reads)", "lines"))]),
            code(D0, "D0 REVALIDATE: Processing under this job, the plan's number and DF1 fingerprint -> DONE; else FAILED + back to Draft", ccode("d0.js", ("fp",)), CHK, arrays=CHK_ARR),
            end_a("d0", D0, "IF the Item Disassembly changed meanwhile (FAILED)", "entry"),
            V.step_done(ids, "DC", "d0", D0, "D0_REVALIDATE"),
        ]),
        # ---------------------------------------------------------------- D1
        K.if_(ids, "if_DCd1", "IF D1 BATCH is due (a TYPED or AUTO recovery batch: the Batch rows and the generated numbers)", is_(CE, "needD1", "YES"), [
            br("d1read", [("BATCH part", part("sql_node_DCd1part", "D1: the BATCH part (the planned Batch rows + the AUTO rows' items)", "BATCH")),
                          ("Configs", sq("sql_node_DCd1bnc", "D1: the organization's batch_number_config rows now (BNC, fresh)", "bnc"))]),
            code(D1P, "D1 plan: the part checked; the intent's numbers, else the AUTO numbers from the fresh configs (batchnum = N GENERATE_BATCH calls); every planned number hex-encoded",
                 ccode("d1_plan.js", ("batchnum", "bnadapter"), ("_d1.js",)), CHK + ["hasIntent", "draft", "hexSql", "planned"], arrays=CHK_ARR, objects=("draft", "planned")),
            end_a("d1pl", D1P, "IF the Batch rows cannot be planned (FAILED / REQUIRES_REVIEW)"),
            sq("sql_node_DCd1hold", "D1: the organization's live Batch rows (ANY item) holding a planned number (BATCH_HOLDERS, utf8mb4_general_ci)", "holders"),
            code(D1D, "D1 decide: a number held by another row -> FAILED IDA_BATCH_DUPLICATE; else the intent, the configs forward only, the planned rows without ours",
                 ccode("d1_decide.js", (), ("_d1.js",)), CHK + ["intentRows", "needIntent", "bncRows", "needBnc", "insertSlices", "insertCount", "adoptCount", "needEngR", "needLabels",
                                                              "labelLine", "labelItem", "labelNumber"],
                 arrays=CHK_ARR + ("intentRows", "bncRows", "insertSlices"), objects=("insertCount", "adoptCount")),
            gate(ids, "cor_DCd1dlab", "A TYPED number taken: the LABELS part to word it?", D1D, "needLabels", [part("sql_node_DCd1dlab", "D1: the LABELS part (the line of the taken number)", "LABELS")]),
            code(D1W, "D1 decide's exit: a taken TYPED number worded with code_validate's line label; else unchanged", ccode("d1_word.js"), EXIT, arrays=EXIT_ARR),
            end_a("d1de", D1W, "IF a planned number is taken or a configuration is gone (FAILED)"),
            gate(ids, "cor_DCd1intent", "Intent to record (BEFORE any config / Batch write)?", D1D, "needIntent", [
                step_add(ids, "add_node_DCd1intent", "D1 INTENT: D1|I|<nnn> = the generated numbers + the configs before / after (unique job / step)", D1D, "intentRows")]),
            gate(ids, "cor_DCd1cfg", "Configurations to advance (forward only)?", D1D, "needBnc", [
                K.update(ids, "update_node_DCd1cfg", "D1 WRITE: batch_number_config running_number / last_reset_date (the after-state, absolute)", BNC, ("id", "in", N(D1D, "data.bncRows.id")),
                         [(p, N(D1D, "data.bncRows." + p)) for p in ["id", "running_number", "last_reset_date"]])]),
            V.slice_loop(ids, "DC", "d1i", D1D, "insertSlices", "D1 WRITE: the planned Batch rows (ADD_INVENTORY's add_node_F9KqZLfd columns)", BATCH, BATCH_COLS, slice_js, add=True),
            br("d1back", [("Intent", K.sql("sql_node_DCd1intentB", "D1 read-back: the D1|I| intent", S["intent"], CSQL.INTENT_COLS)),
                          ("Configs", sq("sql_node_DCd1bncB", "D1 read-back: the batch_number_config rows", "bnc")),
                          ("Holders", sq("sql_node_DCd1holdB", "D1 read-back: every live org Batch row holding a planned number (ours + the post-insert re-check)", "holders")),
                          ("ENGINE_R part", gate(ids, "cor_DCd1engr", "A planned row inserts: the receipt to re-PLAN?", D1D, "needEngR", [
                              part("sql_node_DCd1engr", "D1: the ENGINE_R part (the receipts + alloc, to re-PLAN with the batch ids)", "ENGINE_R")]))]),
            code(D1C, "D1 check: ours read back (none twice), configs at their after-state, no other holder of our numbers -> the re-PLAN of op 2 with the batch ids; else retry / FAILED",
                 ccode("d1_check.js", (), ("_d1.js",)), CHK + ["ours", "needPlan", "planKey", "planMovements", "keys", "planCount"],
                 arrays=CHK_ARR + ("ours", "planMovements", "keys"), objects=("planCount",)),
            end_a("d1ck", D1C, "IF the Batch rows did not read back cleanly (retry / FAILED)"),
            gate(ids, "cor_DCd1plan", "Receipt re-PLAN to run?", D1C, "needPlan", [
                engine("workflow_node_DCd1plan", "INVENTORY_BULK_APPLY PLAN of the receipts (IDC|<job>|R, our batch ids, unit_price 0; writes nothing)", D1C, "PLAN", "planKey", "planMovements")]),
            code(D1A, "D1: the re-PLAN's answer (every R 200? the LABELS part to word a refusal?)", ccode("d1_ans.js"),
                 ["code", "result_code", "message", "allOk", "refusedKey", "refusedCode", "refusedMessage", "needLabels"]),
            gate(ids, "cor_DCd1lab", "A refusal: the LABELS part to read?", D1A, "needLabels", [part("sql_node_DCd1labels", "D1: the LABELS part (movement_key -> line, item, bin)", "LABELS")]),
            code(D1, "D1 BATCH: re-PLAN 200 + every R 200 -> DONE; a refusal -> FAILED + back to Draft + our Batch rows soft-deleted", ccode("d1.js", ("movekey",)),
                 CHK + ["resetRows", "needReset"], arrays=CHK_ARR + ("resetRows",)),
            end_a("d1", D1, "IF the receipts would be refused (FAILED)"),
            V.step_done(ids, "DC", "d1", D1, "D1_BATCH"),
            gate(ids, "cor_DCd1reset", "D1 DONE after renumber tries / retries: the attempt count back to 0?", D1, "needReset", [
                job_update(ids, "update_node_DCd1reset", "Job: attempt_count 0 (D2's lock waits start fresh; the lease kept)", D1, "resetRows", ["id", "attempt_count"])]),
        ]),
        # ---------------------------------------------------------------- D2
        K.if_(ids, "if_DCd2", "IF D2 ISSUE is due (phase A ends here: SPLIT / PARK)", is_(CE, "needD2", "YES"), [
            part("sql_node_DCd2part", "D2: the ENGINE_I part (one SUBTRACT per source pick)", "ENGINE_I"),
            code(D2I, "D2: the operation key and the movements", ccode("d2_in.js"), ["ok", "operationKey", "movements", "keys", "count", "why"], arrays=("movements", "keys"), objects=("count",)),
            gate(ids, "cor_DCd2call", "Source to issue?", D2I, "ok", [
                engine("workflow_node_DCd2", "INVENTORY_BULK_APPLY APPLY op 1 (IDC|<job>|I; all-or-nothing, replayed on a re-run)", D2I, "APPLY", "operationKey", "movements")]),
            code(D2A, "D2: op 1's answer (409 / none: read its intent rows; 400: read the LABELS part)", ccode("d2_ans.js"), ["code", "result_code", "message", "summary", "need409", "need400"],
                 objects=("summary",)),
            gate(ids, "cor_DCd2ops", "409 / no answer: op 1's intent rows to count?", D2A, "need409", [
                sq("sql_node_DCd2ops", "D2: op 1's engine rows (intents: any = it may have written)", "op1", CSQL.SH.OP_STATE_COLS)]),
            gate(ids, "cor_DCd2lab", "400: the LABELS part to read?", D2A, "need400", [part("sql_node_DCd2labels", "D2: the LABELS part (movement_key -> source pick, bin)", "LABELS")]),
            code(D2, "D2 check: 200 -> DONE + SPLIT or PARK; 409 -> wait, then FAILED (retry with intent rows); 400 -> FAILED (mapped); else review", ccode("d2.js", ("movekey",)),
                 CHK + ["splitRows", "needSplit", "path"], arrays=CHK_ARR + ("splitRows",)),
            end_a("d2", D2, "IF the item being disassembled was not issued", "fresh"),
            V.step_done(ids, "DC", "d2", D2, "D2_ISSUE"),
            gate(ids, "cor_DCsplit", "SPLIT / PARK hand-over to write?", D2, "needSplit", [
                job_update(ids, "update_node_DCsplit", "Job: SPLIT| hand-over lease (the worker calls phase B now) or PARK (due now, no lease: the next tick); progress 75, attempt_count 0",
                           D2, "splitRows")]),
        ] + cres("split", D2, "SPLIT")),
        # ---------------------------------------------------------------- D3
        K.if_(ids, "if_DCd3", "IF D3 RECEIPT is due (op 2: every recovered component, priced from op 1's stored rows)", is_(CE, "needD3", "YES"), [
            # op 1's engine rows and the D1 intent come from the entry's read of this pass (nothing writes them in phase B)
            br("d3read", [("ENGINE_R part", part("sql_node_DCd3engr", "D3: the ENGINE_R part (the receipts + alloc)", "ENGINE_R")),
                          ("OUT totals", sq("sql_node_DCd3out", "D3: op 1's stored OUT rows, counted and summed (OUT_TOTALS: id > job, operation_effect_key IDC|<job>|I|%)", "out", ["n", "total"])),
                          ("BATCH part", gate(ids, "cor_DCd3part", "Batch rows planned?", CE, "needBatchRead", [part("sql_node_DCd3part", "D3: the BATCH part (the planned Batch rows)", "BATCH")])),
                          ("Ours", gate(ids, "cor_DCd3ours", "Batch rows planned?", CE, "needBatchRead", [
                              sq("sql_node_DCd3ours", "D3: the Batch rows this job inserted (BATCH_OURS: id > job, the IDA's number)", "ours")]))]),
            code(D3P, "D3 plan: op 1 DONE, no review, stored rows = its code-200 results; idaAllocate over every recovery line; batch_id = ours", ccode("d3_plan.js", ("price",)),
                 CHK + ["needCall", "operationKey", "movements", "keys", "moveCount", "issued", "outCount", "outTotal"], arrays=CHK_ARR + ("movements", "keys"),
                 objects=("moveCount", "outCount")),
            end_b("d3pl", D3P, "IF op 2 may not start (REQUIRES_REVIEW)"),
            gate(ids, "cor_DCd3call", "Receipts to apply?", D3P, "needCall", [
                engine("workflow_node_DCd3", "INVENTORY_BULK_APPLY APPLY op 2 (IDC|<job>|R: every receipt at its allocated price; the same request on every retry)", D3P, "APPLY",
                       "operationKey", "movements")]),
            code(D3A, "D3: op 2's answer (every R 200 or a tolerated 401 skip? transient -> read op 2's intent rows)", ccode("d3_ans.js"),
                 ["code", "result_code", "message", "allOk", "skipped", "refusedKey", "refusedCode", "refusedMessage", "needOps"], arrays=("skipped",)),
            gate(ids, "cor_DCd3ops", "Transient: op 2's intent rows to read?", D3A, "needOps", [
                sq("sql_node_DCd3ops", "D3: op 2's engine rows (intents, IBA|REVIEW, the IBA|DONE summary)", "op2", CSQL.SH.OP_STATE_COLS)]),
            code(D3, "D3 check: 200 + every R 200 (a 401 skip tolerated, named) -> DONE + progress 80; transient -> wait 10 s until 30 min after the first one, then review; else review",
                 ccode("d3.js"), CHK + ["progressRows", "needProgress", "skipNote"], arrays=CHK_ARR + ("progressRows",)),
            end_b("d3", D3, "IF the recovered components were not received"),
            V.step_done(ids, "DC", "d3", D3, "D3_RECEIPT"),
            gate(ids, "cor_DCd3prog", "Progress 80 to write (both operations moved stock)?", D3, "needProgress", [
                job_update(ids, "update_node_DCd3prog", "Job: progress 80 'Components received; finishing' (lease kept)", D3, "progressRows", ["id", "progress_percent", "progress_message"])]),
        ]),
        # ---------------------------------------------------------------- D4
        K.if_(ids, "if_DCd4", "IF D4 FINISH is due", is_(CE, "needD4", "YES"), [
            br("d4read", [("ITEMS part", part("sql_node_DCd4items", "D4: the ITEMS part (the source item + every recovery item)", "ITEMS")),
                          ("Owner", K.sql("sql_node_DCd4own", "D4: the Item Disassembly's status, job link and latest lock now (OWNER)", S["owner"], CSQL.SH.OWNER_COLS)),
                          ("Lines", gate(ids, "cor_DCd4lines", "Batch rows planned?", CE, "needBatchRead", [sq("sql_node_DCd4lines", "D4: the stored lines' batch numbers (LINES_BATCH)", "linesbatch")])),
                          ("BATCH part", gate(ids, "cor_DCd4part", "Batch rows planned?", CE, "needBatchRead", [part("sql_node_DCd4part", "D4: the BATCH part (the AUTO rows' lines)", "BATCH")]))]),
            code(D4P, "D4 plan: Completed + numbered -> done; Processing under this job -> AUTO numbers, Item dates, then the header Completed / Unposted; else review",
                 d4("commitD4Plan(%s, [%s][0], [%s][0], [%s][0], [%s][0], [%s][0], [%s][0])" % (E, N("sql_node_DCd4items", "data"), N("sql_node_DCd4own", "data"),
                                                                                             N("sql_node_DCd4lines", "data"), N("sql_node_DCd4part", "data"), N("sql_node_DCintent", "data"),
                                                                                             N(D3, "data.skipNote"))),
                 CHK + ["lineSlices", "lineCount", "itemSlices", "itemCount", "statusRows", "needStatus", "targets", "needLines"],
                 arrays=CHK_ARR + ("lineSlices", "itemSlices", "statusRows", "targets"), objects=("lineCount", "itemCount")),
            end_b("d4pl", D4P, "IF the Item Disassembly cannot be finished"),
            V.slice_loop(ids, "DC", "d4l", D4P, "lineSlices", "D4 WRITE: the generated numbers into the AUTO lines' batch_number (the line collection)", LINE_TABLE, ["batch_number"], slice_js),
            V.slice_loop(ids, "DC", "d4i", D4P, "itemSlices", "D4 WRITE: Item last_transaction_date (code_item_txn's value)", ITEM, ["last_transaction_date"], slice_js),
            gate(ids, "cor_DCd4status", "Completed to write?", D4P, "needStatus", [
                K.update(ids, "update_node_DCd4status", "D4 WRITE: item_disassembly_status Completed, posted_status Unposted - the Processing lock ends", IDA_TABLE,
                         ("id", "in", N(D4P, "data.statusRows.id")), [(p, N(D4P, "data.statusRows." + p)) for p in ["id", "item_disassembly_status", "posted_status"]], labels=IDA_LABELS)]),
            br("d4back", [("Owner", K.sql("sql_node_DCd4back", "D4 read-back: the Item Disassembly (OWNER)", S["owner"], CSQL.SH.OWNER_COLS)),
                          ("Lines", gate(ids, "cor_DCd4linesB", "AUTO lines to verify?", D4P, "needLines", [
                              sq("sql_node_DCd4linesB", "D4 read-back: the stored lines' batch numbers (LINES_BATCH)", "linesbatch")]))]),
            code(D4C, "D4 check: Completed under this job, every AUTO line numbered -> DONE", d4("commitD4Check(%s, [%s][0], [%s][0], [%s][0], [%s][0])" % (
                E, N(D4P, "data"), N("sql_node_DCd4back", "data"), N("sql_node_DCd4linesB", "data"), N(D3, "data.skipNote"))), CHK, arrays=CHK_ARR),
            end_b("d4", D4C, "IF D4 did not complete"),
            V.step_done(ids, "DC", "d4", D4C, "D4_FINISH"),
        ]),
        # ---------------------------------------------------------------- finish
        code(FIN, "FINISH: the job COMPLETED (D4's status write was the unlock)", ccode("finish.js"), ["jobRows", "result_message", "job_status"], arrays=("jobRows",)),
        job_update(ids, "update_node_DCdone", "Job COMPLETED (lease released)", FIN, "jobRows"),
    ] + cres("done", FIN, "DONE")
    doc = K.workflow([("job_id", "string", "gd_async_job.id (digits) of a COMPLETE_IDA job (READY_TO_COMMIT, or COMMITTING_IDA to resume)")], RES, nodes)
    text = json.dumps(doc, ensure_ascii=False)
    left = re.findall(r"__[A-Z]+__", text)
    assert not left, left
    # nothing of the templates is left (code/shared's provenance comments may name them)
    stale = [w for w in ("COMPLETE_IA\\\"", "\\\"COMMITTING_IA\\\"", "IAC|", "sm_item_assembly", "item_assembly_status", "ia_v2_job_id\\\"", "IA_TEXT", "\\\"IA_", "COMMITTING_GR", "GRC|",
                         "\\\"GRC_", "Goods Receiving", "gr_status", "COMMITTING_SA", "I0_REVALIDATE", "I1|I|") if w in text]
    assert not stale, stale
    return doc


BUILDERS = [("IDA_V2_COMMIT", build)]

if __name__ == "__main__":
    V.build(BUILDERS, OUT, "--write" in sys.argv)
