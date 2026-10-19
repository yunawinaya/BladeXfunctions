"""IA_V2_SUBMIT (CONTRACT.md sections 2, 3, 4, 7): the synchronous entry of the Item Assembly form (and later mobile) -
operations SUBMIT and STATUS. Copied from tpl/sav2/build_submit.py (SA_V2_SUBMIT, itself LOT_V2_SUBMIT / GR V2's
GR_COMPLETE_SUBMIT) and made the IA's (IA| offset 4, IAC| lock, COMPLETE_IA, IA_ codes, prevStatus Draft only):

guard -> facts -> entry (the key's job / STATUS / BUSY / STALE / the action) -> keys (the record, the lifted code_fillback +
code_item_ids, the reads' inputs) -> the reads in parallel (ITEMS, costing, WA, duplicate balances) -> gate (eligibility, the
lifted code_required + CHECK_REQUIRED_FIELD v8 + code_validate v12, limits, WA, the GENERATE_BATCH pre-check) -> GENERATE_BATCH
(batch-managed system-numbered parent, organization_id passed) -> post -> a stored Draft's LOCK|n+1 -> the job (QUEUED, due in
120 s) -> ONE document write (the classic v11 add_ia / update_ia, retargeted: Processing, ia_v2_job_id, ia_idem_key, no
posted_status) -> read-back -> an Add's LOCK|1 + link -> the key's read-back -> due (+ the final request).

The lifted gates are submit/lifted_submit.js (lib/lift/lift.py submit/lift.json; code_validate from the BUILT IA_SAVE v12): the
build refuses a stale lift and a built IA_SAVE.json that is not classic/patch_v12.py's current output (one code_validate source).
Response keys come from a local seeded RNG after the build, so the output does not depend on the build order.

usage: python3 scratchpad/iav2/build_submit.py [--write]   (writes Item Assembly & BOM/AsyncV2/IA_V2_SUBMIT.json, indent 1)
"""
import sys
sys.dont_write_bytecode = True
import copy
import importlib.util
import json
import os
import random
import string

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402
from v2build import N, JOB, JOB_ADD_COLS, sub, gate, step_add, job_update  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


Q = _load("ia_submit_sql", os.path.join(HERE, "submit", "submit_sql.py"))
LIFT = _load("ia_submit_lift", os.path.join(HERE, "lib", "lift", "lift.py"))
CLASSIC = _load("ia_classic_patch_v12_for_submit", os.path.join(HERE, "classic", "patch_v12.py"))

