"""IDA_V2_SUBMIT (CONTRACT.md sections 2, 3, 4, 7): the synchronous entry of the Item Disassembly form - operations SUBMIT and STATUS.
Copied from tpl/iav2/build_submit.py (IA_V2_SUBMIT) and made the IDA's (IDA| offset 5, IDC| lock, COMPLETE_IDA, IDA_ codes, prevStatus
Draft only, node prefix DS):

guard -> facts -> entry (the key's job / STATUS / BUSY / STALE / the action) -> keys (the record, the lifted code_fillback +
code_item_ids, the reads' inputs) -> the reads in parallel (ITEMS, costing, WA, duplicate balances, BNC, BATCH_HOLDERS) -> gate
(eligibility, the lifted code_required + CHECK_REQUIRED_FIELD v8 + code_validate, the typed-number check, limits, WA, the in-memory
batchnum dry run) -> post -> a stored Draft's LOCK|n+1 -> the job (QUEUED, due in 600 s) -> ONE document write (v6's add_ida /
update_ida, retargeted: Processing, ida_v2_job_id, ida_idem_key, no posted_status) -> read-back -> an Add's LOCK|1 + link -> the key's
read-back -> due (+ the final request).

The lifted gates are submit/lifted_submit.js (lib/lift/lift.py submit/lift.json, from the BUILT IDA_SAVE v7): the build refuses a stale
lift and a built IDA_SAVE.json that is not classic/patch_v7.py's current output. Response keys come from a local seeded RNG after the
build, so the output does not depend on the build order.

usage: python3 scratchpad/idav2/build_submit.py [--write]   (writes Item Disassembly/AsyncV2/IDA_V2_SUBMIT.json, indent 1)
"""
import sys
sys.dont_write_bytecode = True
import copy  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import random  # noqa: E402
import string  # noqa: E402

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


Q = _load("ida_submit_sql", os.path.join(HERE, "submit", "submit_sql.py"))
LIFT = _load("ida_submit_lift", os.path.join(HERE, "lib", "lift", "lift.py"))
CLASSIC = _load("ida_classic_patch_v7_for_submit", os.path.join(HERE, "classic", "patch_v7.py"))

CODE = os.path.join(HERE, "code")
BASE = os.path.join(HERE, "base", "IDA_SAVE.v6.json")
BUILT_SAVE = os.path.join(HERE, "..", "..", "Item Disassembly", "AsyncV2", "IDA_SAVE.json")
LIFTED_IDS = ["code_fillback", "code_required", "code_item_ids", "code_validate"]
SUB_RES = ["route", "code", "message", "reason", "action", "job_id", "job_status", "terminal", "ida_id", "ida_no", "line_count", "progress_percent", "progress_message",
           "error_code", "error_message", "evidence"]
G, E, KY, GT, PO, RW, LK = ("code_node_DSguard", "code_node_DSentry", "code_node_DSkeys", "code_node_DSgate", "code_node_DSpost", "code_node_DSrow", "code_node_DSlink")
KEY_SEED = 20261021
FILTER_BASE = 1799720000000
# the reviewed (frozen 10-21) content of every code/shared file this build inlines (code nodes) or embeds (sql.py's statements)
SHARED_MD5 = {"ida_common.js": "b4a9d6470e981cacdacd43eeafa43ae9", "fingerprint.js": "49ce36a69f5d62db6793c74b42c07243",
              "batchnum.js": "de4a40a44b9a57f105e6b19e6dc8701f", "batchnum_adapter.js": "343045d618079bc40850aa6bca864de3",
              "sql.py": "a2ad87f75141a8680c3827f73fd2c3a0"}


def inc(path):
    return V.include_js(CODE, path)


def scode(name, shared=("shared/ida_common.js",)):
    """a code node's script: the shared helpers it needs, submit/_common.js, the file"""
    return "\n".join([inc(p) for p in shared] + [K.js("submit/_common.js"), K.js("submit/" + name)])


