"""SA_V2_SUBMIT (CONTRACT.md §2, §3, §4, §7): the synchronous entry of the Stock Adjustment form (FORM) and of the Stock Count
Review (REVIEW: a NEW Stock Adjustment) - operations SUBMIT and STATUS. Copied from tpl/smv2/build_submit.py (LOT_V2_SUBMIT, itself
GR V2's GR_COMPLETE_SUBMIT) and de-LOT-ed (SA| offset 4, SAC| / SCR| locks, COMPLETE_SA, SA_ codes, prevStatus Draft / Cancelled):

guard -> facts + the stored SC lines (parallel) -> entry (STATUS / BUSY / STALE / action) -> keys (form-visible eligibility; REVIEW:
saReviewPrep -> no SA = NOT_ELIGIBLE, the review reads' ids; limits) -> the reads (parallel; the 8 REVIEW_READS nested under an if)
-> gate (eligibility, the classic's gates lifted / saReviewChain, entry checks, WA, limits) -> post -> the queue writes in the
contract's order -> read-back -> link -> due. Document writes are the classic nodes, copied and retargeted: DIRECT
add_node_Yk7ukSPp (STOCK_ADJUSTMENT v24; values from the gate's filled-back allData), REVIEW add_node_sa (STOCK_COUNT v10; header
props only, values from the gate's saHeader), COMPLETE a header update (Processing + sa_v2_job_id [+ the number props]).

The review chain is package A's code/shared/review_chain.js + review_sql.py (CONTRACT §16), included after lib/lift/runtime.js and
code/shared/sa_common.js as it asks; the build is skipped (NotImplementedError) while those files are missing."""
import copy
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, os.path.join(HERE, "submit"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402
from v2build import N, JOB, STEP, JOB_ADD_COLS, PART_COLS, sub, gate, step_add, job_update  # noqa: E402
import submit_sql as Q  # noqa: E402

SA = "Stock Adjustment:Table:1902274108952006658"
BASE_SA = os.path.join(HERE, "base", "STOCK_ADJUSTMENT.v24.json")
BASE_SC = os.path.join(HERE, "base", "STOCK_COUNT.v10.json")
CODE = os.path.join(HERE, "code")
SHARED_DIR = os.path.join(CODE, "shared")
SUB_RES = ["route", "code", "message", "reason", "action", "job_id", "job_status", "terminal", "sa_id", "sa_no", "sc_id", "line_count", "progress_percent",
           "progress_message", "error_code", "error_message", "evidence"]
G, E, KY, GT, PO, RW, LK = ("code_node_SSguard", "code_node_SSentry", "code_node_SSkeys", "code_node_SSgate", "code_node_SSpost", "code_node_SSrow", "code_node_SSlink")
SHARED = ["shared/sa_common.js", "shared/fingerprint.js"]
# the review chain's reads (CONTRACT §16 REVIEW_READS) -> this workflow's sql-node ids (gate_tail.js reads them by these ids)
REVIEW_NODES = {"items": "sql_node_SSrvItems", "balances": "sql_node_SSrvBalances", "batch_balances": "sql_node_SSrvBatchBalances", "bins": "sql_node_SSrvBins",
                "uoms": "sql_node_SSrvUoms", "batches": "sql_node_SSrvBatches", "costs": "sql_node_SSrvCosts", "prefix": "sql_node_SSrvPrefix"}
LIFT_BLOCK = re.compile(r'__N\["([A-Za-z0-9_]+)"\] = \{.*?\n\} \};\n', re.S)


def inc(path):
    return V.include_js(CODE, path)


def scode(name):
    """a code node's script: sa_common.js (+ fingerprint.js where lines are fingerprinted), _common.js, the file"""
    shared = SHARED if name in ("link.js",) else SHARED[:1]
    return "\n".join([inc(p) for p in shared] + [K.js("submit/_common.js"), K.js("submit/" + name)])


def review_files():
    """package A's review chain (JS text without its export line) and its REVIEW_READS module"""
    js = os.path.join(SHARED_DIR, "review_chain.js")
    py = os.path.join(SHARED_DIR, "review_sql.py")
    missing = [p for p in (js, py) if not os.path.exists(p)]
    if missing:
        raise NotImplementedError("the shared review chain is not there yet: " + ", ".join(os.path.relpath(p, HERE) for p in missing))
    spec = importlib.util.spec_from_file_location("sa_review_sql_for_submit", py)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert set(mod.REVIEW_READS) == set(REVIEW_NODES), ("REVIEW_READS keys", sorted(mod.REVIEW_READS))
    return V.include_js(SHARED_DIR, "review_chain.js"), mod


def runtime_js():
    return V.raw(os.path.join(HERE, "lib", "lift"), "runtime.js")


def lifted_submit(chain_js):
    """SUBMIT's lifted gates (submit/lifted_submit.js: O4tWJ5JH, EZJK1Hzm, AeSdXE85). review_chain.js lifts O4tWJ5JH too, into the
    same __N: the two bodies must be the same text (the later assignment wins)"""
    text = V.raw(os.path.join(HERE, "submit"), "lifted_submit.js")
    assert "{{" not in text, "a lifted body still holds a platform token"
    mine = {m.group(1): m.group(0) for m in LIFT_BLOCK.finditer(text + "\n")}
    theirs = {m.group(1): m.group(0) for m in LIFT_BLOCK.finditer(chain_js + "\n")}
    assert set(mine) == {"code_node_O4tWJ5JH", "code_node_EZJK1Hzm", "code_node_AeSdXE85"}, sorted(mine)
    assert "code_node_O4tWJ5JH" in theirs, sorted(theirs)
    for nid in set(mine) & set(theirs):
        assert mine[nid] == theirs[nid], nid + ": SUBMIT's lifted body differs from review_chain.js's"
    return text


def keys_code(chain_js):
    """keys: the lift runtime, sa_common, the review chain (saReviewPrep), _common.js, keys.js"""
    return "\n".join([runtime_js(), inc("shared/sa_common.js"), chain_js, K.js("submit/_common.js"), K.js("submit/keys.js")])


def gate_code(chain_js):
    """gate: the lift runtime (once, global: review_chain.js asks for it), sa_common, fingerprint, the review chain, SUBMIT's own
    lifted gates, _common.js, gate.js, gate_tail.js"""
    text = "\n".join([runtime_js()] + [inc(p) for p in SHARED] + [chain_js, lifted_submit(chain_js), K.js("submit/_common.js"), K.js("submit/gate.js"),
                                                                  K.js("submit/gate_tail.js")])
    for need in ("const saReviewChain", "const saReviewIds", "const saLineFingerprint", "const scLineFingerprint", "const submitGate", "function __run"):
        assert need in text, "gate: " + need + " is missing"
    return text


def classic_nodes(path):
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
    walk(json.load(open(path, encoding="utf-8")))
    return out


def js_list(name):
    m = re.search(r"const %s = \[([^\]]*)\]" % name, K.js("submit/gate.js"))
    assert m, name
    return re.findall(r'"([^"]+)"', m.group(1))


def retarget(old, nid, title, src_ref, fixed, drop=(), extra=()):
    """a classic add node with its values read from this workflow's gate (src_ref.<prop>); `fixed` props become literals"""
    n = copy.deepcopy(old)
    n["id"] = nid
    n["data"].update({"title": title, "nodeName": title, "name": title})
    keep = []
    for p in n["data"]["props"]["list"]:
        if p["prop"] in drop:
            continue
        if p["prop"] in fixed:
            p.update({"valueType": "value", "value": fixed[p["prop"]]})
        else:
            assert p["valueType"] == "field" and p["value"].endswith(".%s}}" % p["prop"]), (nid, p)
            p["value"] = N(src_ref[0], src_ref[1] + "." + p["prop"])
        keep.append(p)
    for prop, value, label in extra:
        keep.append({"prop": prop, "operator": "", "valueType": "field", "value": value, "valueLabel": "", "propLabel": label})
    n["data"]["props"]["list"] = keep
    return n


def build():
    ids = K.Ids(1797800000000)
    chain_js, rmod = review_files()
    sa = classic_nodes(BASE_SA)
    sc = classic_nodes(BASE_SC)
    T = N(G, "data.tenantId")
    KEY = N(G, "data.key")
    JOBID = N(RW, "data.jobId")

    # the classic writes this workflow copies, checked against their bases
    yk = sa["add_node_Yk7ukSPp"]
    assert [p["value"] for p in yk["data"]["props"]["list"] if p["prop"] == "stock_adjustment_status"] == ["{{workflowparams:saveAs}}"]
    sa_add = retarget(yk, "add_node_SSsa", "Stock Adjustment + lines (add_node_Yk7ukSPp's props; Processing; sa_v2_job_id, sa_idem_key)", (GT, "data.allData"),
                      {"stock_adjustment_status": "Processing"},
                      extra=[("sa_v2_job_id", JOBID, "SA V2 Job"), ("sa_idem_key", KEY, "SA Idempotency Key")])
    assert len(sa_add["data"]["props"]["list"]) == 19
    upd = sa["update_node_bYNSsj0v"]
    upd_props = [p["prop"] for p in upd["data"]["props"]["list"]]
    assert js_list("SA_DOC_HDR_PROPS") == [p for p in upd_props if p not in ("stock_adjustment_status", "adjustment_no", "adjustment_no_type", "stock_adjustment")], upd_props
    labels = {p["prop"]: p["propLabel"] for p in upd["data"]["props"]["list"]}
    labels.update({"sa_v2_job_id": "SA V2 Job"})
    sa_num = K.update(ids, "update_node_SSsaNum", "Stock Adjustment header: Processing + sa_v2_job_id + the number props (COMPLETE)", SA, ("id", "in", N(G, "data.saId")),
                      [("stock_adjustment_status", "Processing"), ("sa_v2_job_id", JOBID), ("adjustment_no", N(GT, "data.allData.adjustment_no")),
                       ("adjustment_no_type", N(GT, "data.allData.adjustment_no_type"))], labels=labels)
    sa_num["data"]["props"]["list"][0]["valueType"] = "value"
    sa_nonum = K.update(ids, "update_node_SSsaNoNum", "Stock Adjustment header: Processing + sa_v2_job_id (COMPLETE; its number was issued by an earlier job)", SA,
                        ("id", "in", N(G, "data.saId")), [("stock_adjustment_status", "Processing"), ("sa_v2_job_id", JOBID)], labels=labels)
    sa_nonum["data"]["props"]["list"][0]["valueType"] = "value"
    asa = sc["add_node_sa"]
    asa_props = [p["prop"] for p in asa["data"]["props"]["list"]]
    assert js_list("SA_REVIEW_HDR_PROPS") == [p for p in asa_props if p not in ("stock_adjustment_status", "adjustment_no", "stock_adjustment")] + ["posted_status"], asa_props
    review_add = retarget(asa, "add_node_SSreviewSa", "Stock Adjustment HEADER from the review (add_node_sa's header props; Processing; 'issued' + the default rule)",
                          (GT, "data.saHeader"), {"stock_adjustment_status": "Processing", "adjustment_no": "issued"}, drop=("stock_adjustment",),
                          extra=[("posted_status", N(GT, "data.saHeader.posted_status"), "Posted Status"), ("sa_v2_job_id", JOBID, "SA V2 Job"),
                                 ("sa_idem_key", KEY, "SA Idempotency Key")])
    assert len(review_add["data"]["props"]["list"]) == 15

    # SQL
    facts = Q.facts(sub, T, N(G, "data.saId"), N(G, "data.scId"), KEY, N(G, "data.formScId"))
    sc_lines = Q.sc_lines(sub, T, N(G, "data.scId"))
    items = Q.items(sub, T, N(KY, "data.itemIdsSql"))
    cost = Q.cost(sub, T, N(KY, "data.itemIdsSql"), N(KY, "data.batchIdsSql"), N(KY, "data.organizationId"))
    stored = Q.stored(sub, T, N(KY, "data.storedSaId"), N(KY, "data.needStored"))
    hdr = Q.hdr_by_job(sub, T, JOBID)
    lines = Q.lines_by_job(sub, T, JOBID, N(PO, "data.linesBack"))
    back = Q.back(sub, T, KEY)
    refs = {"T": T, "MID": N(KY, "data.rvMatSql"), "LID": N(KY, "data.rvLocSql"), "UID": N(KY, "data.rvUomSql"), "BID": N(KY, "data.rvBatchSql"),
            "ORG": N(KY, "data.organizationId")}
    read_cols = list(rmod.REVIEW_COLS)
    rv_titles = {"items": "Items of the review (search_item)", "balances": "Item balances (search_item_balance: material IN + location IN)",
                 "batch_balances": "Item batch balances (search_item_batch_balance)", "bins": "Bin locations (search_bin_location)", "uoms": "UOMs (search_uom)",
                 "batches": "Batches (search_batch)", "costs": "Current costs (sql_review_costs)", "prefix": "The default SA numbering rule (get_sa_prefix; department = org)"}
    rv = [("cai_" + REVIEW_NODES[k][len("sql_node_"):], k,
           [K.sql(REVIEW_NODES[k], "Review read: " + rv_titles[k], rmod.review_sql(k, **{t: refs[t] for t in rmod.REVIEW_TOKENS[k]}), read_cols)])
          for k in REVIEW_NODES]

    gate_small = ("{ route: [%s][0], code: [%s][0], message: [%s][0], reason: [%s][0], errorCode: [%s][0], lineCount: [%s][0] }"
                  % tuple(N(GT, "data." + f) for f in ("route", "code", "message", "reason", "errorCode", "lineCount")))

    def sres(tag, title, src, back_node=None, with_post=False):
        guard = "[%s][0]" % N(G, "data")
        entry = "null" if tag == "rej" else "[%s][0]" % N(E, "data")
        call_ = "submitResult(%s, %s, %s, %s, %s)" % (guard, entry, src, "[%s][0]" % N(back_node, "data") if back_node else "null",
                                                      "[%s][0]" % N(PO, "data") if with_post else "null")
        body = scode("result.js") + ("\nconst res = %s;\nconsole.log(\"submit result\", JSON.stringify({ route: res.route, code: res.code, message: res.message, "
                                     "action: res.action, job: res.job_id }));\nreturn res;" % call_)
        return [K.code("code_node_SS%sres" % tag, "Result (%s)" % title, body, SUB_RES),
                K.ret("return_node_SS%s" % tag, "Return (%s)" % title, [(f, N("code_node_SS%sres" % tag, "data." + f)) for f in SUB_RES])]

    guard_fields = ["route", "code", "message", "errorCode", "operation", "source", "saveAs", "pageStatus", "pageStatusIn", "saId", "scId", "key", "tenantId", "uid", "nonce",
                    "clone", "organizationId", "nickname", "adjustmentDate", "createAdjustment", "formScId"]
    entry_fields = ["route", "code", "message", "reason", "errorCode", "action", "prevStatus", "tenantId", "saId", "saNo", "scId", "storedStatus", "organizationId", "plantId",
                    "noType", "stockCountId", "dbNow", "lockN", "issuedReuse", "jobId", "jobStatus", "jobAction", "progressPercent", "progressMessage", "jobErrorCode",
                    "errorMessage", "lineCount"]
    keys_fields = ["route", "code", "message", "reason", "errorCode", "ok", "why", "itemIdsSql", "batchIdsSql", "storedSaId", "needStored", "needReview", "rvMatSql", "rvLocSql",
                   "rvUomSql", "rvBatchSql", "organizationId", "lineCount", "entryCount"]
    gate_fields = ["route", "code", "message", "reason", "errorCode", "allData", "saHeader", "lineCount", "entryCount", "movementCount", "numberIssued", "lineFingerprint",
                   "incomingFingerprint", "edited", "scFingerprint", "stockCountId", "partNames", "partChunks", "plantId", "organizationId"]
    post_fields = ["route", "code", "message", "errorCode", "request", "numberProps", "partCount", "lockRows", "needLock", "jobRows", "linesBack", "lineCount"]
    reads_block = [("cai_SSitems", "items", [K.sql("sql_node_SSitems", "Items of the lines (serial, costing method, stock control, code)", items, ["j"])]),
                   ("cai_SScost", "cost", [K.sql("sql_node_SScost", "Costing rows of those items in the organization: WA / FIFO counts per (material, batch, plant)",
                                                 cost, ["j"])]),
                   ("cai_SSstored", "stored", [K.sql("sql_node_SSstored", "COMPLETE: the stored lines before the writes (FP_SA_LINES)", stored, ["j"])]),
                   ("cai_SSreview", "review", [K.if_(ids, "if_SSreview", "IF REVIEW: the review chain's reads (CONTRACT §16 REVIEW_READS) in parallel",
                                                     V.is_(KY, "needReview", "YES"), [K.parallel("condition_all_SSrv", "The review chain's reads in parallel", rv)])])]

    nodes = [
        K.code(G, "Guard: operation, source, saveAs, pageStatus (Clone = Add), sa_id / sc_id, idempotency key, the review's org / date, session tenant + user",
               scode("guard.js"), guard_fields),
        K.if_(ids, "if_SSreject", "IF the request is invalid: answer, write nothing", V.is_(G, "route", "REJECT"), sres("rej", "invalid request", "[%s][0]" % N(G, "data"))),
        K.parallel("condition_all_SSfacts", "Facts and the stored Stock Count lines in parallel", [
            ("cai_SSfacts", "facts", [K.sql("sql_node_SSfacts", "Facts: this key's job; the stored SA (status, number, lock, open / latest jobs, number reuse) or the stored "
                                                                 "SC (statuses, Processing SA, open / latest jobs, SCR lock); DB clock", facts, Q.FACTS_COLS)]),
            ("cai_SSscLines", "sc lines", [K.sql("sql_node_SSscLines", "REVIEW: the stored Stock Count lines (FP_SC_LINES: STALE lines, scFingerprint)", sc_lines, ["j"])])]),
        K.code(E, "Entry: STATUS / this key's job; else the stored document decides (BUSY / STALE / STOP) and the action", scode("entry.js"), entry_fields,
               objects=("lockN", "progressPercent", "lineCount")),
        K.if_(ids, "if_SSanswer", "IF answered here (STATUS / BUSY / STALE / STOP): answer, write nothing", "'%s' != 'GO'" % N(E, "data.route"),
              sres("ans", "entry", "[%s][0]" % N(E, "data"))),
        K.code(KY, "Keys: the record (INVALID if none); STALE review lines; saReviewPrep (no SA = NOT_ELIGIBLE); form-visible eligibility; limits; the reads' ids",
               keys_code(chain_js), keys_fields, objects=("lineCount", "entryCount")),
        K.if_(ids, "if_SSkeysEnd", "IF the keys answered (INVALID / STALE / NOT_ELIGIBLE / STOP): answer, read nothing, write nothing", "'%s' != 'GO'" % N(KY, "data.route"),
              sres("keys", "keys", "[%s][0]" % N(KY, "data"))),
        K.parallel("condition_all_SSread", "The gate's reads in parallel (no row limits)", reads_block),
        K.code(GT, "Gate: eligibility, the classic's gates lifted (STOCK_ADJUSTMENT v24 / the shared review chain), entry checks, WA, limits -> the record / parts",
               gate_code(chain_js), gate_fields, arrays=("partNames", "partChunks"), objects=("allData", "saHeader", "lineCount", "entryCount", "movementCount", "edited")),
        K.if_(ids, "if_SSgateEnd", "IF the gate answered (NOT_ELIGIBLE / STOP): answer, write nothing", "'%s' != 'GO'" % N(GT, "data.route"), sres("gate", "gate", gate_small)),
        K.code(PO, "Post: the queue rows (the lock taken first, the COMPLETE_SA job QUEUED 2 minutes ahead, the request)", scode("post.js"), post_fields,
               arrays=("lockRows", "jobRows"), objects=("partCount", "lineCount")),
        K.if_(ids, "if_SSpostEnd", "IF nothing to write: answer", "'%s' != 'QUEUE'" % N(PO, "data.route"), sres("post", "post", "[%s][0]" % N(PO, "data"))),
        gate(ids, "cor_SSlock", "COMPLETE: SAC|<sa> / REVIEW: SCR|<sc> LOCK|<n+1> first?", PO, "needLock", [
            step_add(ids, "add_node_SSlock", "LOCK: gd_publish_step SAC|<sa> or SCR|<sc> / LOCK|<n> (unique tenant / job / step: a concurrent twin fails its run)", PO,
                     "lockRows")]),
        K.add(ids, "add_node_SSjob", "Job insert: COMPLETE_SA QUEUED, due in 2 minutes (unique idempotency key: a twin click fails its run)", JOB,
              [(p, N(PO, "data.jobRows." + p)) for p in JOB_ADD_COLS], labels={"organization_id": "Organization"}),
        K.code(RW, "Row: the new job's id, its S parts, which document write runs", scode("row.js"),
               ["ok", "jobId", "partRows", "partCount", "needDocParts", "writeAdd", "writeNumber", "writeNoNumber", "writeReview"], arrays=("partRows",),
               objects=("partCount",)),
        gate(ids, "cor_SSdocParts", "COMPLETE: the S|<nonce>|DOC parts (what A1 writes)?", RW, "needDocParts", [
            K.add(ids, "add_node_SSdocParts", "S|<nonce>|DOC|<nnn> payload parts", STEP, [(p, N(RW, "data.partRows." + p)) for p in PART_COLS],
                  labels={"organization_id": "Organization"})]),
        gate(ids, "cor_SSadd", "DIRECT: insert the Stock Adjustment?", RW, "writeAdd", [sa_add]),
        gate(ids, "cor_SSnum", "COMPLETE: header with the number props?", RW, "writeNumber", [sa_num]),
        gate(ids, "cor_SSnonum", "COMPLETE: header without the number props (an earlier job issued it)?", RW, "writeNoNumber", [sa_nonum]),
        gate(ids, "cor_SSreviewAdd", "REVIEW: insert the Stock Adjustment header?", RW, "writeReview", [review_add]),
        K.parallel("condition_all_SSafter", "Read-back after the document write in parallel", [
            ("cai_SShdr", "header", [K.sql("sql_node_SShdr", "Read-back: the Stock Adjustment this job wrote (sa_v2_job_id)", hdr, Q.HDR_COLS)]),
            ("cai_SSlines", "lines", [K.sql("sql_node_SSlines", "Read-back: its lines (FP_SA_LINES; DIRECT)", lines, ["j"])])]),
        K.code(LK, "Link: saId, saNo, issuedNo (+ DIRECT's lineFingerprint) into the request; DIRECT / REVIEW: the new SA's LOCK|1, REVIEW: its S parts", scode("link.js"),
               ["ok", "why", "saId", "saNo", "request", "needLink", "needLock", "needScParts", "lockRows", "jobRows"], arrays=("lockRows", "jobRows")),
        gate(ids, "cor_SSlock1", "DIRECT / REVIEW: the new SA's lock LOCK|1?", LK, "needLock", [
            step_add(ids, "add_node_SSlock1", "LOCK: gd_publish_step SAC|<sa> / LOCK|1", LK, "lockRows")]),
        gate(ids, "cor_SSscParts", "REVIEW: the S|<nonce>|SC parts (the incoming Stock Count record)?", LK, "needScParts", [
            K.add(ids, "add_node_SSscParts", "S|<nonce>|SC|<nnn> payload parts", STEP, [(p, N(RW, "data.partRows." + p)) for p in PART_COLS],
                  labels={"organization_id": "Organization"})]),
        gate(ids, "cor_SSlink", "The job's correlation / causation / request?", LK, "needLink", [
            job_update(ids, "update_node_SSlink", "Job: correlation SA|<sa>, causation, request (saId, saNo, issuedNo, lineFingerprint)", LK, "jobRows",
                       ["id", "correlation_id", "causation_id", "request_payload"])]),
        K.sql("sql_node_SSback", "Read-back: the job of this key, its SA's status / job link / number, the SA's latest lock, the S parts", back, Q.BACK_COLS),
        K.code("code_node_SSdue", "Due: the SA is Processing under this job's lock (and its parts are there) -> the job due now", scode("due.js"), ["dueRows", "needDue"],
               arrays=("dueRows",)),
        gate(ids, "cor_SSdue", "Job to make due?", "code_node_SSdue", "needDue", [
            K.update(ids, "update_node_SSdue", "Job due now (it was inserted 2 minutes ahead)", JOB, ("id", "in", N("code_node_SSdue", "data.dueRows.id")),
                     [("id", N("code_node_SSdue", "data.dueRows.id")), ("next_attempt_at", N("code_node_SSdue", "data.dueRows.next_attempt_at"))])]),
    ] + sres("done", "queued", "[%s][0]" % N(PO, "data"), "sql_node_SSback", True)
    return K.workflow([("operation", "string", "SUBMIT (default) or STATUS"),
                       ("source", "string", "FORM (default): the Stock Adjustment form | REVIEW: the Stock Count Review (a NEW Stock Adjustment)"),
                       ("saveAs", "string", "FORM: Completed"),
                       ("pageStatus", "string", "Add | Edit | Clone (Copy = Clone): the form's page_status; View is refused"),
                       ("sa_id", "string", "stock_adjustment.id (digits) for a FORM Edit and for STATUS; empty for Add / Clone / REVIEW"),
                       ("sc_id", "string", "stock_count.id (digits) for a REVIEW (and STATUS of its job)"),
                       ("idempotency_key", "string", "one per click and content (8-128 chars A-Z a-z 0-9 | : _ . -); optional for STATUS"),
                       ("form", "any", "FORM: the SA record (this.getValues() minus the helper keys); REVIEW: the SC record"),
                       ("organization_id", "string", "REVIEW: the organization (deptParentId / deptIds[0]) - the SA's organization and its numbering rule's department"),
                       ("nickname", "string", "REVIEW: adjusted_by"),
                       ("adjustment_date", "string", "REVIEW: YYYY-MM-DD (the client's date, as the classic Review's adjustmentDate)"),
                       ("create_adjustment", "string", "REVIEW: Yes | empty (the classic Review's createAdjustment)")],
                      SUB_RES, nodes)


BUILDERS = [("SA_V2_SUBMIT", build)]

if __name__ == "__main__":
    V.build(BUILDERS, os.path.join(HERE, "..", "..", "Stock Adjustment", "AsyncV2"), "--write" in sys.argv)
