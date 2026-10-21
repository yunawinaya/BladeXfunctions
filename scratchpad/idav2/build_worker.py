"""IDA_V2_WORKER (package C; CONTRACT.md section 8).

gen_worker() regenerates code/worker/*.js from tpl/smv2/code/worker_src_grv2/ (GR_COMPLETE_WORKER's JS, never edited) with the IDA names -
command COMPLETE_IDA, state COMMITTING_IDA, error prefix IDA_ with the hard codes of section 8 - and the release rule of section 2: an
unlock writes { id, item_disassembly_status: prevStatus } only while the job owns the IDA and idaPrevStatusOk(prevStatus)
(code/shared/ida_common.js: Draft only); an owned IDA whose prevStatus is unknown gets no unlock and the FAILED becomes REQUIRES_REVIEW
IDA_PREV_STATUS_UNKNOWN. No prevStatus default anywhere (asserted). finished_at = endNow. build() = lib/v2build.build_worker with the
section 8 config (the IDA| lock join with g.is_deleted = 0, correlation offset 5). The tick: PREPARE -> COMMIT A -> (SPLIT) COMMIT B;
COMMIT D2 PARKs when either leg holds more than 1,000 movements and the next tick resumes phase B.

usage: python3 build_worker.py [--write]      (or through the controller's build_ida.py)
"""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402

SRC = os.path.join(HERE, "tpl", "smv2", "code", "worker_src_grv2")
DST = os.path.join(HERE, "code", "worker")
IDS = json.load(open(os.path.join(HERE, "ids.json")))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "Item Disassembly", "AsyncV2")
IDA_TABLE = "Item Disassembly:Table:" + IDS["tables"]["sm_item_disassembly"]

HARD_GR = ('["GRC_INVALID_REQUEST", "GRC_INVALID_DATA", "GRC_GR_NOT_FOUND", "GRC_NOT_LOCKED", "GRC_NOT_ELIGIBLE", "GRC_400", "GRC_401", "GRC_LINES_CHANGED", '
           '"GRC_STALE", "GRC_PO_CHANGED", "GRC_ENGINE_REFUSED", "JOB_ILLEGAL_TRANSITION"]')
# CONTRACT section 8: hard codes fail at once, no retry (+ the two batch codes: neither heals by retrying, contract ruling 14)
HARD_IDA = ('["IDA_INVALID_REQUEST", "IDA_INVALID_DATA", "IDA_NOT_FOUND", "IDA_NOT_LOCKED", "IDA_NOT_ELIGIBLE", "IDA_LINES_CHANGED", "IDA_SPLIT_REQUIRED", "IDA_PLAN_BROKEN", '
            '"IDA_PLAN_SKIPPED", "IDA_BATCH_CONFIG", "IDA_BATCH_DUPLICATE", "JOB_ILLEGAL_TRANSITION"]')

# every unlock of the worker goes through this rule (appended to the generated _common.js after code/shared/ida_common.js).
# No `return {` literal: the linter reads a node's LAST one as its output
RELEASE_JS = r'''// the Item Disassembly back to its status before the completion: only when this job owns it (ida id not "0") and prevStatus is in
// IDA_PREV_STATUSES (Draft); an owned IDA whose prevStatus is anything else keeps its lock and the job goes to REQUIRES_REVIEW
// IDA_PREV_STATUS_UNKNOWN (no default)
const idaWorkerRelease = function idaWorkerRelease(idaId, prevStatus) {
  const id = String(idaId === undefined || idaId === null ? "" : idaId).trim();
  const rel = { unlockRows: [], result_code: "" };
  if (!/^[0-9]{1,20}$/.test(id) || id === "0") return rel;
  if (!idaPrevStatusOk(prevStatus)) return Object.assign(rel, { result_code: "IDA_PREV_STATUS_UNKNOWN" });
  return Object.assign(rel, { unlockRows: [{ id: id, item_disassembly_status: idaS(prevStatus) }] });
};
const IDA_REVIEW_PREV = { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: IDA_TEXT.prevUnknown, error_code: "IDA_PREV_STATUS_UNKNOWN", error_message: IDA_TEXT.prevUnknown };
// the chain budget (controller ruling 10-21): a tick is one request chain, so a job above this many moves runs its PREPARE alone in a tick
const IDA_PREPARE_ALONE_MOVES = 2000;'''