IA = "Item Assembly:Table:2098256587713404929"
CODE = os.path.join(HERE, "code")
BASE = os.path.join(HERE, "base", "IA_SAVE.v11.json")
BUILT_SAVE = os.path.join(HERE, "..", "..", "Item Assembly & BOM", "AsyncV2", "IA_SAVE.json")
IDS = json.load(open(os.path.join(HERE, "ids.json"), encoding="utf-8"))
SUB_RES = ["route", "code", "message", "reason", "action", "job_id", "job_status", "terminal", "ia_id", "ia_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "evidence"]
G, E, KY, GT, PO, RW, LK = ("code_node_ISguard", "code_node_ISentry", "code_node_ISkeys", "code_node_ISgate", "code_node_ISpost", "code_node_ISrow", "code_node_ISlink")
KEY_SEED = 20261019
FILTER_BASE = 1798500000000


def inc(path):
    return V.include_js(CODE, path)


def scode(name, shared=("shared/ia_common.js",)):
    """a code node's script: the shared helpers it needs, submit/_common.js, the file"""
    return "\n".join([inc(p) for p in shared] + [K.js("submit/_common.js"), K.js("submit/" + name)])


def lifted():
    """submit/lifted_submit.js, refused when stale (lift.py --check) or when the built IA_SAVE.json is not patch_v12's output"""
    cfg = os.path.join(HERE, "submit", "lift.json")
    out, header, sources, rel_root = LIFT.load_config(cfg)
    text, _ = LIFT.build(sources, header, rel_root)
    have = open(out, encoding="utf-8").read() if os.path.exists(out) else ""
    if have != text:
        raise AssertionError("submit/lifted_submit.js is stale: python3 scratchpad/iav2/lib/lift/lift.py scratchpad/iav2/submit/lift.json")
    built = CLASSIC.index(json.load(open(BUILT_SAVE, encoding="utf-8")))[CLASSIC.FIXED_NODE]["data"]["script"]["code"]
    now = CLASSIC.index(CLASSIC.build())[CLASSIC.FIXED_NODE]["data"]["script"]["code"]
    assert built == now, "Item Assembly & BOM/AsyncV2/IA_SAVE.json is not classic/patch_v12.py's current output: rebuild it (build_classic.py --write)"
    assert "{{" not in text and "stock_control === 0" in text, "lifted_submit.js: code_validate is not v12's"
    return text


def lifted_code(*names):
    """the lift runtime + the lifted gates (global, once), ia_common, _common, _fill, then the files"""
    parts = [V.raw(os.path.join(HERE, "lib", "lift"), "runtime.js"), lifted(), inc("shared/ia_common.js"), K.js("submit/_common.js"), K.js("submit/_fill.js")]
    return "\n".join(parts + [K.js("submit/" + n) for n in names])


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


def retarget(old, nid, title, where=None, drop=(), extra=()):
    """a classic v11 add / update node with its values read from this workflow: allData from the gate, the batch number from
    post, the id from the guard; item_assembly_status the literal Processing; posted_status dropped (I4 writes it)"""
    n = copy.deepcopy(old)
    n["id"] = nid
    n["data"].update({"title": title, "nodeName": title, "name": title})
    keep = []
    for p in n["data"]["props"]["list"]:
        prop = p["prop"]
        if prop in drop or prop == "posted_status":
            continue
        if prop == "item_assembly_status":
            assert p["value"] == "{{node:code_fillback.data.allData.item_assembly_status}}", (nid, p)
            p.update({"valueType": "value", "value": "Processing"})
        elif prop == "batch_no":
            assert p["value"] == "{{node:code_batch_number.data.batchNumber}}", (nid, p)
            p["value"] = N(PO, "data.batchNo")
        elif prop == "id":
            assert p["value"] == "{{node:code_fillback.data.allData.id}}", (nid, p)
            p["value"] = N(G, "data.iaId")
        else:
            assert p["valueType"] == "field" and p["value"] == "{{node:code_fillback.data.allData.%s}}" % prop, (nid, p)
            p["value"] = N(GT, "data.allData." + prop)
        keep.append(p)
    for prop, value in extra:
        keep.append({"prop": prop, "valueType": "field", "value": value, "operator": "", "valueLabel": "", "propLabel": prop})
    n["data"]["props"]["list"] = keep
    if where is not None:
        leaf = n["data"]["table_id"]["rules"]["list"][0]
        assert leaf["prop"] == "id" and leaf["value"] == "{{node:code_fillback.data.allData.id}}", (nid, leaf)
        leaf["value"] = where
    return n


def rekey(doc):
    """every response / request key from a local seeded RNG (unique in the file), so the build order does not change the output"""
    rng = random.Random(KEY_SEED)
    taken = set()

    def key():
        while True:
            k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in taken and not k.isdigit():
                taken.add(k)
                return k

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("key"), str):
                n["key"] = key()
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return doc