def lifted():
    """submit/lifted_submit.js, refused when stale (lift.py --check) or when the built IDA_SAVE.json is not patch_v7's current output"""
    cfg = os.path.join(HERE, "submit", "lift.json")
    out, header, sources, rel_root = LIFT.load_config(cfg)
    text, _ = LIFT.build(sources, header, rel_root)
    have = open(out, encoding="utf-8").read() if os.path.exists(out) else ""
    if have != text:
        raise AssertionError("submit/lifted_submit.js is stale: python3 scratchpad/idav2/lib/lift/lift.py scratchpad/idav2/submit/lift.json")
    # the four lifted nodes only (build_ida.py builds SUBMIT before the classic; a guard-only change must not stop it)
    bi, ni, vi = CLASSIC.index(json.load(open(BUILT_SAVE, encoding="utf-8"))), CLASSIC.index(CLASSIC.build()), classic_nodes()
    for nid in LIFTED_IDS:
        assert CLASSIC.canon(bi[nid]) == CLASSIC.canon(ni[nid]), nid + ": the built IDA_SAVE.json is not classic/patch_v7.py's output: build_classic.py --write"
        assert CLASSIC.canon(bi[nid]) == CLASSIC.canon(vi[nid]), nid + ": the built v7 body is not v6's"
    assert "{{" not in text, "lifted_submit.js: a platform token is left"
    return text


def lifted_code(*names, extra=()):
    """the lift runtime + the lifted gates (global, once), ida_common (+ extra shared files), _common, _fill, then the files"""
    parts = [V.raw(os.path.join(HERE, "lib", "lift"), "runtime.js"), lifted(), inc("shared/ida_common.js")] + [inc(p) for p in extra]
    parts += [K.js("submit/_common.js"), K.js("submit/_fill.js")]
    return "\n".join(parts + [K.js("submit/" + n) for n in names])


def classic_nodes():
    return CLASSIC.index(json.load(open(BASE, encoding="utf-8")))