SUBS = [
    ("GR_COMPLETE_WORKER", "IDA_V2_WORKER"),
    ("GR_COMPLETE_PREPARE", "IDA_V2_PREPARE"),
    ("GR_COMPLETE_COMMIT", "IDA_V2_COMMIT"),
    ("COMPLETE_GR", "COMPLETE_IDA"),
    ("COMMITTING_GR", "COMMITTING_IDA"),
    (HARD_GR, HARD_IDA),
    ("GRC_", "IDA_"),
    ("the Goods Receiving back to its status before the submit", "the Item Disassembly back to its status before the completion"),
    ("the Goods Receiving stays Processing", "the Item Disassembly stays Processing"),
    ("completing this receipt died", "completing this Item Disassembly died"),
    ("before the receipt was completed", "before the Item Disassembly was completed"),
    ("for the purchase orders, the putaway and the finish", "for the receipt of the recovered components and the finish"),
    ("the confirmation could not be prepared", "the completion could not be prepared"),
    ("Not completed: the completion could not be saved", "Not completed: the completion could not be finished"),
    ("so nothing was saved", "so nothing was written"),
    ("without saving", "without writing"),
]

# file -> [(old snippet, new snippet)], each must occur exactly once (after SUBS)
EDITS = {
    "plan.js": [('prevStatus: s(row.prev_status) || "Draft",', "prevStatus: s(row.prev_status),")],
    "pick.js": [('prevStatus: s(row.prev_status) || "Draft",', "prevStatus: s(row.prev_status),"),
                # workerItem's object literal returned last would read, to the linter, as pick's output: name it first (same value)
                ("  return { jobId: s(row.id), organizationId: s(row.organization_id),", "  const item = { jobId: s(row.id), organizationId: s(row.organization_id),"),
                (' + s(row.claim_owner) : "" };\n};', ' + s(row.claim_owner) : "" };\n  return item;\n};')],
    "claim.js": [
        ('prevStatus: item ? item.prevStatus : "Draft",', 'prevStatus: item ? item.prevStatus : "",'),
        ('progress_message: "Under review: the completion stopped half-way", error_code: "IDA_RECONCILIATION_MISMATCH", error_message: reason,',
         'progress_message: "Under review: the completion stopped half-way", error_code: "IDA_RECONCILIATION_MISMATCH", error_message: IDA_TEXT.review,'),
        ('''    return Object.assign(claimed, { route: "EXHAUST", failRows: [Object.assign({}, claim, { job_status: "FAILED", progress_message: "Not completed: temporary failures persisted", error_code: "IDA_TRANSIENT_RETRIES_EXHAUSTED", error_message: "Temporary failures persisted; not saved: " + reason, error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: reason, attempts: attempts }), lease_owner: null, lease_expires_at: null, finished_at: pick.dbNow, row_version: rv + 2 })], unlockRows: /^[0-9]{1,20}$/.test(s(pick.grId)) ? [{ id: s(pick.grId), gr_status: s(item.prevStatus) || "Draft" }] : [], result_code: "IDA_TRANSIENT_RETRIES_EXHAUSTED", result_message: reason, job_status: "FAILED" });''',
         '''    const rel = idaWorkerRelease(pick.grId, item.prevStatus);
    const end = rel.result_code ? Object.assign({}, IDA_REVIEW_PREV, { error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: reason, prevStatus: item.prevStatus, attempts: attempts }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: temporary failures persisted", error_code: "IDA_TRANSIENT_RETRIES_EXHAUSTED", error_message: IDA_TEXT.notCompleted, error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: reason, attempts: attempts }) };
    return Object.assign(claimed, { route: "EXHAUST", failRows: [Object.assign({}, claim, end, { lease_owner: null, lease_expires_at: null, finished_at: pick.dbNow, row_version: rv + 2 })], unlockRows: rel.unlockRows, result_code: end.error_code, result_message: reason, job_status: end.job_status });'''),
    ],
    "after_prepare.js": [
        ('''  const unlock = /^[0-9]{1,20}$/.test(s(own.grId)) ? [{ id: s(own.grId), gr_status: s(own.prevStatus) || "Draft" }] : [];
''', ""),
        ('jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", prepareResult:', 'jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", stopTick: "NO", prepareResult:'),
        ('''  if (status === "READY_TO_COMMIT") return Object.assign(base, { route: "PUBLISH", result_message: "prepared: " + s(r.result_message) });''',
         '''  // above IDA_PREPARE_ALONE_MOVES (the job's line_count = its moves) the PREPARE ends the tick: the lease released, due now - the next kick runs COMMIT A
  const moves = Number(job.line_count) || 0;
  if (status === "READY_TO_COMMIT" && ours && moves > IDA_PREPARE_ALONE_MOVES) {
    return Object.assign(base, { route: "STOP", stopTick: "YES", jobRows: [Object.assign({}, row, { next_attempt_at: dbNow, lease_owner: null, lease_expires_at: null })], needJobUpd: "YES",
      result_message: "prepared " + moves + " moves (above " + IDA_PREPARE_ALONE_MOVES + "): COMMIT runs on the next tick" });
  }
  if (status === "READY_TO_COMMIT") return Object.assign(base, { route: "PUBLISH", result_message: "prepared: " + s(r.result_message) });'''),
        ('''    return Object.assign(base, { jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_message: "Not completed: " + (s(r.result_message) || "the completion could not be prepared").slice(0, 200), error_code: code, error_message: why, error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: why, attempts: n }), lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });''',
         '''    const rel = idaWorkerRelease(own.grId, own.prevStatus);
    const end = rel.result_code ? Object.assign({}, IDA_REVIEW_PREV, { error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: why, prevStatus: own.prevStatus, attempts: n }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: " + (s(r.result_message) || "the completion could not be prepared").slice(0, 200), error_code: code, error_message: hard ? s(r.result_message) || why : IDA_TEXT.notCompleted, error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: why, attempts: n }) };
    return Object.assign(base, { jobRows: [Object.assign({}, row, end, { lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: rel.unlockRows, needUnlock: rel.unlockRows.length ? "YES" : "NO", result_code: end.error_code, result_message: why, job_status: end.job_status });'''),
    ],
    "after_publish.js": [
        ('''    const unlock = /^[0-9]{1,20}$/.test(s(own.grId)) ? [{ id: s(own.grId), gr_status: s(own.prevStatus) || "Draft" }] : [];
    return Object.assign(base, { jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_message: "Not completed: the completion could not be finished", error_code: code, error_message: why, error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: why, attempts: n }), lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });''',
         '''    const rel = idaWorkerRelease(own.grId, own.prevStatus);
    const end = rel.result_code ? Object.assign({}, IDA_REVIEW_PREV, { error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: why, prevStatus: own.prevStatus, attempts: n }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: the completion could not be finished", error_code: code, error_message: hard ? s(r.result_message) || why : IDA_TEXT.notCompleted, error_details: JSON.stringify({ step: "IDA_V2_WORKER", why: why, attempts: n }) };
    return Object.assign(base, { jobRows: [Object.assign({}, row, end, { lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: rel.unlockRows, needUnlock: rel.unlockRows.length ? "YES" : "NO", result_code: end.error_code, result_message: why, job_status: end.job_status });'''),
    ],
}

