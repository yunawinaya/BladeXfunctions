"""SA_V2_WORKER (package C; CONTRACT.md section 8).

gen_worker() regenerates code/worker/*.js from tpl/smv2/code/worker/ (LOT_V2_WORKER's JS, f8's deployed copy) with the SA
names: command COMPLETE_SA, state COMMITTING_SA, error prefix SA_ with the hard codes of section 8, callee names, and the
release rule of CONTRACT section 2 - the shared helpers come from code/shared/sa_common.js (SA_PREV_STATUSES = Draft /
Cancelled), the unlock writes stock_adjustment_status; an owned Stock Adjustment whose prevStatus is not one of the two gets
no unlock and its FAILED becomes REQUIRES_REVIEW SA_PREV_STATUS_UNKNOWN. No prevStatus default anywhere (asserted).
build() = lib/v2build.build_worker with the section 8 config (correlation SA|<id>, offset 4; lock SAC|<id>). The tick is
unchanged: PREPARE -> COMMIT A -> (SPLIT) COMMIT B; COMMIT A2 PARKs above 1,000 entries and the next tick resumes it.

usage: python3 build_worker.py [--write]      (or through the controller's build_sa.py)
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

SRC = os.path.join(HERE, "tpl", "smv2", "code", "worker")
DST = os.path.join(HERE, "code", "worker")
IDS = json.load(open(os.path.join(HERE, "ids.json")))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "Stock Adjustment", "AsyncV2")
SA_TABLE = "Stock Adjustment:Table:%s" % IDS["tables"]["Stock Adjustment"]

HARD_LOT = ('["LOT_INVALID_REQUEST", "LOT_INVALID_DATA", "LOT_NOT_FOUND", "LOT_NOT_LOCKED", "LOT_NOT_ELIGIBLE", "LOT_LINES_CHANGED", "LOT_LEDGER_CHANGED", '
            '"LOT_TRANSIT_SHORTAGE", "LOT_RECON_SHORTAGE", "LOT_SPLIT_REQUIRED", "LOT_PLAN_BROKEN", "JOB_ILLEGAL_TRANSITION"]')
HARD_SA = ('["SA_INVALID_REQUEST", "SA_INVALID_DATA", "SA_NOT_FOUND", "SA_SC_NOT_FOUND", "SA_NOT_LOCKED", "SA_NOT_ELIGIBLE", "SA_LINES_CHANGED", "SA_SC_CHANGED", '
           '"SA_SPLIT_REQUIRED", "SA_PLAN_BROKEN", "SA_REVIEW_BUILD_FAILED", "JOB_ILLEGAL_TRANSITION"]')

# _common.js = the template's own part (PKC, dbAddSeconds) + code/shared/sa_common.js + this release rule (the template's
# lot_common.js copy and lotWorkerRelease are dropped). No `return {` literal: the linter reads a node's LAST one as its output.
RELEASE_JS = r'''// the Stock Adjustment back to the status before the completion: only when this job owns it (sa id not "0") and prevStatus is
// Draft / Cancelled (CONTRACT section 2); an owned Stock Adjustment whose prevStatus is anything else keeps its lock and the job
// goes to REQUIRES_REVIEW SA_PREV_STATUS_UNKNOWN (no default)
const saWorkerRelease = function saWorkerRelease(saId, prevStatus) {
  const id = String(saId === undefined || saId === null ? "" : saId).trim();
  const rel = { unlockRows: [], result_code: "" };
  if (!/^[0-9]{1,20}$/.test(id) || id === "0") return rel;
  if (!saPrevStatusOk(prevStatus)) return Object.assign(rel, { result_code: "SA_PREV_STATUS_UNKNOWN" });
  return Object.assign(rel, { unlockRows: [{ id: id, stock_adjustment_status: saS(prevStatus) }] });
};
const SA_REVIEW_PREV = { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the status to restore is unknown. Please contact support.",
  error_code: "SA_PREV_STATUS_UNKNOWN", error_message: "Under review: the status to restore is unknown. Please contact support." };'''
COMMON_CUT = "// SM V2 / Location Transfer - helpers every package uses"


def include_shared(rel):
    """a code/shared file for a code node WITHOUT its trailing node-test export statement. lib/v2build.include_js drops only the
    lines that start with "if (typeof module", but sa_common.js's export statement spans two lines: its dangling continuation
    line would be a SyntaxError in every node"""
    text = V.raw(HERE, rel)
    at = text.find("\nif (typeof module")
    if at >= 0:
        tail = text[at + 1:]
        assert tail.rstrip().endswith("};") and "module.exports" in tail and tail.count(";") == 1, (rel, tail[:200])
        text = text[:at]
    assert "{{" not in text and "module.exports" not in text, rel
    return text

SUBS = [
    ("LOT_V2_WORKER", "SA_V2_WORKER"),
    ("LOT_V2_PREPARE", "SA_V2_PREPARE"),
    ("LOT_V2_COMMIT", "SA_V2_COMMIT"),
    ("SAVE_LOT", "COMPLETE_SA"),
    ("COMMITTING_LOT", "COMMITTING_SA"),
    (HARD_LOT, HARD_SA),
    ("lotWorkerRelease", "saWorkerRelease"),
    ("LOT_REVIEW_PREV", "SA_REVIEW_PREV"),
    ("LOT_", "SA_"),
    ("the Location Transfer back to its status before the save", "the Stock Adjustment back to its status before the completion"),
    ("the Location Transfer stays Processing", "the Stock Adjustment stays Processing"),
    ("the run saving this transfer died", "the run completing this Stock Adjustment died"),
    ("before the transfer was saved", "before the Stock Adjustment was completed"),
    ("for the lines, the In Transit ledger and the header", "for the Stock Count, the items and the Stock Adjustment"),
    ("the save could not be prepared", "the completion could not be prepared"),
    ("Not completed: the save could not be completed", "Not completed: the completion could not be finished"),
    ("Under review: the save stopped half-way", "Under review: the completion stopped half-way"),
    ("without saving", "without writing"),
    ("so nothing was saved", "so nothing was written"),
    ("not saved", "not completed"),
]

# file -> [(old snippet, new snippet)], each must occur exactly once (after SUBS)
EDITS = {
    # PREPARE parks a job above 1,000 entries (controller ruling): READY_TO_COMMIT, lease cleared, due now -> no COMMIT call in
    # this tick; the next tick's poll claims it (READY_TO_COMMIT -> PUBLISH, no retry counted) and calls COMMIT A
    "mid.js": [('  if (status === "READY_TO_COMMIT" && s(job.lease_owner) === guard.leaseOwner) return Object.assign(base, { route: "PUBLISH", result_message: "publish" });\n',
               '  if (status === "READY_TO_COMMIT" && s(job.lease_owner) === guard.leaseOwner) return Object.assign(base, { route: "PUBLISH", result_message: "publish" });\n  if (status === "READY_TO_COMMIT" && !s(job.lease_owner)) return Object.assign(base, { result_message: "PREPARE parked the job (no lease, due " + s(job.next_attempt_at) + "): its COMMIT runs on the next tick" });\n')],
    # workerItem's object literal returned last would read, to the linter, as pick's output: name it first (same value)
    "pick.js": [("  return { jobId: s(row.id), organizationId: s(row.organization_id),", "  const item = { jobId: s(row.id), organizationId: s(row.organization_id),"),
                (' + s(row.claim_owner) : "" };\n};', ' + s(row.claim_owner) : "" };\n  return item;\n};')],
}

# finished_at = the real end time (controller recipe from bladexfunctions-a6, user: "fix it everywhere"; f8 did the same in LOT
# V2): the node that reads the DB clock also notes the JS clock (jsAt); endNow(x) = x.dbNow + the seconds since
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
JSAT_NODES = ("code_node_SWpick", "code_node_SWafterPrep", "code_node_SWpubAfter", "code_node_SWpub2After")


def declare_field(doc, node_id, name, after):
    """adds the string output `name` to a built code node's response_json right after `after`, with a key derived from the node
    id (no draw from wfkit's key stream) - the same helper as scratchpad/smv2/build_commit.py's (f8), written here"""
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


# not one LOT word, no status default left in the generated JS (the bounded set lives in sa_common.js, inside _common.js)
LEFT = ("LOT", "lotS", "lotPrev", "lotWorker", "Location Transfer", "transfer", "In Transit", "SMLT", "stock_movement", "Draft", "Cancelled", " save", "saving", "saved")


def gen_worker():
    """code/worker/*.js from tpl/smv2/code/worker/*.js (never edits the template)"""
    os.makedirs(DST, exist_ok=True)
    names = sorted(n for n in os.listdir(SRC) if n.endswith(".js"))
    assert names == ["_common.js", "after_prepare.js", "after_publish.js", "callee.js", "claim.js", "guard.js", "mid.js", "own.js", "pick.js", "plan.js", "result.js", "split.js"], names
    for name in names:
        body = open(os.path.join(SRC, name), encoding="utf-8").read()
        if name == "_common.js":
            assert body.count(COMMON_CUT) == 1, name
            body = body[: body.index(COMMON_CUT)]
        for a, b in SUBS:
            body = body.replace(a, b)
        for a, b in EDITS.get(name, []):
            assert body.count(a) == 1, (name, a[:80])
            body = body.replace(a, b)
        for a, b, n in END_EDITS.get(name, []):
            assert body.count(a) == n, (name, a[:80], body.count(a))
            body = body.replace(a, b)
        left = [w for w in LEFT if w in body]
        assert not left, (name, left)
        assert not re.search(r"prevStatus\)?\s*\|\|\s*\"", body), (name, "a prevStatus default")
        if name == "_common.js":
            assert body.count(HARD_SA) == 1 and '"COMMITTING_SA"' in body and "PKC" in body, name
            body = body.rstrip("\n") + "\n" + include_shared("code/shared/sa_common.js") + "\n" + RELEASE_JS + "\n"
        open(os.path.join(DST, name), "w", encoding="utf-8").write(body)
    return names


SA_LOCK_JOIN = """LEFT JOIN stock_adjustment g
    ON g.tenant_id = j.tenant_id
   AND g.is_deleted = 0
   AND j.correlation_id REGEXP '^SA\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('SAC|', SUBSTRING(j.correlation_id, 4))
                   AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
SA_ID_COL = "(CASE WHEN g.stock_adjustment_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
SA_PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.prevStatus')), NULL) AS prev_status"
RENAMES = [("code_node_RW", "code_node_SW"), ("sql_node_RW", "sql_node_SW"), ("get_cache_RW", "get_cache_SW"), ("set_cache_RW", "set_cache_SW"),
           ("update_node_RW", "update_node_SW"), ("add_node_RW", "add_node_SW"), ("workflow_node_RW", "workflow_node_SW"), ("cor_RW", "cor_SW"),
           ("cori_YRW", "cori_YSW"), ("cori_NRW", "cori_NSW"), ("if_RW", "if_SW"), ("ifBlock_TRW", "ifBlock_TSW"), ("ifBlock_FRW", "ifBlock_FSW"),
           ("loop_RW", "loop_SW"), ("return_node_RW", "return_node_SW"), ("gr_id", "sa_id"), ("grId", "saId"),
           ("(phase A: revalidate, batches, inventory; or phase B on a resume)", "(phase A: revalidate, lines, inventory; or phase B on a resume)"),
           ("(purchase orders, putaway, the receipt)", "(phase B: the Stock Count, the items, the Stock Adjustment)"),
           ("Goods Receiving back to its status before the submit", "Stock Adjustment back to its status before the completion"),
           ("Receipt lock", "Stock Adjustment lock"), ("receipt lock", "Stock Adjustment lock")]


def build():
    gen_worker()
    K._rng.seed(20261017)  # this workflow's response_json keys do not depend on what else was built before it
    cfg = V.worker_config(name="SA_V2_WORKER", code_dir=DST, ids_base=1799300000000, command="COMPLETE_SA",
                          states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA"], lock_join=SA_LOCK_JOIN, id_col=SA_ID_COL,
                          prev_col=SA_PREV_COL, corr_offset=4, id_alias="gr_id", prepare=("SA_V2_PREPARE", IDS["SA_V2_PREPARE"]),
                          commit=("SA_V2_COMMIT", IDS["SA_V2_COMMIT"]),
                          unlock=V.status_unlock(SA_TABLE, "stock_adjustment_status", {"stock_adjustment_status": "Stock Adjustment Status"}),
                          cache_prefix="sa_wrk_", renames=RENAMES)
    doc = V.build_worker(cfg)
    for nid in JSAT_NODES:
        declare_field(doc, nid, "jsAt", "dbNow")
    text = json.dumps(doc, ensure_ascii=False)
    left = [w for w in ("GR_COMPLETE", "COMPLETE_GR", "COMMITTING_GR", "GRC_", "_RW", "gr_id", "grId", "gr_status", "Goods Receiving", "receipt", "grc_wrk_", "LOT_", "SAVE_LOT",
                        "COMMITTING_LOT", "Location Transfer", "SMLT", "SUBSTRING(j.correlation_id, 5)") if w in text]
    assert not left, left
    assert text.count("SUBSTRING(j.correlation_id, 4)") >= 10, "correlation offset"
    assert text.count("'COMPLETE_SA'") == 1 and "COMMITTING_SA" in text and "sa_wrk_" in text
    return doc


BUILDERS = [("SA_V2_WORKER", build)]

if __name__ == "__main__":
    V.build(BUILDERS, OUT, "--write" in sys.argv)
