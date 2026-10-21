"""IA_V2_WORKER (package C; CONTRACT.md section 8).

gen_worker() regenerates code/worker/*.js from tpl/smv2/code/worker_src_grv2/ (GR_COMPLETE_WORKER's JS; LOT's route, never
edited) with the IA names - command COMPLETE_IA, state COMMITTING_IA, error prefix IA_ with the hard codes of section 8 - and
the release rule of section 2: an unlock writes { id, item_assembly_status: prevStatus } only while the job owns the IA and
iaPrevStatusOk(prevStatus) (code/shared/ia_common.js: Draft only); an owned IA whose prevStatus is unknown gets no unlock and
the FAILED becomes REQUIRES_REVIEW IA_PREV_STATUS_UNKNOWN. No prevStatus default anywhere (asserted). finished_at = endNow.
build() = lib/v2build.build_worker with the section 8 config. The tick: PREPARE -> COMMIT A -> (SPLIT) COMMIT B; COMMIT I2
PARKs above 1,000 picks and the next tick resumes phase B.

usage: python3 build_worker.py [--write]      (or through the controller's build_ia.py)
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
OUT = os.path.join(REPO, "Item Assembly & BOM", "AsyncV2")
IA_TABLE = IDS["sources"]["sm_item_assembly"]

HARD_GR = ('["GRC_INVALID_REQUEST", "GRC_INVALID_DATA", "GRC_GR_NOT_FOUND", "GRC_NOT_LOCKED", "GRC_NOT_ELIGIBLE", "GRC_400", "GRC_401", "GRC_LINES_CHANGED", '
           '"GRC_STALE", "GRC_PO_CHANGED", "GRC_ENGINE_REFUSED", "JOB_ILLEGAL_TRANSITION"]')
# CONTRACT section 8: hard codes fail at once, no retry
HARD_IA = ('["IA_INVALID_REQUEST", "IA_INVALID_DATA", "IA_NOT_FOUND", "IA_NOT_LOCKED", "IA_NOT_ELIGIBLE", "IA_LINES_CHANGED", "IA_SPLIT_REQUIRED", "IA_PLAN_BROKEN", '
           '"IA_PLAN_SKIPPED", "JOB_ILLEGAL_TRANSITION"]')

# every unlock of the worker goes through this rule (appended to the generated _common.js after code/shared/ia_common.js).
# No `return {` literal: the linter reads a node's LAST one as its output
RELEASE_JS = r'''// the Item Assembly back to its status before the completion: only when this job owns it (ia id not "0") and prevStatus is in
// IA_PREV_STATUSES (Draft); an owned IA whose prevStatus is anything else keeps its lock and the job goes to REQUIRES_REVIEW
// IA_PREV_STATUS_UNKNOWN (no default)
const iaWorkerRelease = function iaWorkerRelease(iaId, prevStatus) {
  const id = String(iaId === undefined || iaId === null ? "" : iaId).trim();
  const rel = { unlockRows: [], result_code: "" };
  if (!/^[0-9]{1,20}$/.test(id) || id === "0") return rel;
  if (!iaPrevStatusOk(prevStatus)) return Object.assign(rel, { result_code: "IA_PREV_STATUS_UNKNOWN" });
  return Object.assign(rel, { unlockRows: [{ id: id, item_assembly_status: iaS(prevStatus) }] });
};
const IA_REVIEW_PREV = { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: IA_TEXT.prevUnknown, error_code: "IA_PREV_STATUS_UNKNOWN", error_message: IA_TEXT.prevUnknown };'''

SUBS = [
    ("GR_COMPLETE_WORKER", "IA_V2_WORKER"),
    ("GR_COMPLETE_PREPARE", "IA_V2_PREPARE"),
    ("GR_COMPLETE_COMMIT", "IA_V2_COMMIT"),
    ("COMPLETE_GR", "COMPLETE_IA"),
    ("COMMITTING_GR", "COMMITTING_IA"),
    (HARD_GR, HARD_IA),
    ("GRC_", "IA_"),
    ("the Goods Receiving back to its status before the submit", "the Item Assembly back to its status before the completion"),
    ("the Goods Receiving stays Processing", "the Item Assembly stays Processing"),
    ("completing this receipt died", "completing this Item Assembly died"),
    ("before the receipt was completed", "before the Item Assembly was completed"),
    ("for the purchase orders, the putaway and the finish", "for the receipt of the assembled item and the finish"),
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
        ('progress_message: "Under review: the completion stopped half-way", error_code: "IA_RECONCILIATION_MISMATCH", error_message: reason,',
         'progress_message: "Under review: the completion stopped half-way", error_code: "IA_RECONCILIATION_MISMATCH", error_message: IA_TEXT.review,'),
        ('''    return Object.assign(claimed, { route: "EXHAUST", failRows: [Object.assign({}, claim, { job_status: "FAILED", progress_message: "Not completed: temporary failures persisted", error_code: "IA_TRANSIENT_RETRIES_EXHAUSTED", error_message: "Temporary failures persisted; not saved: " + reason, error_details: JSON.stringify({ step: "IA_V2_WORKER", why: reason, attempts: attempts }), lease_owner: null, lease_expires_at: null, finished_at: pick.dbNow, row_version: rv + 2 })], unlockRows: /^[0-9]{1,20}$/.test(s(pick.grId)) ? [{ id: s(pick.grId), gr_status: s(item.prevStatus) || "Draft" }] : [], result_code: "IA_TRANSIENT_RETRIES_EXHAUSTED", result_message: reason, job_status: "FAILED" });''',
         '''    const rel = iaWorkerRelease(pick.grId, item.prevStatus);
    const end = rel.result_code ? Object.assign({}, IA_REVIEW_PREV, { error_details: JSON.stringify({ step: "IA_V2_WORKER", why: reason, prevStatus: item.prevStatus, attempts: attempts }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: temporary failures persisted", error_code: "IA_TRANSIENT_RETRIES_EXHAUSTED", error_message: "Temporary failures persisted; not completed.", error_details: JSON.stringify({ step: "IA_V2_WORKER", why: reason, attempts: attempts }) };
    return Object.assign(claimed, { route: "EXHAUST", failRows: [Object.assign({}, claim, end, { lease_owner: null, lease_expires_at: null, finished_at: pick.dbNow, row_version: rv + 2 })], unlockRows: rel.unlockRows, result_code: end.error_code, result_message: reason, job_status: end.job_status });'''),
    ],
    "after_prepare.js": [
        ('''  const unlock = /^[0-9]{1,20}$/.test(s(own.grId)) ? [{ id: s(own.grId), gr_status: s(own.prevStatus) || "Draft" }] : [];
''', ""),
        ('''    return Object.assign(base, { jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_message: "Not completed: " + (s(r.result_message) || "the completion could not be prepared").slice(0, 200), error_code: code, error_message: why, error_details: JSON.stringify({ step: "IA_V2_WORKER", why: why, attempts: n }), lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });''',
         '''    const rel = iaWorkerRelease(own.grId, own.prevStatus);
    const end = rel.result_code ? Object.assign({}, IA_REVIEW_PREV, { error_details: JSON.stringify({ step: "IA_V2_WORKER", why: why, prevStatus: own.prevStatus, attempts: n }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: " + (s(r.result_message) || "the completion could not be prepared").slice(0, 200), error_code: code, error_message: hard ? s(r.result_message) || why : "Temporary failures persisted; not completed.", error_details: JSON.stringify({ step: "IA_V2_WORKER", why: why, attempts: n }) };
    return Object.assign(base, { jobRows: [Object.assign({}, row, end, { lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: rel.unlockRows, needUnlock: rel.unlockRows.length ? "YES" : "NO", result_code: end.error_code, result_message: why, job_status: end.job_status });'''),
    ],
    "after_publish.js": [
        ('''    const unlock = /^[0-9]{1,20}$/.test(s(own.grId)) ? [{ id: s(own.grId), gr_status: s(own.prevStatus) || "Draft" }] : [];
    return Object.assign(base, { jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_message: "Not completed: the completion could not be finished", error_code: code, error_message: why, error_details: JSON.stringify({ step: "IA_V2_WORKER", why: why, attempts: n }), lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });''',
         '''    const rel = iaWorkerRelease(own.grId, own.prevStatus);
    const end = rel.result_code ? Object.assign({}, IA_REVIEW_PREV, { error_details: JSON.stringify({ step: "IA_V2_WORKER", why: why, prevStatus: own.prevStatus, attempts: n }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: the completion could not be finished", error_code: code, error_message: hard ? s(r.result_message) || why : "Temporary failures persisted; not completed.", error_details: JSON.stringify({ step: "IA_V2_WORKER", why: why, attempts: n }) };
    return Object.assign(base, { jobRows: [Object.assign({}, row, end, { lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: rel.unlockRows, needUnlock: rel.unlockRows.length ? "YES" : "NO", result_code: end.error_code, result_message: why, job_status: end.job_status });'''),
    ],
}

# finished_at = the real end time (bladexfunctions-a6's recipe, as LOT / SA V2): the node that reads the DB clock also notes the
# JS clock (jsAt); endNow(x) = x.dbNow + the seconds since. Applied after EDITS
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
JSAT_NODES = ("code_node_IWpick", "code_node_IWafterPrep", "code_node_IWpubAfter", "code_node_IWpub2After")
# not one GR word and no status default left in the generated JS (the bounded set lives in ia_common.js, appended to _common.js)
LEFT = ("Draft", "gr_status", "GRC_", "COMPLETE_GR", "COMMITTING_GR", "GR_COMPLETE", "Goods Receiving", "receipt was", "purchase", "putaway", "confirmation", "saved", "saving")


def declare_field(doc, node_id, name, after):
    """adds the string output `name` to a built code node's response_json right after `after`, with a key derived from the node
    id (no draw from wfkit's key stream) - tpl/sav2/build_worker.declare_field"""
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
            assert body.count(HARD_IA) == 1 and '"COMMITTING_IA"' in body and "PKC" in body, name
            body = body.rstrip("\n") + "\n" + V.include_js(HERE, "code/shared/ia_common.js") + "\n" + RELEASE_JS + "\n"
        open(os.path.join(DST, name), "w", encoding="utf-8").write(body)
    return names


# CONTRACT section 8 (verbatim)
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
RENAMES = [("code_node_RW", "code_node_IW"), ("sql_node_RW", "sql_node_IW"), ("get_cache_RW", "get_cache_IW"), ("set_cache_RW", "set_cache_IW"),
           ("update_node_RW", "update_node_IW"), ("add_node_RW", "add_node_IW"), ("workflow_node_RW", "workflow_node_IW"), ("cor_RW", "cor_IW"),
           ("cori_YRW", "cori_YIW"), ("cori_NRW", "cori_NIW"), ("if_RW", "if_IW"), ("ifBlock_TRW", "ifBlock_TIW"), ("ifBlock_FRW", "ifBlock_FIW"),
           ("loop_RW", "loop_IW"), ("return_node_RW", "return_node_IW"), ("gr_id", "ia_id"), ("grId", "iaId"),
           ("(phase A: revalidate, batches, inventory; or phase B on a resume)", "(phase A: revalidate, the Batch row, the component issue; or phase B on a resume)"),
           ("(purchase orders, putaway, the receipt)", "(phase B: the receipt of the assembled item, the item dates, the Item Assembly Completed)"),
           ("Goods Receiving back to its status before the submit", "Item Assembly back to its status before the completion"),
           ("Receipt lock", "Item Assembly lock"), ("receipt lock", "Item Assembly lock")]


def build():
    gen_worker()
    K._rng.seed(20261020)  # this workflow's response_json keys do not depend on what else was built before it
    cfg = V.worker_config(name="IA_V2_WORKER", code_dir=DST, ids_base=1799700000000, command="COMPLETE_IA",
                          states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA"], lock_join=IA_LOCK_JOIN, id_col=IA_ID_COL,
                          prev_col=IA_PREV_COL, corr_offset=4, id_alias="gr_id", prepare=("IA_V2_PREPARE", IDS["IA_V2_PREPARE"]),
                          commit=("IA_V2_COMMIT", IDS["IA_V2_COMMIT"]),
                          unlock=V.status_unlock(IA_TABLE, "item_assembly_status", {"item_assembly_status": "Item Assembly Status"}),
                          cache_prefix="ia_wrk_", renames=RENAMES)
    doc = V.build_worker(cfg)
    for nid in JSAT_NODES:
        declare_field(doc, nid, "jsAt", "dbNow")
    text = json.dumps(doc, ensure_ascii=False)
    left = [w for w in ("GR_COMPLETE", "COMPLETE_GR", "COMMITTING_GR", "GRC_", "_RW", "gr_id", "grId", "gr_status", "Goods Receiving", "receipt lock", "grc_wrk_", "LOT_", "SAVE_LOT",
                        "COMMITTING_LOT", "COMPLETE_SA", "SUBSTRING(j.correlation_id, 5)", "|| \\\"Draft\\\"") if w in text]
    assert not left, left
    assert text.count("SUBSTRING(j.correlation_id, 4)") >= 10, "correlation offset"
    # the poll takes COMPLETE_IA only (a REVERT_IA job of the same IA belongs to IA_REVERT_V2_WORKER)
    assert text.count("'COMPLETE_IA'") == 1 and "'REVERT_IA'" not in text and "COMMITTING_IA" in text and "ia_wrk_" in text
    return doc


BUILDERS = [("IA_V2_WORKER", build)]

if __name__ == "__main__":
    V.build(BUILDERS, OUT, "--write" in sys.argv)