# finished_at = the real end time (as LOT / SA / IA V2): the node that reads the DB clock also notes the JS clock (jsAt); endNow(x) = x.dbNow
# + the seconds since. Applied after EDITS
ENDNOW = ('const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") '
          '|| entry.dbNow;')
END_EDITS = {
    "_common.js": [("p(d.getUTCSeconds());\n};\n", "p(d.getUTCSeconds());\n};\n" + ENDNOW + "\n", 1)],
    "pick.js": [("dbNow: dbNow,", "dbNow: dbNow, jsAt: String(Date.now()),", 1)],
    "claim.js": [("finished_at: pick.dbNow", "finished_at: endNow(pick)", 2)],
    "after_prepare.js": [('const base = { route: "END", dbNow: dbNow,', 'const base = { route: "END", dbNow: dbNow, jsAt: String(Date.now()),', 1),
                         ("finished_at: dbNow", "finished_at: endNow(base)", 1)],
    "after_publish.js": [('const base = { route: "END", dbNow: dbNow,', 'const base = { route: "END", dbNow: dbNow, jsAt: String(Date.now()),', 1),
                         ("finished_at: dbNow", "finished_at: endNow(base)", 1)],
}
JSAT_NODES = ("code_node_DWpick", "code_node_DWafterPrep", "code_node_DWpubAfter", "code_node_DWpub2After")
# not one GR word and no status default left in the generated JS (the bounded set lives in ida_common.js, appended to _common.js)
LEFT = ("Draft", "gr_status", "GRC_", "COMPLETE_GR", "COMMITTING_GR", "GR_COMPLETE", "Goods Receiving", "receipt was", "purchase", "putaway", "confirmation", "saved", "saving")