def _build():
    ids = K.Ids(FILTER_BASE)
    old = classic_nodes()
    T = N(G, "data.tenantId")
    KEY = N(G, "data.key")
    JOBID = N(RW, "data.jobId")
    extras = [("ia_v2_job_id", JOBID), ("ia_idem_key", KEY)]
    ia_add = retarget(old["add_ia"], "add_node_ISia", "Item Assembly + lines (add_ia's props; Processing; ia_v2_job_id, ia_idem_key; no posted_status)", extra=extras)
    ia_num = retarget(old["update_ia"], "update_node_ISiaNum", "Item Assembly + lines (update_ia's props; Processing; ia_v2_job_id, ia_idem_key; no posted_status)",
                      where=N(G, "data.iaId"), extra=extras)
    ia_nonum = retarget(old["update_ia"], "update_node_ISiaNoNum",
                        "Item Assembly + lines (update_ia's props without the number: an earlier job issued it; Processing; ia_v2_job_id, ia_idem_key)",
                        where=N(G, "data.iaId"), drop=("stock_movement_no", "stock_movement_no_type"), extra=extras)
    assert [len(x["data"]["props"]["list"]) for x in (ia_add, ia_num, ia_nonum)] == [26, 27, 25]

    facts = Q.facts(sub, T, N(G, "data.iaId"), KEY, N(G, "data.organizationId"))
    items = Q.items(sub, T, N(KY, "data.itemIdsSql"))
    cost = Q.cost(sub, T, N(KY, "data.costPairsJson"), N(KY, "data.itemIdsSql"), N(KY, "data.plantId"), N(KY, "data.organizationId"))
    wa = Q.wa(sub, T, N(KY, "data.pickPairsJson"), N(KY, "data.plantId"), N(KY, "data.organizationId"))
    dup = Q.dup(sub, T, N(KY, "data.balTuplesJson"), N(KY, "data.batchTuplesJson"), N(KY, "data.itemIdsSql"), N(KY, "data.plantId"), N(KY, "data.organizationId"))
    hdr = Q.hdr_by_job(sub, T, JOBID)
    header = Q.header_by_job(sub, T, JOBID)
    lines = Q.lines_by_job(sub, T, JOBID)
    back = Q.back(sub, T, KEY)
    gate_small = ("{ route: [%s][0], code: [%s][0], message: [%s][0], reason: [%s][0], errorCode: [%s][0], lineCount: [%s][0] }"
                  % tuple(N(GT, "data." + f) for f in ("route", "code", "message", "reason", "errorCode", "lineCount")))

    def sres(tag, title, src, back_node=None):
        guard = "[%s][0]" % N(G, "data")
        entry = "null" if tag == "rej" else "[%s][0]" % N(E, "data")
        call_ = "submitResult(%s, %s, %s, %s)" % (guard, entry, src, "[%s][0]" % N(back_node, "data") if back_node else "null")
        body = scode("result.js") + ("\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, "
                                     "action: res.action, job: res.job_id }));\nreturn res;" % call_)
        return [K.code("code_node_IS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_IS%s" % tag, "Return (%s)" % title, [(f, N("code_node_IS%sres" % tag, "data." + f)) for f in SUB_RES])]

    guard_fields = ["route", "code", "message", "errorCode", "operation", "saveAs", "pageStatus", "pageStatusIn", "iaId", "key", "tenantId", "uid", "source", "nonce", "clone",
                    "organizationId"]
    entry_fields = ["route", "code", "message", "reason", "errorCode", "action", "prevStatus", "tenantId", "iaId", "iaNo", "storedStatus", "organizationId", "plantId", "noType",
                    "dbNow", "lockN", "issuedByJob", "completedUnder", "batchCfg", "jobId", "jobStatus", "jobAction", "progressPercent", "progressMessage", "jobErrorCode",
                    "errorMessage", "lineCount"]
    keys_fields = ["route", "code", "message", "reason", "errorCode", "ok", "why", "itemIdsSql", "pickPairsJson", "costPairsJson", "balTuplesJson", "batchTuplesJson", "plantId",
                   "organizationId", "lineCount", "pickCount"]
    gate_fields = ["route", "code", "message", "reason", "errorCode", "allData", "lineCount", "pickCount", "stockPickCount", "nonStockLines", "movementCount", "plantId",
                   "organizationId", "stockMovementNo", "needBatch", "batchItemId", "batchDocDate", "batchMfgDate", "batchExpDate", "batchOrg"]
    post_fields = ["route", "code", "message", "errorCode", "request", "isAdd", "numberProps", "numberIssued", "batchNo", "lineCount", "lockRows", "needLock", "jobRows"]
    reads = [("cai_ISitems", "items", [K.sql("sql_node_ISitems", "Items of the IA: parent + components (code/shared ITEMS: stock control, serial, batch rule, costing, UOMs)",
                                             items, ["j"])]),
             ("cai_IScost", "cost", [K.sql("sql_node_IScost", "Costing screen: stock picks + the parent with FIFO / WA rows waiting for migration (pwv2 SUBMIT_SQL cost)",
                                           cost, ["j"])]),
             ("cai_ISwa", "wa", [K.sql("sql_node_ISwa", "WA screen: Weighted Average stock picks without a wa_costing_method row (GLOBAL_INVENTORY_VALIDATION v11)", wa,
                                       ["j"])]),
             ("cai_ISdup", "dup", [K.sql("sql_node_ISdup", "Duplicate-balance screen: item_balance / item_batch_balance rows the engine would refuse (DUPLICATE_BALANCE)", dup,
                                         ["j"])])]
    after = [("cai_IShdr", "ia", [K.sql("sql_node_IShdr", "Read-back: the Item Assembly this job wrote (ia_v2_job_id)", hdr, Q.HDR_COLS)]),
             ("cai_ISheader", "header", [K.sql("sql_node_ISheader", "Read-back: its header (FP_HEADER)", header, ["j"])]),
             ("cai_ISlines", "lines", [K.sql("sql_node_ISlines", "Read-back: its component lines (FP_LINES)", lines, ["j"])])]
    batch_call = V.call(ids, "workflow_node_ISbatch", "Generate Batch (GENERATE_BATCH v20 as the classic wf_generate_batch + organization_id)",
                        ("GENERATE_BATCH", IDS["GENERATE_BATCH"]),
                        [("item_id", N(GT, "data.batchItemId")), ("document_date", N(GT, "data.batchDocDate")), ("manufacturing_date", N(GT, "data.batchMfgDate")),
                         ("expired_date", N(GT, "data.batchExpDate")), ("organization_id", N(GT, "data.batchOrg"))])

    nodes = [
        K.code(G, "Guard: operation, saveAs, pageStatus (Clone = Add), ia_id, idempotency key, source, the form's organization, session tenant + user", scode("guard.js"),
               guard_fields),
        K.if_(ids, "if_ISreject", "IF the request is invalid: answer, write nothing", V.is_(G, "route", "REJECT"), sres("rej", "invalid request", "[%s][0]" % N(G, "data"))),
        K.sql("sql_node_ISfacts", "Facts: this key's job; the stored IA, its lock, open / latest / linked jobs of either command, the number rule, the default batch config; DB clock",
              facts, Q.FACTS_COLS),
        K.code(E, "Entry: STATUS / this key's job; else the stored IA decides (BUSY / STALE / STOP / NOT_ELIGIBLE) and the action", scode("entry.js"), entry_fields,
               objects=("lockN", "issuedByJob", "completedUnder", "progressPercent", "lineCount")),
        K.if_(ids, "if_ISanswer", "IF answered here (STATUS / BUSY / STALE / STOP / NOT_ELIGIBLE): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"),
              sres("ans", "entry", "[%s][0]" % N(E, "data"))),
        K.code(KY, "Keys: the record (INVALID if none), the lifted code_fillback + code_item_ids, the reads' digit-only inputs", lifted_code("keys.js"), keys_fields,
               objects=("lineCount", "pickCount")),
        K.if_(ids, "if_ISkeysEnd", "IF the keys answered (INVALID / STOP): answer, read nothing, write nothing", "'%s' != 'GO'" % N(KY, "data.route"),
              sres("keys", "keys", "[%s][0]" % N(KY, "data"))),
        K.parallel("condition_all_ISread", "The gate's reads in parallel (no row limits)", reads),
        K.code(GT, "Gate: eligibility, the lifted classic gates (code_required + CHECK_REQUIRED_FIELD, code_validate v12), limits, WA, the GENERATE_BATCH pre-check",
               lifted_code("gate.js", "gate_tail.js"), gate_fields,
               objects=("allData", "lineCount", "pickCount", "stockPickCount", "nonStockLines", "movementCount", "batchDocDate", "batchMfgDate", "batchExpDate")),
        K.if_(ids, "if_ISgateEnd", "IF the gate answered (NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"), sres("gate", "gate", gate_small)),
        gate(ids, "cor_ISbatch", "Batch-managed parent with system numbering: generate its batch number (the last check before the first write)?", GT, "needBatch",
             [batch_call]),
        K.code(PO, "Post: the batch number, the queue rows (a stored Draft's lock first, the COMPLETE_IA job QUEUED 2 minutes ahead, the request)", scode("post.js"),
               post_fields, arrays=("lockRows", "jobRows"), objects=("lineCount",)),
        K.if_(ids, "if_ISpostEnd", "IF nothing to write: answer", "'%s' != 'QUEUE'" % N(PO, "data.route"), sres("post", "post", "[%s][0]" % N(PO, "data"))),
        gate(ids, "cor_ISlock", "Stored Draft: the IA's lock IAC|<ia> / LOCK|<n+1> first?", PO, "needLock", [
            step_add(ids, "add_node_ISlock", "LOCK: gd_publish_step IAC|<ia> / LOCK|<n> (unique tenant / job / step: a concurrent twin fails its run)", PO, "lockRows")]),
        K.add(ids, "add_node_ISjob", "Job insert: COMPLETE_IA QUEUED, due in 2 minutes (unique idempotency key: a twin click fails its run)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in JOB_ADD_COLS], labels={"organization_id": "Organization"}),
        K.code(RW, "Row: the new job's id, which document write runs", scode("row.js"), ["ok", "jobId", "writeAdd", "writeNumber", "writeNoNumber"]),
        gate(ids, "cor_ISadd", "Add / Clone: insert the Item Assembly?", RW, "writeAdd", [ia_add]),
        gate(ids, "cor_ISnum", "Stored Draft: update with the number props?", RW, "writeNumber", [ia_num]),
        gate(ids, "cor_ISnonum", "Stored Draft whose number an earlier job issued: update without the number props?", RW, "writeNoNumber", [ia_nonum]),
        K.parallel("condition_all_ISafter", "Read-back after the document write in parallel", after),
        K.code(LK, "Link: iaId, iaNo, issuedNo, lineFingerprint into the request; an Add's LOCK|1 and correlation", scode("link.js", ("shared/ia_common.js", "shared/fingerprint.js")),
               ["ok", "why", "iaId", "iaNo", "request", "needLink", "needLock", "lockRows", "jobRows"], arrays=("lockRows", "jobRows")),
        gate(ids, "cor_ISlock1", "Add: the new IA's lock IAC|<ia> / LOCK|1?", LK, "needLock", [
            step_add(ids, "add_node_ISlock1", "LOCK: gd_publish_step IAC|<ia> / LOCK|1", LK, "lockRows")]),
        gate(ids, "cor_ISlink", "Add: the job's correlation / causation / request?", LK, "needLink", [
            job_update(ids, "update_node_ISlink", "Job: correlation IA|<ia>, causation, request (iaId, iaNo, issuedNo, lineFingerprint)", LK, "jobRows",
                       ["id", "correlation_id", "causation_id", "request_payload"])]),
        K.sql("sql_node_ISback", "Read-back: the job of this key, its IA's status / job link / number, the IA's latest lock", back, Q.BACK_COLS),
        K.code("code_node_ISdue", "Due: the IA is Processing under this job's lock -> the job due now with its final request", scode("due.js"), ["dueRows", "needDue"],
               arrays=("dueRows",)),
        gate(ids, "cor_ISdue", "Job to make due?", "code_node_ISdue", "needDue", [
            K.update(ids, "update_node_ISdue", "Job due now with its final request (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_ISdue", "data.dueRows.id")),
                     [("id", N("code_node_ISdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_ISdue", "data.dueRows.next_attempt_at")),
                      ("request_payload", N("code_node_ISdue", "data.dueRows.request_payload"))])]),
    ] + sres("done", "queued", "[%s][0]" % N(PO, "data"), "sql_node_ISback")
    doc = K.workflow([("operation", "string", "SUBMIT (default) or STATUS"),
                      ("saveAs", "string", "Completed (Draft answers NOT_ELIGIBLE: Draft stays classic)"),
                      ("pageStatus", "string", "Add | Edit | Clone (Copy = Clone): the form's page_status; View is refused"),
                      ("ia_id", "string", "sm_item_assembly.id (digits) for Edit and STATUS; empty (or 0) for Add / Clone"),
                      ("idempotency_key", "string", "IA:<org>:<id | new-token>:<hash16>:<gen> (8-128 chars A-Z a-z 0-9 | : _ . -); optional for STATUS"),
                      ("source", "string", "FORM (default) | MOBILE"),
                      ("form", "any", "the IA record (this.getValues() minus the helper keys); {} for STATUS")],
                     SUB_RES, nodes)
    return rekey(doc)


def build():
    """_build() with wfkit's shared key stream and taken-set restored afterwards: this build leaves no trace on later builders"""
    state, taken = K._rng.getstate(), set(K._taken)
    try:
        return _build()
    finally:
        K._rng.setstate(state)
        K._taken.clear()
        K._taken.update(taken)


BUILDERS = [("IA_V2_SUBMIT", build)]

if __name__ == "__main__":
    V.build(BUILDERS, os.path.abspath(os.path.join(HERE, "..", "..", "Item Assembly & BOM", "AsyncV2")), "--write" in sys.argv)