def retarget(ids, old, nid, title, where=None, drop=(), extra=()):
    """a v6 add / update node with its values read from this workflow: allData (and the lines with their placeholders) from the gate,
    the id from the guard; item_disassembly_status the literal Processing; posted_status dropped (D4 writes it); fresh filter ids"""
    n = copy.deepcopy(old)
    n["id"] = nid
    n["data"].update({"title": title, "nodeName": title, "name": title})
    keep = []
    for p in n["data"]["props"]["list"]:
        prop = p["prop"]
        if prop in drop or prop == "posted_status":
            continue
        if prop == "item_disassembly_status":
            assert p["value"] == "{{node:code_fillback.data.allData.item_disassembly_status}}", (nid, p)
            p.update({"valueType": "value", "value": "Processing"})
        elif prop == "stock_movement":
            assert p["value"] == "{{node:code_apply_batches.data.stock_movement}}", (nid, p)
            p["value"] = N(GT, "data.allData.stock_movement")
        elif prop == "id":
            assert p["value"] == "{{node:code_fillback.data.allData.id}}", (nid, p)
            p["value"] = N(G, "data.idaId")
        else:
            assert p["valueType"] == "field" and p["value"] == "{{node:code_fillback.data.allData.%s}}" % prop, (nid, p)
            p["value"] = N(GT, "data.allData." + prop)
        keep.append(p)
    for prop, value in extra:
        keep.append({"prop": prop, "valueType": "field", "value": value, "operator": "", "valueLabel": "", "propLabel": prop})
    n["data"]["props"]["list"] = keep
    leaf = n["data"]["table_id"]["rules"]["list"][0]
    if where is not None:
        assert leaf["prop"] == "id" and leaf["value"] == "{{node:code_fillback.data.allData.id}}", (nid, leaf)
        leaf["value"] = where
    leaf.update({"id": ids(), "parentId": ids()})
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
    extras = [("ida_v2_job_id", JOBID), ("ida_idem_key", KEY)]
    ida_add = retarget(ids, old["add_ida"], "add_node_DSida", "Item Disassembly + lines (add_ida's props; Processing; ida_v2_job_id, ida_idem_key; no posted_status)",
                       extra=extras)
    ida_num = retarget(ids, old["update_ida"], "update_node_DSidaNum",
                       "Item Disassembly + lines (update_ida's props; Processing; ida_v2_job_id, ida_idem_key; no posted_status)", where=N(G, "data.idaId"), extra=extras)
    ida_nonum = retarget(ids, old["update_ida"], "update_node_DSidaNoNum",
                         "Item Disassembly + lines (update_ida's props without the number: an earlier job issued it; Processing; ida_v2_job_id, ida_idem_key)",
                         where=N(G, "data.idaId"), drop=("stock_movement_no", "stock_movement_no_type"), extra=extras)
    assert [len(x["data"]["props"]["list"]) for x in (ida_add, ida_num, ida_nonum)] == [24, 25, 23]

    facts = Q.facts(sub, T, N(G, "data.idaId"), KEY, N(G, "data.organizationId"))
    org = N(KY, "data.organizationId")
    items = Q.items(sub, T, N(KY, "data.itemIdsSql"))
    cost = Q.cost(sub, T, N(KY, "data.costPairsJson"), N(KY, "data.itemIdsSql"), N(KY, "data.plantId"), org)
    wa = Q.wa(sub, T, N(KY, "data.pickPairsJson"), N(KY, "data.plantId"), org)
    dup = Q.dup(sub, T, N(KY, "data.balTuplesJson"), N(KY, "data.batchTuplesJson"), N(KY, "data.itemIdsSql"), N(KY, "data.plantId"), org)
    bnc = Q.bnc(sub, T, org)
    holders = Q.holders(sub, T, org, N(KY, "data.hexJson"))
    hdr = Q.hdr_by_job(sub, T, JOBID)
    header = Q.header_by_job(sub, T, JOBID)
    lines = Q.lines_by_job(sub, T, JOBID)
    back = Q.back(sub, T, KEY)
    gate_small = ("{ route: [%s][0], code: [%s][0], message: [%s][0], reason: [%s][0], errorCode: [%s][0], moveCount: [%s][0] }"
                  % tuple(N(GT, "data." + f) for f in ("route", "code", "message", "reason", "errorCode", "moveCount")))

    def sres(tag, title, src, back=None):
        guard = "[%s][0]" % N(G, "data")
        entry = "null" if tag == "rej" else "[%s][0]" % N(E, "data")
        call_ = "submitResult(%s, %s, %s, %s)" % (guard, entry, src, back or "null, false")
        body = scode("result.js") + ("\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, "
                                     "action: res.action, job: res.job_id }));\nreturn res;" % call_)
        return [K.code("code_node_DS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_DS%s" % tag, "Return (%s)" % title, [(f, N("code_node_DS%sres" % tag, "data." + f)) for f in SUB_RES])]

    guard_fields = ["route", "code", "message", "errorCode", "operation", "saveAs", "pageStatus", "pageStatusIn", "idaId", "key", "tenantId", "uid", "source", "nonce", "clone",
                    "organizationId"]
    entry_fields = ["route", "code", "message", "reason", "errorCode", "action", "prevStatus", "tenantId", "idaId", "idaNo", "storedStatus", "organizationId", "plantId",
                    "noType", "dbNow", "lockN", "issuedByJob", "completedUnder", "jobId", "jobStatus", "jobAction", "progressPercent", "progressMessage", "jobErrorCode",
                    "errorMessage", "lineCount"]
    keys_fields = ["route", "code", "message", "reason", "errorCode", "ok", "why", "itemIdsSql", "pickPairsJson", "costPairsJson", "balTuplesJson", "batchTuplesJson",
                   "hexJson", "plantId", "organizationId", "lineCount", "pickCount", "moveCount"]
    gate_fields = ["route", "code", "message", "reason", "errorCode", "allData", "lineCount", "pickCount", "moveCount", "stockLines", "nonStockLines", "autoLines",
                   "plantId", "organizationId", "stockMovementNo"]
    post_fields = ["route", "code", "message", "errorCode", "request", "isAdd", "numberProps", "numberIssued", "moveCount", "lockRows", "needLock", "jobRows"]
    reads = [("cai_DSitems", "items", [K.sql("sql_node_DSitems", "Items of the IDA: the source + every recovery item (code/shared ITEMS: stock control, serial, batch rule, "
                                             "costing, UOM conversions)", items, ["j"])]),
             ("cai_DScost", "cost", [K.sql("sql_node_DScost", "Costing screen: source picks + recovery items with FIFO / WA rows waiting for migration (IA's COST)", cost,
                                           ["j"])]),
             ("cai_DSwa", "wa", [K.sql("sql_node_DSwa", "WA screen: Weighted Average source picks without a wa_costing_method row (GLOBAL_INVENTORY_VALIDATION v11)", wa,
                                       ["j"])]),
             ("cai_DSdup", "dup", [K.sql("sql_node_DSdup", "Duplicate-balance screen: item_balance / item_batch_balance rows the engine would refuse (DUPLICATE_BALANCE)",
                                         dup, ["j"])]),
             ("cai_DSbnc", "bnc", [K.sql("sql_node_DSbnc", "Batch number configs of the organization (code/shared BNC: the dry run's input)", bnc, ["j"])]),
             ("cai_DSbatches", "batches", [K.sql("sql_node_DSbatches", "Live Batch rows holding a typed number (code/shared BATCH_HOLDERS, hex in: code_validate's "
                                                 "search_batches + the typed-number check)", holders, ["j"])])]
    after = [("cai_DShdr", "ida", [K.sql("sql_node_DShdr", "Read-back: the Item Disassembly this job wrote (ida_v2_job_id)", hdr, Q.HDR_COLS)]),
             ("cai_DSheader", "header", [K.sql("sql_node_DSheader", "Read-back: its header (FP_HEADER)", header, ["j"])]),
             ("cai_DSlines", "lines", [K.sql("sql_node_DSlines", "Read-back: its recovery lines (FP_LINES)", lines, ["j"])]),
             ("cai_DSback", "back", [gate(ids, "cor_DSbackNow", "Stored Draft: the key's job read back here (its lock and link were written before the document)?",
                                          RW, "backNow", [K.sql("sql_node_DSback", "Read-back (stored Draft): the job of this key, its IDA's status / job link / number, "
                                                                "the IDA's latest lock", back, Q.BACK_COLS)])])]
    # the back rows the due / done nodes read: the Add's (after its link) or the stored Draft's (in the fork-join); one of them never runs
    back_rows = ("idaBackRows([%s][0], [%s][0], [%s][0])" % (N(PO, "data.isAdd"), N("sql_node_DSbackAdd", "data"), N("sql_node_DSback", "data")))

    nodes = [
        K.code(G, "Guard: operation, saveAs, pageStatus (Clone = Add), ida_id, idempotency key, source, the form's organization, session tenant + user", scode("guard.js"),
               guard_fields),
        K.if_(ids, "if_DSreject", "IF the request is invalid: answer, write nothing", V.is_(G, "route", "REJECT"), sres("rej", "invalid request", "[%s][0]" % N(G, "data"))),
        K.sql("sql_node_DSfacts", "Facts: this key's job; the stored IDA, its lock, open / latest / linked COMPLETE_IDA jobs, the number rule; DB clock", facts, Q.FACTS_COLS),
        K.code(E, "Entry: STATUS / this key's job; else the stored IDA decides (BUSY / STALE / STOP / NOT_ELIGIBLE) and the action", scode("entry.js"), entry_fields,
               objects=("lockN", "issuedByJob", "completedUnder", "progressPercent", "lineCount")),
        K.if_(ids, "if_DSanswer", "IF answered here (STATUS / BUSY / STALE / STOP / NOT_ELIGIBLE): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"),
              sres("ans", "entry", "[%s][0]" % N(E, "data"))),
        K.code(KY, "Keys: the record (INVALID if none), the lifted code_fillback + code_item_ids, the reads' digit / hex inputs", lifted_code("keys.js"), keys_fields,
               objects=("lineCount", "pickCount", "moveCount")),
        K.if_(ids, "if_DSkeysEnd", "IF the keys answered (INVALID / STOP): answer, read nothing, write nothing", "'%s' != 'GO'" % N(KY, "data.route"),
              sres("keys", "keys", "[%s][0]" % N(KY, "data"))),
        K.parallel("condition_all_DSread", "The gate's reads in parallel (no row limits)", reads),
        K.code(GT, "Gate: eligibility, the lifted classic gates (code_required + CHECK_REQUIRED_FIELD, code_validate) + the typed-number check, limits, WA, "
                   "the batchnum dry run", lifted_code("gate.js", "gate_tail.js", extra=("shared/batchnum.js", "shared/batchnum_adapter.js")), gate_fields,
               objects=("allData", "lineCount", "pickCount", "moveCount", "stockLines", "nonStockLines", "autoLines")),
        K.if_(ids, "if_DSgateEnd", "IF the gate answered (NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"), sres("gate", "gate", gate_small)),
        K.code(PO, "Post: the queue rows (a stored Draft's lock first, the COMPLETE_IDA job QUEUED 2 minutes ahead, the request)", scode("post.js"), post_fields,
               arrays=("lockRows", "jobRows"), objects=("moveCount",)),
        K.if_(ids, "if_DSpostEnd", "IF nothing to write: answer", "'%s' != 'QUEUE'" % N(PO, "data.route"), sres("post", "post", "[%s][0]" % N(PO, "data"))),
        gate(ids, "cor_DSlock", "Stored Draft: the IDA's lock IDC|<ida> / LOCK|<n+1> first?", PO, "needLock", [
            step_add(ids, "add_node_DSlock", "LOCK: gd_publish_step IDC|<ida> / LOCK|<n> (unique tenant / job / step: a concurrent twin fails its run)", PO, "lockRows")]),
        K.add(ids, "add_node_DSjob", "Job insert: COMPLETE_IDA QUEUED, due in 2 minutes (unique idempotency key: a twin click fails its run)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in JOB_ADD_COLS], labels={"organization_id": "Organization"}),
        K.code(RW, "Row: the new job's id, which document write runs, whether the key's job is read back with the document", scode("row.js"),
               ["ok", "jobId", "writeAdd", "writeNumber", "writeNoNumber", "backNow"]),
        gate(ids, "cor_DSadd", "Add / Clone: insert the Item Disassembly?", RW, "writeAdd", [ida_add]),
        gate(ids, "cor_DSnum", "Stored Draft: update with the number props?", RW, "writeNumber", [ida_num]),
        gate(ids, "cor_DSnonum", "Stored Draft whose number an earlier job issued: update without the number props?", RW, "writeNoNumber", [ida_nonum]),
        K.parallel("condition_all_DSafter", "Read-back after the document write in parallel", after),
        K.code(LK, "Link: idaId, idaNo, issuedNo, lineFingerprint into the request; an Add's LOCK|1 and correlation",
               scode("link.js", ("shared/ida_common.js", "shared/fingerprint.js")), ["ok", "why", "idaId", "idaNo", "request", "needLink", "needLock", "lockRows", "jobRows"],
               arrays=("lockRows", "jobRows")),
        gate(ids, "cor_DSlock1", "Add: the new IDA's lock IDC|<ida> / LOCK|1?", LK, "needLock", [
            step_add(ids, "add_node_DSlock1", "LOCK: gd_publish_step IDC|<ida> / LOCK|1", LK, "lockRows")]),
        gate(ids, "cor_DSlink", "Add: the job's correlation / causation / request?", LK, "needLink", [
            job_update(ids, "update_node_DSlink", "Job: correlation IDA|<ida>, causation, request (idaId, idaNo, issuedNo, lineFingerprint)", LK, "jobRows",
                       ["id", "correlation_id", "causation_id", "request_payload"])]),
        gate(ids, "cor_DSbackAdd", "Add: the key's job read back after its LOCK|1 and link?", LK, "needLink", [
            K.sql("sql_node_DSbackAdd", "Read-back (Add): the job of this key, its IDA's status / job link / number, the IDA's latest lock", back, Q.BACK_COLS)]),
        K.code("code_node_DSdue", "Due: the IDA is Processing under this job's lock -> the job due now with its final request", scode("due.js"), ["dueRows", "needDue"],
               arrays=("dueRows",)),
        gate(ids, "cor_DSdue", "Job to make due?", "code_node_DSdue", "needDue", [
            K.update(ids, "update_node_DSdue", "Job due now with its final request (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_DSdue", "data.dueRows.id")),
                     [("id", N("code_node_DSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_DSdue", "data.dueRows.next_attempt_at")),
                      ("request_payload", N("code_node_DSdue", "data.dueRows.request_payload"))])]),
    ] + sres("done", "queued", "[%s][0]" % N(PO, "data"), "%s, [%s][0] === \"YES\"" % (back_rows, N(LK, "data.ok")))
    doc = K.workflow([("operation", "string", "SUBMIT (default) or STATUS"),
                      ("saveAs", "string", "Completed (Draft answers NOT_ELIGIBLE: Draft stays classic)"),
                      ("pageStatus", "string", "Add | Edit | Clone (Copy = Clone): the form's page_status; View is refused"),
                      ("ida_id", "string", "sm_item_disassembly.id (digits) for Edit and STATUS; empty (or 0) for Add / Clone"),
                      ("idempotency_key", "string", "IDA:<org>:<id | new-token>:<hash16>:<gen> (8-128 chars A-Z a-z 0-9 | : _ . -); optional for STATUS"),
                      ("source", "string", "FORM (default) | MOBILE"),
                      ("form", "any", "the IDA record (this.getValues() minus the helper keys); {} for STATUS")],
                     SUB_RES, nodes)
    return rekey(doc)


def build():
    """_build() with wfkit's shared key stream and taken-set restored afterwards: this build leaves no trace on later builders"""
    CLASSIC.check_shared(SHARED_MD5, "build_submit.py")
    state, taken = K._rng.getstate(), set(K._taken)
    try:
        return _build()
    finally:
        K._rng.setstate(state)
        K._taken.clear()
        K._taken.update(taken)


BUILDERS = [("IDA_V2_SUBMIT", build)]

if __name__ == "__main__":
    V.build(BUILDERS, os.path.abspath(os.path.join(HERE, "..", "..", "Item Disassembly", "AsyncV2")), "--write" in sys.argv)