def declare_field(doc, node_id, name, after):
    """adds the string output `name` to a built code node's response_json right after `after`, with a key derived from the node id (no
    draw from wfkit's key stream) - tpl/iav2/build_worker.declare_field"""
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


def node_of(doc, node_id):
    found = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("id") == node_id and n.get("type"):
                found.append(n)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    assert len(found) == 1, (node_id, len(found))
    return found[0]


def prepare_alone(doc, cfg, res_fields):
    """the chain budget (controller ruling 10-21): the read-back after PREPARE also returns the job's line_count (= its moves); above
    IDA_PREPARE_ALONE_MOVES after_prepare releases the lease (due now) and this gate ends the tick: the final read, the answer, a return
    (a return node inside the loop ends the whole run). Applied to the pre-rename build (RW names)"""
    ids = K.Ids(1801290000000)
    pb = node_of(doc, "sql_node_RWprepBack")
    sql = pb["data"]["script"]["code"]
    assert sql.count("       j.error_details,\n") == 1, "prepBack anchor"
    pb["data"]["script"]["code"] = sql.replace("       j.error_details,\n", "       j.error_details,\n       j.line_count,\n")
    rj = pb["data"]["response_json"]
    names = [r["name"] for r in rj]
    rj.insert(names.index("error_details") + 1, {"key": "js" + hashlib.md5(b"sql_node_RWprepBack|line_count").hexdigest()[:6], "name": "line_count", "title": "line_count",
                                                 "description": "", "bsonType": "string", "isExpand": False, "children": []})
    declare_field(doc, "code_node_RWafterPrep", "stopTick", "needUnlock")
    fin = node_of(doc, "sql_node_RWfinal")
    stop_final = K.sql("sql_node_RWstopFinal", "Read-back: the planned jobs (the tick ends after this PREPARE)", fin["data"]["script"]["code"], [r["name"] for r in fin["data"]["response_json"]])
    stop_res = K.code("code_node_RWstopRes", "Result (PREPARED: the tick ends after a PREPARE above 2,000 moves)",
                      V.wcode(cfg, "result.js", {"__PATH__": "PREPARED", "__PLAN__": "[%s][0]" % V.N("code_node_RWplan", "data"), "__ROWS__": "[%s][0]" % V.N("sql_node_RWstopFinal", "data")}),
                      res_fields)
    stop_ret = K.ret("return_node_RWstop", "Return (the tick ends: COMMIT A runs on the next kick)", [(f, V.N("code_node_RWstopRes", "data." + f)) for f in res_fields])
    blk = node_of(doc, "ifBlock_TRWprep")["blocks"]
    assert [b["id"] for b in blk][-1] == "cor_RWprepJob", [b["id"] for b in blk]
    blk.append(V.gate(ids, "cor_RWprepStop", "Above 2,000 moves: end the tick after this PREPARE?", "code_node_RWafterPrep", "stopTick", [stop_final, stop_res, stop_ret]))
    return doc


def gen_worker():
    """code/worker/*.js from tpl/smv2/code/worker_src_grv2/*.js (never edits the template)"""
    os.makedirs(DST, exist_ok=True)
    names = sorted(n for n in os.listdir(SRC) if n.endswith(".js"))
    assert names == ["_common.js", "after_prepare.js", "after_publish.js", "callee.js", "claim.js", "guard.js", "mid.js", "own.js", "pick.js", "plan.js", "result.js", "split.js"], names
    for name in names:
        body = open(os.path.join(SRC, name), encoding="utf-8").read()
        for a, b in SUBS:
            body = body.replace(a, b)
        for a, b in EDITS.get(name, []):
            assert body.count(a) == 1, (name, a[:80], body.count(a))
            body = body.replace(a, b)
        for a, b, n in END_EDITS.get(name, []):
            assert body.count(a) == n, (name, a[:80], body.count(a))
            body = body.replace(a, b)
        left = [w for w in LEFT if w in body]
        assert not left, (name, left)
        assert not re.search(r"prevStatus\)?\s*\|\|\s*\"", body), (name, "a prevStatus default")
        if name == "_common.js":
            assert body.count(HARD_IDA) == 1 and '"COMMITTING_IDA"' in body and "PKC" in body, name
            body = body.rstrip("\n") + "\n" + V.include_js(HERE, "code/shared/ida_common.js") + "\n" + RELEASE_JS + "\n"
        open(os.path.join(DST, name), "w", encoding="utf-8").write(body)
    return names


