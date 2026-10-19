"""LOT_V2_WORKER (package C; CONTRACT.md section 8).

gen_worker() regenerates code/worker/*.js from code/worker_src_grv2/ (GR_COMPLETE_WORKER's JS, WP0's unchanged copy) with the
LOT names, and one real change: NO `prevStatus || "Draft"` default anywhere - an unlock is written only when
lotPrevStatusOk(prevStatus); a transfer this job owns whose prevStatus is unknown gets no unlock and the FAILED becomes
REQUIRES_REVIEW LOT_PREV_STATUS_UNKNOWN. build() = lib/v2build.build_worker with the section 8 config.

usage: python3 build_lot.py [--write] LOT_V2_WORKER   (or: python3 build_worker.py  - regenerates code/worker only)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import v2build as V  # noqa: E402
from build_commit import declare_field  # noqa: E402

SRC = os.path.join(HERE, "code", "worker_src_grv2")
DST = os.path.join(HERE, "code", "worker")
IDS = json.load(open(os.path.join(HERE, "ids.json")))
LOT_TABLE = "Location Transfer:Table:2013791389687349250"

HARD_GR = ('["GRC_INVALID_REQUEST", "GRC_INVALID_DATA", "GRC_GR_NOT_FOUND", "GRC_NOT_LOCKED", "GRC_NOT_ELIGIBLE", "GRC_400", "GRC_401", "GRC_LINES_CHANGED", '
           '"GRC_STALE", "GRC_PO_CHANGED", "GRC_ENGINE_REFUSED", "JOB_ILLEGAL_TRANSITION"]')
HARD_LOT = ('["LOT_INVALID_REQUEST", "LOT_INVALID_DATA", "LOT_NOT_FOUND", "LOT_NOT_LOCKED", "LOT_NOT_ELIGIBLE", "LOT_LINES_CHANGED", "LOT_LEDGER_CHANGED", '
            '"LOT_TRANSIT_SHORTAGE", "LOT_RECON_SHORTAGE", "LOT_SPLIT_REQUIRED", "LOT_PLAN_BROKEN", "JOB_ILLEGAL_TRANSITION"]')

# the release rule every unlock of the worker goes through (appended to the generated _common.js)
RELEASE_JS = r'''// the transfer back to the status before the save: only when this job owns it (lot id not "0") and prevStatus is Draft /
// In Progress; an owned transfer whose prevStatus is unknown keeps its lock and the job goes to REQUIRES_REVIEW (no default)
const lotWorkerRelease = function lotWorkerRelease(lotId, prevStatus) {
  const id = String(lotId === undefined || lotId === null ? "" : lotId).trim();
  if (!/^[0-9]{1,20}$/.test(id) || id === "0") return { unlockRows: [], result_code: "" };
  if (!lotPrevStatusOk(prevStatus)) return { unlockRows: [], result_code: "LOT_PREV_STATUS_UNKNOWN" };
  return { unlockRows: [{ id: id, stock_movement_status: lotS(prevStatus) }], result_code: "" };
};
const LOT_REVIEW_PREV = { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the status to restore is unknown. Please contact support.",
  error_code: "LOT_PREV_STATUS_UNKNOWN", error_message: "Under review: the status to restore is unknown. Please contact support." };'''

SUBS = [
    ("GR_COMPLETE_WORKER", "LOT_V2_WORKER"),
    ("GR_COMPLETE_PREPARE", "LOT_V2_PREPARE"),
    ("GR_COMPLETE_COMMIT", "LOT_V2_COMMIT"),
    ("COMPLETE_GR", "SAVE_LOT"),
    ("COMMITTING_GR", "COMMITTING_LOT"),
    (HARD_GR, HARD_LOT),
    ("GRC_", "LOT_"),
    ("the Goods Receiving back to its status before the submit", "the Location Transfer back to its status before the save"),
    ("the Goods Receiving stays Processing", "the Location Transfer stays Processing"),
    ("completing this receipt died", "saving this transfer died"),
    ("before the receipt was completed", "before the transfer was saved"),
    ("for the purchase orders, the putaway and the finish", "for the lines, the In Transit ledger and the header"),
    ("the confirmation could not be prepared", "the save could not be prepared"),
    ("Not completed: the completion could not be saved", "Not completed: the save could not be completed"),
]

# file -> [(old snippet, new snippet)], each must occur exactly once
EDITS = {
    "plan.js": [('prevStatus: s(row.prev_status) || "Draft",', "prevStatus: s(row.prev_status),")],
    "pick.js": [('prevStatus: s(row.prev_status) || "Draft",', "prevStatus: s(row.prev_status),")],
    "claim.js": [
        ('prevStatus: item ? item.prevStatus : "Draft",', 'prevStatus: item ? item.prevStatus : "",'),
        ('progress_message: "Under review: the completion stopped half-way", error_code: "LOT_RECONCILIATION_MISMATCH", error_message: reason,',
         'progress_message: "Under review: the save stopped half-way", error_code: "LOT_RECONCILIATION_MISMATCH", error_message: "Under review: the save stopped half-way. Please contact support.",'),
        ('''    return Object.assign(claimed, { route: "EXHAUST", failRows: [Object.assign({}, claim, { job_status: "FAILED", progress_message: "Not completed: temporary failures persisted", error_code: "LOT_TRANSIENT_RETRIES_EXHAUSTED", error_message: "Temporary failures persisted; not saved: " + reason, error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: reason, attempts: attempts }), lease_owner: null, lease_expires_at: null, finished_at: pick.dbNow, row_version: rv + 2 })], unlockRows: /^[0-9]{1,20}$/.test(s(pick.grId)) ? [{ id: s(pick.grId), gr_status: s(item.prevStatus) || "Draft" }] : [], result_code: "LOT_TRANSIENT_RETRIES_EXHAUSTED", result_message: reason, job_status: "FAILED" });''',
         '''    const rel = lotWorkerRelease(pick.grId, item.prevStatus);
    const end = rel.result_code ? Object.assign({}, LOT_REVIEW_PREV, { error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: reason, prevStatus: item.prevStatus, attempts: attempts }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: temporary failures persisted", error_code: "LOT_TRANSIENT_RETRIES_EXHAUSTED", error_message: "Temporary failures persisted; not saved.", error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: reason, attempts: attempts }) };
    return Object.assign(claimed, { route: "EXHAUST", failRows: [Object.assign({}, claim, end, { lease_owner: null, lease_expires_at: null, finished_at: pick.dbNow, row_version: rv + 2 })], unlockRows: rel.unlockRows, result_code: end.error_code, result_message: reason, job_status: end.job_status });'''),
    ],
    "after_prepare.js": [
        ('''  const unlock = /^[0-9]{1,20}$/.test(s(own.grId)) ? [{ id: s(own.grId), gr_status: s(own.prevStatus) || "Draft" }] : [];
''', ""),
        ('''    return Object.assign(base, { jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_message: "Not completed: " + (s(r.result_message) || "the save could not be prepared").slice(0, 200), error_code: code, error_message: why, error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: why, attempts: n }), lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });''',
         '''    const rel = lotWorkerRelease(own.grId, own.prevStatus);
    const end = rel.result_code ? Object.assign({}, LOT_REVIEW_PREV, { error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: why, prevStatus: own.prevStatus, attempts: n }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: " + (s(r.result_message) || "the save could not be prepared").slice(0, 200), error_code: code, error_message: hard ? s(r.result_message) || why : "Temporary failures persisted; not saved.", error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: why, attempts: n }) };
    return Object.assign(base, { jobRows: [Object.assign({}, row, end, { lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: rel.unlockRows, needUnlock: rel.unlockRows.length ? "YES" : "NO", result_code: end.error_code, result_message: why, job_status: end.job_status });'''),
    ],
    "after_publish.js": [
        ('''    const unlock = /^[0-9]{1,20}$/.test(s(own.grId)) ? [{ id: s(own.grId), gr_status: s(own.prevStatus) || "Draft" }] : [];
    return Object.assign(base, { jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_message: "Not completed: the save could not be completed", error_code: code, error_message: why, error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: why, attempts: n }), lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });''',
         '''    const rel = lotWorkerRelease(own.grId, own.prevStatus);
    const end = rel.result_code ? Object.assign({}, LOT_REVIEW_PREV, { error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: why, prevStatus: own.prevStatus, attempts: n }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: the save could not be completed", error_code: code, error_message: hard ? s(r.result_message) || why : "Temporary failures persisted; not saved.", error_details: JSON.stringify({ step: "LOT_V2_WORKER", why: why, attempts: n }) };
    return Object.assign(base, { jobRows: [Object.assign({}, row, end, { lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: rel.unlockRows, needUnlock: rel.unlockRows.length ? "YES" : "NO", result_code: end.error_code, result_message: why, job_status: end.job_status });'''),
    ],
}

# finished_at = the real end time (bladexfunctions-a6's recipe): the node that reads the DB clock also notes the JS clock (jsAt);
# endNow(x) = x.dbNow + the seconds since. Applied after EDITS (their snippets keep GR's text)
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

LEFT = ("Draft", "gr_status", "GRC_", "COMPLETE_GR", "COMMITTING_GR", "GR_COMPLETE", "Goods Receiving", "receipt", "purchase", "putaway", "confirmation")


def gen_worker():
    """code/worker/*.js from code/worker_src_grv2/*.js (never edits the source)"""
    os.makedirs(DST, exist_ok=True)
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".js"):
            continue
        body = open(os.path.join(SRC, name), encoding="utf-8").read()
        for a, b in SUBS:
            body = body.replace(a, b)
        for a, b in EDITS.get(name, []):
            assert body.count(a) == 1, (name, a[:80])
            body = body.replace(a, b)
        for a, b, n in END_EDITS.get(name, []):
            assert body.count(a) == n, (name, a[:80], body.count(a))
            body = body.replace(a, b)
        if name == "_common.js":
            assert body.count(HARD_LOT) == 1 and '"COMMITTING_LOT"' in body, name
            body = body.rstrip("\n") + "\n" + V.include_js(HERE, "code/shared/lot_common.js") + "\n" + RELEASE_JS + "\n"
        else:
            left = [w for w in LEFT if w in body]
            assert not left, (name, left)
        open(os.path.join(DST, name), "w", encoding="utf-8").write(body)


LOT_LOCK_JOIN = """LEFT JOIN sm_location_transfer g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^LOT\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 5) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('SMLT|', SUBSTRING(j.correlation_id, 5)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
LOT_ID_COL = "(CASE WHEN g.stock_movement_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
LOT_PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status"
RENAMES = [("code_node_RW", "code_node_LW"), ("sql_node_RW", "sql_node_LW"), ("get_cache_RW", "get_cache_LW"), ("set_cache_RW", "set_cache_LW"),
           ("update_node_RW", "update_node_LW"), ("add_node_RW", "add_node_LW"), ("workflow_node_RW", "workflow_node_LW"), ("cor_RW", "cor_LW"),
           ("cori_YRW", "cori_YLW"), ("cori_NRW", "cori_NLW"), ("if_RW", "if_LW"), ("ifBlock_TRW", "ifBlock_TLW"), ("ifBlock_FRW", "ifBlock_FLW"),
           ("loop_RW", "loop_LW"), ("return_node_RW", "return_node_LW"), ("gr_id", "lot_id"), ("grId", "lotId"),
           ("(phase A: revalidate, batches, inventory; or phase B on a resume)", "(phase A: revalidate, inventory; or phase B on a resume)"),
           ("(purchase orders, putaway, the receipt)", "(phase B: the lines, the In Transit ledger, the header)"),
           ("Goods Receiving back to its status before the submit", "Location Transfer back to its status before the save"),
           ("Receipt lock", "Transfer lock"), ("receipt lock", "transfer lock")]


def build():
    gen_worker()
    cfg = V.worker_config(name="LOT_V2_WORKER", code_dir=DST, ids_base=1799100000000, command="SAVE_LOT",
                          states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_LOT"], lock_join=LOT_LOCK_JOIN, id_col=LOT_ID_COL,
                          prev_col=LOT_PREV_COL, corr_offset=5, id_alias="gr_id", prepare=("LOT_V2_PREPARE", IDS["LOT_V2_PREPARE"]),
                          commit=("LOT_V2_COMMIT", IDS["LOT_V2_COMMIT"]),
                          unlock=V.status_unlock(LOT_TABLE, "stock_movement_status", {"stock_movement_status": "Stock Movement Status"}),
                          cache_prefix="lot_wrk_", renames=RENAMES)
    doc = V.build_worker(cfg)
    text = json.dumps(doc, ensure_ascii=False)
    left = [w for w in ("GR_COMPLETE", "COMPLETE_GR", "COMMITTING_GR", "GRC_", "_RW", "gr_id", "grId", "gr_status", "Goods Receiving", "receipt", "grc_wrk_",
                        "SUBSTRING(j.correlation_id, 4)") if w in text]
    assert not left, left
    assert text.count("SUBSTRING(j.correlation_id, 5)") >= 10, "correlation offset"
    for nid in ("code_node_LWpick", "code_node_LWafterPrep", "code_node_LWpubAfter", "code_node_LWpub2After"):
        declare_field(doc, nid, "jsAt", "dbNow")
    return doc


BUILDERS = [("LOT_V2_WORKER", build)]

if __name__ == "__main__":
    gen_worker()
    print("code/worker regenerated:", ", ".join(sorted(os.listdir(DST))))
