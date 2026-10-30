"""LOT_V2_SUBMIT (CONTRACT.md section 7): the synchronous entry of the web form and list - operations SUBMIT and STATUS.
Copied from GR V2's GR_COMPLETE_SUBMIT (scratchpad/grv2/build_grv2.py build_submit) and Putaway V2's PUTAWAY_ASYNC_SUBMIT:
guard -> facts -> entry (STATUS / BUSY / STALE / action) -> keys -> the reads in parallel -> gate (eligibility, the classic's
gates lifted, WA, limits) -> post -> DRAFT (no job) or the queue writes in GR V2's idempotent order -> read-back -> due.

Document writes are the classic v82 nodes, copied and retargeted (values from the gate's filled-back allData):
DRAFT Add add_node_5E9es34x (+ lot_idem_key), DRAFT Edit update_node_WKLUE7ka, DIRECT / STAGE Add add_node_xxQX3uMU, a stored
Draft update_node_0rtpXydw (without stock_movement_no / _no_type when an earlier SAVE_LOT job issued its number); status
'Processing' (Draft for DRAFT) + lot_v2_job_id. COMPLETE / EDIT / CANCEL write the header status + lot_v2_job_id only."""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, os.path.join(HERE, "submit"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402
from v2build import N, JOB, STEP, JOB_ADD_COLS, PART_COLS, sub, gate, step_add, job_update  # noqa: E402
import submit_sql as Q  # noqa: E402

LOT = "Location Transfer:Table:2013791389687349250"
BASE = os.path.join(HERE, "base", "SM_LOCATION_TRANSFER.v82.json")
SUB_RES = ["route", "code", "message", "reason", "action", "job_id", "job_status", "terminal", "lot_id", "lot_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "evidence"]
G, E, KY, GT, PO, RW, LK = ("code_node_LSguard", "code_node_LSentry", "code_node_LSkeys", "code_node_LSgate", "code_node_LSpost", "code_node_LSrow", "code_node_LSlink")
SHARED = ["shared/lot_common.js", "shared/fingerprint.js"]


def inc(path):
    return V.include_js(os.path.join(HERE, "code"), path)


# the IA transfer request's rules (scratchpad/iatr/code/shared/iatr_rules.js): the entry's and keys' request decisions, the dispatch check
IATR_RULES = os.path.join(HERE, "..", "iatr", "code")
IATR_NODES = ("entry.js", "keys.js", "iatr.js")


def scode(name):
    """a code node's script: the shared helpers it needs (fingerprint.js only where lines are fingerprinted), _common.js, the file"""
    shared = SHARED if name in ("link.js",) else SHARED[:1]
    rules = [V.include_js(IATR_RULES, "shared/iatr_rules.js")] if name in IATR_NODES else []
    # reserved requests (iatr_reserve.js): the request check only
    rules += [V.include_js(IATR_RULES, "shared/iatr_reserve.js")] if name == "iatr.js" else []
    return "\n".join([inc(p) for p in shared] + rules + [K.js("submit/_common.js"), K.js("submit/" + name)])


def gate_code():
    lifted = V.raw(os.path.join(HERE, "submit"), "lifted_submit.js")
    assert "{{" not in lifted, "a lifted body still holds a platform token"
    return "\n".join([V.raw(os.path.join(HERE, "lib", "lift"), "runtime.js"), lifted] + [inc(p) for p in SHARED]
                     + [K.js("submit/_common.js"), K.js("submit/gate.js"), K.js("submit/gate_tail.js")])


def classic_nodes():
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str) and "type" in n:
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(json.load(open(BASE, encoding="utf-8")))
    return out


def retarget(old, nid, title, status, where=None, drop=(), extra=()):
    """a classic v82 add / update node with its values read from the gate's filled-back allData; status a literal"""
    n = copy.deepcopy(old)
    n["id"] = nid
    n["data"].update({"title": title, "nodeName": title, "name": title})
    keep = []
    for p in n["data"]["props"]["list"]:
        if p["prop"] in drop:
            continue
        if p["prop"] == "stock_movement_status":
            assert p["value"] == "{{workflowparams:saveAs}}", (nid, p)
            p.update({"valueType": "value", "value": status})
        else:
            want = "{{node:code_node_yPlLXIZW.data.allData.%s}}" % p["prop"]
            assert p["valueType"] == "field" and p["value"] == want, (nid, p)
            p["value"] = N(GT, "data.allData." + p["prop"])
        keep.append(p)
    for prop, value in extra:
        keep.append({"prop": prop, "operator": "", "valueType": "field", "value": value, "valueLabel": "", "propLabel": prop})
    n["data"]["props"]["list"] = keep
    if where is not None:
        leaf = n["data"]["table_id"]["rules"]["list"][0]
        assert leaf["prop"] == "id" and leaf["value"] == "{{node:code_node_yPlLXIZW.data.allData.id}}", (nid, leaf)
        leaf["value"] = where
    return n


def build():
    ids = K.Ids(1797700000000)
    old = classic_nodes()
    T = N(G, "data.tenantId")
    KEY = N(G, "data.key")
    facts = Q.facts(sub, T, N(G, "data.lotId"), KEY, N(G, "data.draftAdd"))
    items = Q.items(sub, T, N(KY, "data.itemIdsSql"), N(KY, "data.storedLotId"))
    cost = Q.cost(sub, T, N(KY, "data.itemIdsSql"), N(KY, "data.storedLotId"), N(KY, "data.plantId"), N(KY, "data.organizationId"))
    stored = Q.stored(sub, T, N(KY, "data.storedLotId"), N(KY, "data.needStored"))
    iatr = Q.iatr(sub, T, N(G, "data.lotId"), N(KY, "data.iatrIaId"), N(KY, "data.needIatr"), N(KY, "data.iatrMode"), N(KY, "data.organizationId"))
    hdr = sub(Q.HDR_BY_JOB, T=T, JOB=N(RW, "data.jobId"), NEED=N(KY, "data.needAfter"))
    lines = Q.lines_by_job(sub, T, N(RW, "data.jobId"), N(KY, "data.needAfter"))
    dup = sub(Q.DRAFT_DUP, T=T, KEY=KEY)
    back = sub(Q.BACK, T=T, KEY=KEY)
    gate_small = ("{ route: [%s][0], code: [%s][0], message: [%s][0], reason: [%s][0], errorCode: [%s][0], lineCount: [%s][0] }"
                  % tuple(N(GT, "data." + f) for f in ("route", "code", "message", "reason", "errorCode", "lineCount")))

    def sres(tag, title, src, back_node=None, with_post=False):
        guard = "[%s][0]" % N(G, "data")
        entry = "null" if tag == "rej" else "[%s][0]" % N(E, "data")
        call_ = "submitResult(%s, %s, %s, %s, %s)" % (guard, entry, src, "[%s][0]" % N(back_node, "data") if back_node else "null",
                                                      "[%s][0]" % N(PO, "data") if with_post else "null")
        body = scode("result.js") + ("\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, "
                                     "action: res.action, job: res.job_id }));\nreturn res;" % call_)
        return [K.code("code_node_LS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_LS%s" % tag, "Return (%s)" % title, [(f, N("code_node_LS%sres" % tag, "data." + f)) for f in SUB_RES])]

    entry_fields = ["route", "code", "message", "reason", "errorCode", "action", "prevStatus", "tenantId", "lotId", "lotNo", "storedStatus", "organizationId", "plantId", "noType",
                    "movementType", "issueDate", "isProductionOrder", "lineCount", "dbNow", "lockN", "issuedReuse", "jobId", "jobStatus", "jobAction", "progressPercent",
                    "progressMessage", "jobErrorCode", "errorMessage", "purpose", "sourceIaId", "sourceIaFp"]
    keys_fields = ["route", "code", "message", "reason", "errorCode", "ok", "why", "itemIdsSql", "storedLotId", "needStored", "needAfter", "plantId", "organizationId",
                   "lineCount", "needIatr", "iatrIaId", "iatrMode"]
    gate_fields = ["route", "code", "message", "reason", "errorCode", "allData", "lineCount", "rowCount", "movementCount", "numberIssued", "lineFingerprint",
                   "incomingFingerprint", "edited", "partNames", "partChunks"]
    post_fields = ["route", "code", "message", "errorCode", "request", "isAdd", "numberProps", "idemStore", "partCount", "lockRows", "needLock", "jobRows"]
    reads = [("cai_LSitems", "items", [K.sql("sql_node_LSitems", "Items of the lines (serial, costing method, stock control, code)", items, ["j"])]),
             ("cai_LScost", "cost", [K.sql("sql_node_LScost", "Costing rows of those items at the plant: WA / FIFO counts per (material, batch)", cost, ["j"])]),
             ("cai_LSstored", "stored", [K.sql("sql_node_LSstored", "The stored lines before the writes (COMPLETE / EDIT / CANCEL; FP_LINES' columns + HU / serial)", stored,
                                               ["j"])]),
             ("cai_LSiatr", "iatr", [K.sql("sql_node_LSiatr", "IA transfer request dispatch: its stored lines, its Item Assembly's status, lines and items", iatr,
                                           ["j"])])]
    after = [("cai_LShdr", "header", [K.sql("sql_node_LShdr", "Read-back: the Location Transfer this job wrote (lot_v2_job_id; DIRECT / STAGE)", hdr, Q.HDR_COLS)]),
             ("cai_LSlines", "lines", [K.sql("sql_node_LSlines", "Read-back: its lines (FP_LINES; DIRECT / STAGE)", lines, ["j"])])]

    lot_add = retarget(old["add_node_xxQX3uMU"], "add_node_LSlot", "Location Transfer + lines (add_node_xxQX3uMU's props; Processing; lot_v2_job_id)", "Processing",
                       extra=[("lot_v2_job_id", N(RW, "data.jobId"))])
    lot_num = retarget(old["update_node_0rtpXydw"], "update_node_LSlotNum", "Location Transfer + lines (update_node_0rtpXydw's props; Processing; lot_v2_job_id)",
                       "Processing", where=N(G, "data.lotId"), extra=[("lot_v2_job_id", N(RW, "data.jobId"))])
    lot_nonum = retarget(old["update_node_0rtpXydw"], "update_node_LSlotNoNum",
                         "Location Transfer + lines (update_node_0rtpXydw's props without the number: issued by an earlier save; Processing; lot_v2_job_id)",
                         "Processing", where=N(G, "data.lotId"), drop=("stock_movement_no", "stock_movement_no_type"), extra=[("lot_v2_job_id", N(RW, "data.jobId"))])
    assert len(lot_add["data"]["props"]["list"]) == 20 and len(lot_num["data"]["props"]["list"]) == 20 and len(lot_nonum["data"]["props"]["list"]) == 18
    lot_status = K.update(ids, "update_node_LSlotStatus", "Location Transfer: Processing + lot_v2_job_id only (COMPLETE / EDIT / CANCEL)", LOT,
                          ("id", "in", N(G, "data.lotId")), [("stock_movement_status", "Processing"), ("lot_v2_job_id", N(RW, "data.jobId"))],
                          labels={"stock_movement_status": "Stock Movement Status"})
    lot_status["data"]["props"]["list"][0]["valueType"] = "value"
    draft_add = retarget(old["add_node_5E9es34x"], "add_node_LSdraftAdd", "Location Transfer Draft + lines (add_node_5E9es34x's props; lot_idem_key)", "Draft",
                         extra=[("lot_idem_key", N(PO, "data.idemStore"))])
    draft_upd = retarget(old["update_node_WKLUE7ka"], "update_node_LSdraftUpd", "Location Transfer Draft + lines (update_node_WKLUE7ka's props)", "Draft",
                         where=N(G, "data.lotId"))
    lose = K.update(ids, "update_node_LSdraftLose", "Remove this twin Draft (an older save of this key won)", LOT, ("id", "in", N("code_node_LSdraftDup", "data.mine")),
                    [("is_deleted", 1)], labels={"is_deleted": "删除状态"})
    lose["data"]["props"]["list"][0]["valueType"] = "value"

    nodes = [
        K.code(G, "Guard: operation, saveAs, pageStatus (Clone = Add), lot_id, idempotency key, source, session tenant + user", scode("guard.js"),
               ["route", "code", "message", "errorCode", "operation", "saveAs", "pageStatus", "pageStatusIn", "lotId", "key", "tenantId", "uid", "source", "nonce", "clone",
                "draftAdd"]),
        K.if_(ids, "if_LSreject", "IF the request is invalid: answer, write nothing", V.is_(G, "route", "REJECT"), sres("rej", "invalid request", "[%s][0]" % N(G, "data"))),
        K.sql("sql_node_LSfacts", "Facts: the job of this key, a Draft Add's LOT of this key, the stored LOT, its lines / lock / open + latest SAVE_LOT jobs, DB clock", facts,
              Q.FACTS_COLS),
        K.code(E, "Entry: STATUS / this key's job; else the stored status decides (BUSY / STALE / STOP) and the action", scode("entry.js"), entry_fields,
               objects=("isProductionOrder", "lineCount", "lockN", "progressPercent")),
        K.if_(ids, "if_LSanswer", "IF answered here (STATUS / SAVED / BUSY / STALE / STOP / NOT_ELIGIBLE): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"),
              sres("ans", "entry", "[%s][0]" % N(E, "data"))),
        K.code(KY, "Keys: the form (INVALID if none), its lines' eligibility, the reads' digit-only ids", scode("keys.js"), keys_fields, objects=("lineCount",)),
        K.if_(ids, "if_LSkeysEnd", "IF the keys answered (INVALID / NOT_ELIGIBLE / STOP): answer, read nothing, write nothing", "'%s' != 'GO'" % N(KY, "data.route"),
              sres("keys", "keys", "[%s][0]" % N(KY, "data"))),
        K.parallel("condition_all_LSread", "The gate's reads in parallel (no row limits)", reads),
        K.code(GT, "Gate: eligibility, lines added, SM_LOCATION_TRANSFER v82's gates (lifted), WA, limits -> the filled-back record / the S|..|LINES part", gate_code(),
               gate_fields, arrays=("partNames", "partChunks"), objects=("allData", "lineCount", "rowCount", "movementCount", "edited")),
        K.if_(ids, "if_LSgateEnd", "IF the gate answered (NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"),
              sres("gate", "gate", gate_small)),
        K.code("code_node_LSiatr", "IA transfer request: a dispatch only fully picked, unchanged and still asked for (a Created IA's: its reservation as requested); "
               "a receipt only unedited (a Created IA's: its receipts -> the RECEIPTS part)", scode("iatr.js"),
               ["route", "code", "message", "errorCode", "partNames", "partChunks"], arrays=("partNames", "partChunks")),
        K.if_(ids, "if_LSiatrEnd", "IF the request check answered (STOP): answer, write nothing", "'%s' != 'GO'" % N("code_node_LSiatr", "data.route"),
              sres("iatr", "transfer request", "[%s][0]" % N("code_node_LSiatr", "data"))),
        K.code(PO, "Post: DRAFT, or the queue rows (lock for Edit, the SAVE_LOT job QUEUED 2 minutes ahead, the request)", scode("post.js"), post_fields,
               arrays=("lockRows", "jobRows"), objects=("partCount",)),
        K.if_(ids, "if_LSpostEnd", "IF nothing to write: answer", "'%s' != 'QUEUE' && '%s' != 'DRAFT'" % (N(PO, "data.route"), N(PO, "data.route")),
              sres("post", "post", "[%s][0]" % N(PO, "data"))),
        K.if_(ids, "if_LSdraft", "IF DRAFT: the whole document as Draft, no job", V.is_(PO, "route", "DRAFT"), [
            K.if_(ids, "if_LSdraftAdd", "IF Add / Clone: insert, then the twin read-back", V.is_(PO, "isAdd", "YES"), [
                draft_add,
                K.sql("sql_node_LSdraftDup", "The Drafts saved with this key (oldest first)", dup, Q.DRAFT_DUP_COLS),
                K.code("code_node_LSdraftDup", "Twin? the oldest wins; this run's own row is removed when it lost", scode("draft.js"),
                       ["route", "code", "message", "errorCode", "lose", "mine", "lotId", "lotNo"]),
                gate(ids, "cor_LSdraftLose", "A twin saved it first?", "code_node_LSdraftDup", "lose", [lose]),
            ] + sres("draftAdd", "Draft saved", "[%s][0]" % N("code_node_LSdraftDup", "data")), [
                draft_upd,
            ] + sres("draftUpd", "Draft saved", "{ route: \"SAVED\", code: \"200\", message: \"Location Transfer saved successfully\" }")),
        ]),
        gate(ids, "cor_LSlock", "Edit: the LOT's lock to take?", PO, "needLock", [
            step_add(ids, "add_node_LSlock", "LOCK: gd_publish_step SMLT|<lot> / LOCK|<n> (unique tenant / job / step: a concurrent submit fails its run)", PO, "lockRows")]),
        K.add(ids, "add_node_LSjob", "Job insert: SAVE_LOT QUEUED, due in 2 minutes (unique idempotency key: a twin click fails its run)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in JOB_ADD_COLS], labels={"organization_id": "Organization"}),
        K.code(RW, "Row: the new job's id, the S parts with it, which document write runs", scode("row.js"),
               ["ok", "jobId", "partRows", "needParts", "writeAdd", "writeNumber", "writeNoNumber", "writeStatus"], arrays=("partRows",)),
        gate(ids, "cor_LSparts", "COMPLETE / EDIT: the S|<nonce>|LINES parts to write?", RW, "needParts", [
            K.add(ids, "add_node_LSparts", "S|<nonce>|LINES|<nnn> payload parts (what L2 writes)", STEP, [(p, N(RW, "data.partRows." + p)) for p in PART_COLS],
                  labels={"organization_id": "Organization"})]),
        gate(ids, "cor_LSadd", "DIRECT / STAGE Add: insert the Location Transfer?", RW, "writeAdd", [lot_add]),
        gate(ids, "cor_LSnum", "DIRECT / STAGE of a Draft: update with the number?", RW, "writeNumber", [lot_num]),
        gate(ids, "cor_LSnonum", "DIRECT / STAGE of a Draft whose number a failed job issued: update without it?", RW, "writeNoNumber", [lot_nonum]),
        gate(ids, "cor_LSstatus", "COMPLETE / EDIT / CANCEL: header Processing + job?", RW, "writeStatus", [lot_status]),
        K.parallel("condition_all_LSafter", "Read-back after the document write (DIRECT / STAGE) in parallel", after),
        K.code(LK, "Link: lotId, lotNo, issuedNo, lineFingerprint into the request (DIRECT / STAGE); an Add's LOCK|1", scode("link.js"),
               ["ok", "why", "lotId", "lotNo", "request", "needLink", "needLock", "lockRows", "jobRows"], arrays=("lockRows", "jobRows")),
        gate(ids, "cor_LSlock1", "Add: the new LOT's lock LOCK|1?", LK, "needLock", [
            step_add(ids, "add_node_LSlock1", "LOCK: gd_publish_step SMLT|<lot> / LOCK|1", LK, "lockRows")]),
        gate(ids, "cor_LSlink", "DIRECT / STAGE: the job's correlation / causation / request?", LK, "needLink", [
            job_update(ids, "update_node_LSlink", "Job: correlation LOT|<lot>, causation, request (lotId, lotNo, issuedNo, lineFingerprint)", LK, "jobRows",
                       ["id", "correlation_id", "causation_id", "request_payload"])]),
        K.sql("sql_node_LSback", "Read-back: the job of this key, its LOT's status / job link, the LOT's latest lock, the S parts", back, Q.BACK_COLS),
        K.code("code_node_LSdue", "Due: the LOT is Processing under this job's lock (and its parts are there) -> the job due now", scode("due.js"), ["dueRows", "needDue"],
               arrays=("dueRows",)),
        gate(ids, "cor_LSdue", "Job to make due?", "code_node_LSdue", "needDue", [
            K.update(ids, "update_node_LSdue", "Job due now (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_LSdue", "data.dueRows.id")),
                     [("id", N("code_node_LSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_LSdue", "data.dueRows.next_attempt_at"))])]),
    ] + sres("done", "queued", "[%s][0]" % N(PO, "data"), "sql_node_LSback", True)
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"), ("saveAs", "string", "Draft | In Progress | Completed | Cancelled (SUBMIT)"),
                       ("pageStatus", "string", "Add | Edit | Clone (Copy = Clone): the form's page_status; the list's Cancel sends Edit"),
                       ("lot_id", "string", "sm_location_transfer.id (digits) for Edit, Cancel and STATUS; empty for Add / Clone"),
                       ("idempotency_key", "string", "one per click and content (8-128 chars A-Z a-z 0-9 | : _ . -); optional for STATUS"),
                       ("source", "string", "FORM (default) | LIST"),
                       ("min_lines", "string", "optional digits (else 0): a CANCEL whose stored flat lines are <= this answers NOT_ELIGIBLE (the list sends 50)"),
                       ("form", "any", "the form's record (this.getValues() minus the helper keys); the list's Cancel: { id, stock_movement_status, stock_movement_no, organization_id }")],
                      SUB_RES, nodes)


BUILDERS = [("LOT_V2_SUBMIT", build)]

if __name__ == "__main__":
    V.build(BUILDERS, os.path.join(HERE, "..", "..", "Stock Movement", "Location Transfer", "AsyncV2"), "--write" in sys.argv)