# CONTRACT section 8 (verbatim)
IDA_LOCK_JOIN = """LEFT JOIN sm_item_disassembly g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^IDA\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 5) AS UNSIGNED)
   AND g.is_deleted = 0
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('IDC|', SUBSTRING(j.correlation_id, 5))
                   AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
IDA_ID_COL = "(CASE WHEN g.item_disassembly_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
IDA_PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status"
RENAMES = [("code_node_RW", "code_node_DW"), ("sql_node_RW", "sql_node_DW"), ("get_cache_RW", "get_cache_DW"), ("set_cache_RW", "set_cache_DW"),
           ("update_node_RW", "update_node_DW"), ("add_node_RW", "add_node_DW"), ("workflow_node_RW", "workflow_node_DW"), ("cor_RW", "cor_DW"),
           ("cori_YRW", "cori_YDW"), ("cori_NRW", "cori_NDW"), ("if_RW", "if_DW"), ("ifBlock_TRW", "ifBlock_TDW"), ("ifBlock_FRW", "ifBlock_FDW"),
           ("loop_RW", "loop_DW"), ("return_node_RW", "return_node_DW"), ("gr_id", "ida_id"), ("grId", "idaId"),
           ("(phase A: revalidate, batches, inventory; or phase B on a resume)", "(phase A: revalidate, the Batch rows, the source issue; or phase B on a resume)"),
           ("(purchase orders, putaway, the receipt)", "(phase B: the receipt of the recovered components, the line numbers and item dates, the Item Disassembly Completed)"),
           ("Goods Receiving back to its status before the submit", "Item Disassembly back to its status before the completion"),
           ("Receipt lock", "Item Disassembly lock"), ("receipt lock", "Item Disassembly lock")]


def build():
    gen_worker()
    K._rng.seed(20261022)  # this workflow's response_json keys do not depend on what else was built before it
    cfg = V.worker_config(name="IDA_V2_WORKER", code_dir=DST, ids_base=1801200000000, command="COMPLETE_IDA",
                          states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"], lock_join=IDA_LOCK_JOIN, id_col=IDA_ID_COL,
                          prev_col=IDA_PREV_COL, corr_offset=5, id_alias="gr_id", prepare=("IDA_V2_PREPARE", IDS["IDA_V2_PREPARE"]),
                          commit=("IDA_V2_COMMIT", IDS["IDA_V2_COMMIT"]),
                          unlock=V.status_unlock(IDA_TABLE, "item_disassembly_status", {"item_disassembly_status": "Item Disassembly Status"}),
                          cache_prefix="ida_wrk_", renames=[])
    # renames after the PREPARE-alone exit is added (V.build_worker applies cfg renames the same way: a text replace of the JSON)
    doc = prepare_alone(V.build_worker(cfg), cfg, ["worker_route", "processed", "jobs", "job_id", "job_status", "result_code", "result_message", "gr_id", "evidence"])
    text = json.dumps(doc, ensure_ascii=False)
    for a, b in RENAMES:
        text = text.replace(a, b)
    doc = json.loads(text)
    for nid in JSAT_NODES:
        declare_field(doc, nid, "jsAt", "dbNow")
    text = json.dumps(doc, ensure_ascii=False)
    left = [w for w in ("GR_COMPLETE", "COMPLETE_GR", "COMMITTING_GR", "GRC_", "_RW", "gr_id", "grId", "gr_status", "Goods Receiving", "receipt lock", "grc_wrk_", "LOT_", "SAVE_LOT",
                        "COMMITTING_LOT", "COMPLETE_SA", "COMPLETE_IA\\\"", "IAC|", "SUBSTRING(j.correlation_id, 4)", "|| \\\"Draft\\\"") if w in text]
    assert not left, left
    assert text.count("SUBSTRING(j.correlation_id, 5)") >= 10, "correlation offset"
    # the poll takes COMPLETE_IDA only
    assert text.count("'COMPLETE_IDA'") == 1 and "COMMITTING_IDA" in text and "ida_wrk_" in text
    return doc


BUILDERS = [("IDA_V2_WORKER", build)]

if __name__ == "__main__":
    V.build(BUILDERS, OUT, "--write" in sys.argv)
