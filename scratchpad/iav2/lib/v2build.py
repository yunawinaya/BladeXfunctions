"""Generic V2 workflow-builder helpers and the WORKER scaffolding, COPIED (not imported) from scratchpad/grv2/build_grv2.py
(GR Completion V2, deployed dev 2026-10-15). What was a GR module global is an explicit argument here:

  - the table / workflow constants, column lists and node helpers (N, is_, gate, call, job_update, step_add, sub,
    wrap_sql / wrap_doc_sql) are unchanged;
  - build_worker(cfg) is build_grv2.build_worker() with every GR-specific global taken from `cfg` (worker_config());
    gr_worker_config() / pw_worker_config() rebuild GR_COMPLETE_WORKER / PUTAWAY_ASYNC_WORKER exactly
    (test/lib_smoke.py checks both against the originals: same JSON).

Nothing here writes a file or touches a database.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SMV2 = os.path.dirname(HERE)
SCRATCH = os.path.dirname(SMV2)
sys.path.insert(0, HERE)
import wfkit as K  # noqa: E402

# ------------------------------------------------------------------------------------------- shared tables / workflows
JOB = "GD Async Job:Table:2104845286495150081"
STEP = "GD Publish Step:Table:2105131615547461634"
IT = "In Transit Detail:Table:2080477944160923650"
ITEM = "Item:Table:1901546842240438273"
ENGINE = ("INVENTORY_BULK_APPLY", "2109916822821744641")
TOKENS = ("INVENTORY_LOCK_TOKENS", "2105936479113383937")
JOB_PROPS = ["id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "row_version", "error_code", "error_message", "error_details", "finished_at"]
STEP_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "finished_at", "inventory_operation_id", "result_ref",
              "error_code", "error_message"]
RES_FIELDS = ["job_id", "job_status", "path", "result_code", "result_message", "evidence"]
# add_node_ITrows (GOODS_RECEIVING); LOT's add_node_LOTmainCreate / LOTreconCreate = these + received_date
IT_COLS = ["doc_type", "doc_id", "doc_no", "doc_line_id", "line_no", "parent_id", "parent_no", "parent_line_id", "material_id", "item_code", "item_name", "item_desc",
           "item_uom", "batch_id", "handling_unit_id", "plant_id", "organization_id", "transit_bin", "from_plant_id", "from_bin", "from_category", "to_plant_id",
           "to_bin", "to_category", "transit_qty", "received_qty", "open_qty", "status", "transit_date", "remark", "target_doc_type", "target_doc_id",
           "target_doc_no", "target_doc_line_id", "source_transit_id"]
JOB_ADD_COLS = ["organization_id", "plant_id", "command", "idempotency_key", "job_status", "progress_percent", "progress_message", "attempt_count", "row_version",
                "cancel_requested", "next_attempt_at", "request_payload", "causation_id", "correlation_id", "line_count", "queued_at"]
# the payload-part add (PREPARE's add_node_RPparts / add_node_PPparts)
PART_COLS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]


# ------------------------------------------------------------------------------------------- node helpers
def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def raw(root, path):
    """a source file's text (build_grv2.raw with the root explicit)"""
    with open(os.path.join(root, path), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def include_js(root, path):
    """a shared JS file (code/shared/*.js) for a code node: its text without the node-test export line(s) that start with
    "if (typeof module" (scratchpad/gdc/build_ts.py's rule); a platform token left in it is an error"""
    text = "\n".join(l for l in raw(root, path).split("\n") if not l.startswith("if (typeof module"))
    assert "{{" not in text, path + ": a shared file must not hold a platform token"
    return text


def is_(node, field, value):
    return "'%s' == '%s'" % (N(node, "data." + field), value)


def gate(ids, nid, title, src, flag, nodes):
    return K.when_yes(ids, nid, title, "node.%s.data.%s" % (src, flag), flag, nodes)


def call(ids, nid, title, wf, params):
    """params: (prop, value) references, or (prop, value, "value") literals"""
    n = K.call(ids, nid, title, wf[0], wf[1], [(p[0], p[1]) for p in params])
    for item, p in zip(n["data"]["body_params"]["list"], params):
        if len(p) > 2:
            item["valueType"] = p[2]
    return n


def job_update(ids, nid, title, src, field, props=JOB_PROPS):
    return K.update(ids, nid, title, JOB, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in props])


def step_add(ids, nid, title, src, field):
    return K.add(ids, nid, title, STEP, [(p, N(src, "data.%s.%s" % (field, p))) for p in STEP_PROPS], labels={"organization_id": "Organization"})


def status_unlock(table, column, labels=None):
    """the status-based document lock release (build_grv2.gr_unlock with the table / column explicit): update-node by id,
    props id + <column> from <src>.data.<field>"""
    def unlock(ids, nid, title, src, field="unlockRows"):
        return K.update(ids, nid, title, table, ("id", "in", N(src, "data.%s.id" % field)),
                        [("id", N(src, "data.%s.id" % field)), (column, N(src, "data.%s.%s" % (field, column)))], labels=labels)
    return unlock


def sub(text, **kw):
    # longest token first: @T must not eat the start of @TO / @TOID
    for k in sorted(kw, key=len, reverse=True):
        text = text.replace("@" + k, kw[k])
    left = re.findall(r"@[A-Z]{2,}", text)
    assert not left, left
    return text


SQL_WIDTH = 160
SQL_BREAK = ",\n\t\t"


def wrap_sql(text):
    """A long SQL line breaks after ", " outside quotes (the platform's addDraft failed on a 5,681-char SQL line, 2026-10-14)"""
    assert SQL_BREAK not in text
    out, line, quote, i = [], 0, False, 0
    while i < len(text):
        c = text[i]
        out.append(c)
        line = 0 if c == "\n" else line + 1
        if c == "'":
            quote = not quote
        elif c == "," and not quote and line > SQL_WIDTH and text[i + 1:i + 2] == " ":
            out.append(SQL_BREAK[1:])
            line = len(SQL_BREAK) - 2
            i += 1
        i += 1
    w = "".join(out)
    assert w.replace(SQL_BREAK, ", ") == text, "wrapping changed the SQL"
    return w


def wrap_doc_sql(doc):
    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                n["data"]["script"]["code"] = wrap_sql(n["data"]["script"]["code"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return doc


def slice_loop(ids, prefix, tag, src, field, title, table, props, slice_body, labels=None, add=False):
    """a <= 250-rows-per-call write loop (build_grv2 / build_pwv2 slice_loop with the node prefix explicit, e.g. "RC")"""
    loop_id = "loop_%s%s" % (prefix, tag)
    sl = "code_node_%s%sslice" % (prefix, tag)
    body = slice_body.replace("__LOOP__", loop_id)
    write = (K.add(ids, "add_node_%s%swrite" % (prefix, tag), title + " (<= 250 per call)", table, [(p, N(sl, "data.rows." + p)) for p in props], labels) if add else
             K.update(ids, "update_node_%s%swrite" % (prefix, tag), title + " (<= 250 per call)", table, ("id", "in", N(sl, "data.rows.id")),
                      [(p, N(sl, "data.rows." + p)) for p in ["id"] + props], labels))
    return K.loop(ids, loop_id, title, N(src, "data." + field), [
        K.code(sl, "This slice (the loop item: <= 250 rows)", body, ["n", "rows"], arrays=("rows",), objects=("n",)), write])


def step_done(ids, prefix, tag, src, step):
    return gate(ids, "cor_%s%sdone" % (prefix, tag), "%s DONE to record?" % step, src, "needStep",
                [step_add(ids, "add_node_%s%sdone" % (prefix, tag), "%s DONE (unique job / step)" % step, src, "stepRows")])


# ------------------------------------------------------------------------------------------- WORKER (build_grv2.build_worker)
def worker_config(**kw):
    """every GR-specific global build_grv2.build_worker() read, as a key:
    name            workflow name in titles / evidence (GR_COMPLETE_WORKER)
    code_dir        folder of the worker JS (claim.js, pick.js, ...)
    ids_base        K.Ids start (1798400000000)
    command         gd_async_job.command polled (COMPLETE_GR)
    states          job states the poll takes (QUEUED, VALIDATING, READY_TO_COMMIT, COMMITTING_GR)
    lock_join       SQL: LEFT JOIN of the document (alias g) + its latest LOCK row (alias lk) - GR_LOCK_JOIN
    id_col          SQL: the document id column (the lock owner check) - GR_ID_COL
    prev_col        SQL: the status-before-the-submit column - PREV_COL
    corr_offset     SUBSTRING(j.correlation_id, <n>) in the final read (4 for 'GR|', 5 for 'LOT|')
    id_alias        the final read's alias of that substring (gr_id)
    prepare/commit  (workflow name, id) called by the tick
    unlock          f(ids, nid, title, src, field) -> the lock-release node (status_unlock(...))
    cache_prefix    redis key prefix of the loop index (grc_wrk_)
    renames         text replacements applied to the finished JSON (build_pwv2.build_worker's renames), in order
    one_commit_per_run  True: an iteration that called the commit ends the run's loop (a stock lock lives until the TOP-LEVEL run
                    ends, prod 10-26: one stock call per run); default False = every planned job (the GR / LOT / SA workers' tick)
    """
    need = ["name", "code_dir", "ids_base", "command", "states", "lock_join", "id_col", "prev_col", "corr_offset", "id_alias", "prepare", "commit", "unlock",
            "cache_prefix"]
    missing = [k for k in need if k not in kw]
    assert not missing, missing
    kw.setdefault("renames", [])
    kw.setdefault("one_commit_per_run", False)
    return kw


def wcode(cfg, path, subs=None):
    body = raw(cfg["code_dir"], path)
    if "//@include _common.js\n" in body:
        body = body.replace("//@include _common.js\n", raw(cfg["code_dir"], "_common.js") + "\n")
    for a, b in (subs or {}).items():
        assert a in body, (path, a)
        body = body.replace(a, b)
    left = re.findall(r"__[A-Z]+__", body)
    assert not left, (path, left)
    return body


def wjob_sql(cfg, tenant, job_ref):
    return sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_percent,
       j.progress_message,
       j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live,
       j.row_version,
       j.error_code,
       j.error_message,
       j.error_details,
       @GRCOL,
       @PREVCOL,
       DATE_FORMAT(j.finished_at, '%Y-%m-%d %H:%i:%s') AS finished_at
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.id = @JOB
  @LOCKJOIN""", GRCOL=cfg["id_col"], PREVCOL=cfg["prev_col"], T=tenant, JOB=job_ref, LOCKJOIN=cfg["lock_join"])


WJOB_COLS = ["db_now", "id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
             "lease_expires_at", "lease_live", "row_version", "error_code", "error_message", "error_details", "gr_id", "prev_status", "finished_at"]


def build_worker(cfg):
    ids = K.Ids(cfg["ids_base"])
    G = "code_node_RWguard"
    T = N(G, "data.tenantId")
    prep = cfg["prepare"]
    comm = cfg["commit"]
    states = "'" + "', '".join(cfg["states"]) + "'"
    res_fields = ["worker_route", "processed", "jobs", "job_id", "job_status", "result_code", "result_message", "gr_id", "evidence"]
    poll = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       x.id, x.organization_id, x.gr_id, x.prev_status, x.job_status, x.progress_percent, x.progress_message, x.attempt_count, x.next_attempt_at, x.lease_owner,
       x.lease_expires_at, x.dead_lease, x.row_version, x.error_code, x.error_message, x.error_details, x.claim_id, x.claim_started_at, x.claim_owner
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN (SELECT CAST(j.id AS CHAR) AS id,
                    j.organization_id,
                    @GRCOL,
                    @PREVCOL,
                    j.job_status,
                    j.progress_percent,
                    j.progress_message,
                    j.attempt_count,
                    DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at,
                    j.lease_owner,
                    DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
                    (j.lease_owner IS NOT NULL AND j.lease_owner <> '' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= NOW(3)) AS dead_lease,
                    j.row_version,
                    j.error_code,
                    j.error_message,
                    j.error_details,
                    CAST(c.id AS CHAR) AS claim_id,
                    DATE_FORMAT(c.started_at, '%Y-%m-%d %H:%i:%s') AS claim_started_at,
                    c.result_ref AS claim_owner,
                    j.create_time AS created
               FROM gd_async_job j
               LEFT JOIN gd_publish_step c
                 ON c.tenant_id = '@T'
                AND c.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
                AND c.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)
                AND c.is_deleted = 0
               @LOCKJOIN
              WHERE j.tenant_id = '@T'
                AND j.is_deleted = 0
                AND j.command = '@COMMAND'
                AND (@JOB = 0 OR j.id = @JOB)
                AND j.job_status IN (@STATES)
                AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= NOW(3))
                AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW(3))
                AND (c.id IS NULL OR c.started_at <= NOW(3) - INTERVAL 10 MINUTE)
              ORDER BY j.create_time, j.id
              LIMIT 5) x
    ON 1 = 1""", GRCOL=cfg["id_col"], PREVCOL=cfg["prev_col"], LOCKJOIN=cfg["lock_join"], T=T, JOB=N(G, "data.jobId"), COMMAND=cfg["command"], STATES=states)
    tick = sub("""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id,
       j.organization_id,
       @GRCOL,
       @PREVCOL,
       j.job_status,
       j.progress_percent,
       j.progress_message,
       j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live,
       (j.lease_owner IS NOT NULL AND j.lease_owner <> '' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= n.t) AS dead_lease,
       (j.next_attempt_at IS NULL OR j.next_attempt_at <= n.t) AS due_now,
       j.row_version,
       j.error_code,
       j.error_message,
       j.error_details,
       CAST(cw.id AS CHAR) AS claim_id,
       DATE_FORMAT(cw.started_at, '%Y-%m-%d %H:%i:%s') AS claim_started_at,
       cw.result_ref AS claim_owner,
       (cw.id IS NOT NULL AND cw.started_at > n.t - INTERVAL 10 MINUTE) AS claim_live
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '@T'
   AND j.is_deleted = 0
   AND j.id IN (@IDS)
  LEFT JOIN gd_publish_step cw
    ON cw.tenant_id = '@T'
   AND cw.job_id = (CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci)
   AND cw.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)
   AND cw.is_deleted = 0
  @LOCKJOIN""", GRCOL=cfg["id_col"], PREVCOL=cfg["prev_col"], LOCKJOIN=cfg["lock_join"], T=T, IDS=N("code_node_RWplan", "data.jobIdsSql"))
    final = sub("""SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.attempt_count, j.lease_owner, j.error_code, j.error_message, SUBSTRING(j.correlation_id, @OFF) AS @ALIAS
  FROM gd_async_job j
 WHERE j.tenant_id = '@T'
   AND j.id IN (@IDS)""", T=T, IDS=N("code_node_RWplan", "data.jobIdsSql"), OFF=str(cfg["corr_offset"]), ALIAS=cfg["id_alias"])
    JOBREF = N("code_node_RWpick", "data.jobId")
    gr_unlock = cfg["unlock"]
    commit_state = [s for s in cfg["states"] if s.startswith("COMMITTING_")]
    assert len(commit_state) == 1, cfg["states"]

    def jobread(nid, title):
        return K.sql(nid, title, wjob_sql(cfg, T, JOBREF), WJOB_COLS)

    def unlock(nid, title, src, field="unlockRows"):
        return gr_unlock(ids, nid, title, src, field)

    def wjob_update(nid, title, src, field="jobRows", props=JOB_PROPS):
        return job_update(ids, nid, title, src, field, props)

    def publish(prefix, mid_node, which, wf_title):
        resp, back, after = "code_node_RW%sResp" % prefix, "sql_node_RW%sBack" % prefix, "code_node_RW%sAfter" % prefix
        return [
            call(ids, "workflow_node_RW%s" % prefix, wf_title, comm, [("job_id", JOBREF)]),
            K.code(resp, "The %s response, normalized (evidence; the job row decides)" % which,
                   wcode(cfg, "callee.js", {"__WHAT__": which, "__NODE__": "workflow_node_RW%s" % prefix, "\"__EXTRA__\"": "\"path\""}),
                   ["called", "job_id", "job_status", "result_code", "result_message", "path"]),
            jobread(back, "Read-back: the job after the %s (the truth)" % which),
            K.code(after, "After the %s: COMMIT wrote the job itself; the worker writes only when nothing was saved" % which,
                   wcode(cfg, "after_publish.js", {"__WHICH__": which, "__MID__": mid_node, "__RESP__": resp, "__BACK__": back}),
                   ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "publishRoute", "result_code", "result_message", "job_status"],
                   arrays=("jobRows", "unlockRows")),
            gate(ids, "cor_RW%sUnlock" % prefix, "Receipt lock to release after the %s?" % which, after, "needUnlock", [unlock("update_node_RW%sUnlock" % prefix, "Goods Receiving back to its status before the submit (nothing was saved)", after)]),
            gate(ids, "cor_RW%sJob" % prefix, "Job row to write after the %s?" % which, after, "needJobUpd", [wjob_update("update_node_RW%sJob" % prefix, "Job: FAILED (a hard code) / retry with backoff (lease released)", after)]),
        ]

    plan_ref = "[%s][0]" % N("code_node_RWplan", "data")
    CS = commit_state[0]
    nodes = [
        K.code(G, "Guard: optional job_id, session tenant, this run's lease owner WRK|<nonce>", wcode(cfg, "guard.js"), ["route", "jobId", "tenantId", "nonce", "leaseOwner", "result_code", "result_message"]),
        K.if_(ids, "if_RWreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_RWrejres", "Result (REJECTED_INPUT)", wcode(cfg, "result.js", {"__PATH__": "REJECTED_INPUT", "__PLAN__": "null", "__ROWS__": "[]"}), res_fields),
            K.ret("return_node_RWrej", "Return (invalid input)", [(f, N("code_node_RWrejres", "data." + f)) for f in res_fields]),
        ]),
        K.sql("sql_node_RWpoll", "Poll: the due %s jobs of the tenant (at most 5, oldest first; lease expired or never set; backoff over; no live claim row) + DB clock" % cfg["command"], poll,
              ["db_now", "id", "organization_id", "gr_id", "prev_status", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner",
               "lease_expires_at", "dead_lease", "row_version", "error_code", "error_message", "error_details", "claim_id", "claim_started_at", "claim_owner"]),
        K.code("code_node_RWplan", "Plan: the loop's items (the due jobs with their claim facts), the run start", wcode(cfg, "plan.js"),
               ["route", "dbNow", "runStart", "items", "count", "jobIdsSql", "result_code", "result_message"], arrays=("items",)),
        K.set_cache("set_cache_RWidx0", "Loop index = 0 (per run: the key carries this run's nonce)", cfg["cache_prefix"] + N(G, "data.nonce"), "0"),
        K.loop(ids, "loop_RWjobs", "Loop over the planned jobs (in order; a lost claim gate ends the tick, the rest wait for the next)", N("code_node_RWplan", "data.items"), [
            K.get_cache("get_cache_RWidx", "Loop index", cfg["cache_prefix"] + N(G, "data.nonce")),
            K.sql("sql_node_RWtick", "Tick: the FRESH read of the planned jobs (state, lease, backoff, claim row) + the lease end of a claim made now", tick,
                  ["db_now", "lease_until", "id", "organization_id", "gr_id", "prev_status", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at",
                   "lease_owner", "lease_expires_at", "lease_live", "dead_lease", "due_now", "row_version", "error_code", "error_message", "error_details", "claim_id",
                   "claim_started_at", "claim_owner", "claim_live"]),
            K.code("code_node_RWpick", "Pick: the item by index; SKIP after the budget / not due / live lease / live claim; the claim gate rows", wcode(cfg, "pick.js"),
                   ["route", "index", "nextIndex", "dbNow", "leaseUntil", "elapsed", "jobId", "organizationId", "grId", "item", "rvBase", "rvRows", "needRvUpd", "claimName",
                    "claimRows", "needClaimAdd", "result_message"], arrays=("rvRows", "claimRows"), objects=("item",)),
            gate(ids, "cor_RWrv", "Dead claim to move past (row_version = v + 1)?", "code_node_RWpick", "needRvUpd", [
                wjob_update("update_node_RWrv", "Job: row_version = v + 1 and the retry count (absolute)", "code_node_RWpick", "rvRows", ["id", "row_version", "attempt_count"])]),
            gate(ids, "cor_RWclaimAdd", "Claim row to insert?", "code_node_RWpick", "needClaimAdd", [
                step_add(ids, "add_node_RWclaim", "CLAIM GATE: gd_publish_step W0_CLAIM_<row_version> (unique tenant / job / step: a twin's insert fails and its run ends)", "code_node_RWpick", "claimRows")]),
            K.code("code_node_RWclaim", "Claim: the lease / state write; a dead lease or claim = one retry; exhausted after max_retries", wcode(cfg, "claim.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "grId", "prevStatus", "rowVersion", "attempts", "claimRows", "needClaim", "failRows", "unlockRows", "exhausted",
                    "result_code", "result_message", "job_status"], arrays=("claimRows", "failRows", "unlockRows")),
            gate(ids, "cor_RWlease", "Lease / state to write?", "code_node_RWclaim", "needClaim", [
                wjob_update("update_node_RWlease", "Lease write: WRK|<nonce> for 10 min, VALIDATING for a QUEUED job, the retry count", "code_node_RWclaim", "claimRows")]),
            jobread("sql_node_RWown", "Read-back: the job after the lease write"),
            K.code("code_node_RWown", "Own: state and lease as written -> PREPARE / PUBLISH / RESUME / EXHAUST; else LOST", wcode(cfg, "own.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "organizationId", "grId", "prevStatus", "attempts", "failRows", "unlockRows", "needFail", "needUnlock", "rowVersion",
                    "result_code", "result_message", "job_status"], arrays=("failRows", "unlockRows")),
            gate(ids, "cor_RWfailUnlock", "Exhausted pre-commit: receipt lock to release?", "code_node_RWown", "needUnlock", [
                unlock("update_node_RWfailUnlock", "Goods Receiving back to its status before the submit (nothing was saved)", "code_node_RWown")]),
            gate(ids, "cor_RWfail", "Exhausted: job row to write?", "code_node_RWown", "needFail", [
                wjob_update("update_node_RWfail", "Job FAILED (pre-commit) / REQUIRES_REVIEW (%s)" % CS, "code_node_RWown", "failRows")]),
            K.if_(ids, "if_RWprep", "IF the job is pre-commit under this run's lease: the ONE %s call" % prep[0], is_("code_node_RWown", "route", "PREPARE"), [
                call(ids, "workflow_node_RWprep", "%s (set-based reads; writes the job + releases the lock on FAILED)" % prep[0], prep, [("job_id", JOBREF)]),
                K.code("code_node_RWprepResp", "The prepare response, normalized (evidence; the job row decides)",
                       wcode(cfg, "callee.js", {"__WHAT__": "prepare", "__NODE__": "workflow_node_RWprep", "\"__EXTRA__\"": "\"evidence\""}),
                       ["called", "job_id", "job_status", "result_code", "result_message", "evidence"]),
                jobread("sql_node_RWprepBack", "Read-back: the job after prepare (the truth)"),
                K.code("code_node_RWafterPrep", "After prepare: READY_TO_COMMIT -> publish; FAILED -> lease released; else a hard code fails it / a counted retry", wcode(cfg, "after_prepare.js"),
                       ["route", "dbNow", "jobId", "jobStatus", "jobRows", "needJobUpd", "unlockRows", "needUnlock", "prepareResult", "prepareMessage", "result_code", "result_message", "job_status"],
                       arrays=("jobRows", "unlockRows")),
                gate(ids, "cor_RWprepUnlock", "Receipt lock to release after prepare?", "code_node_RWafterPrep", "needUnlock", [
                    unlock("update_node_RWprepUnlock", "Goods Receiving back to its status before the submit (nothing was saved)", "code_node_RWafterPrep")]),
                gate(ids, "cor_RWprepJob", "Job row to write after prepare?", "code_node_RWafterPrep", "needJobUpd", [
                    wjob_update("update_node_RWprepJob", "Job: lease released / FAILED / retry with backoff", "code_node_RWafterPrep")]),
            ]),
            jobread("sql_node_RWmid", "The job before the publish decision"),
            K.code("code_node_RWmid", "Before publish: READY_TO_COMMIT under this run's lease, or %s with no live lease -> PUBLISH" % CS, wcode(cfg, "mid.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_RWpub", "IF the job is to be published / resumed: the ONE %s call" % comm[0], is_("code_node_RWmid", "route", "PUBLISH"),
                  publish("pub", "code_node_RWmid", "publish", "%s (phase A: revalidate, batches, inventory; or phase B on a resume)" % comm[0])),
            jobread("sql_node_RWsplit", "The job after the publish call (the split decision)"),
            K.code("code_node_RWsplit", "Second publish: %s under a SPLIT| hand-over lease -> PUBLISH again" % CS, wcode(cfg, "split.js"),
                   ["route", "dbNow", "jobId", "jobStatus", "result_message"]),
            K.if_(ids, "if_RWpub2", "IF %s ended SPLIT: the second call (purchase orders, putaway, the receipt)" % comm[0], is_("code_node_RWsplit", "route", "PUBLISH"),
                  publish("pub2", "code_node_RWsplit", "second publish", "%s again after its SPLIT (phase B)" % comm[0])),
        ] + ([K.code("code_node_RWnext", "Next loop index: past the plan after an iteration that called %s (one stock call per run)" % comm[0],
                      "// one stock call per run (prod 10-26: a stock lock lives until the TOP-LEVEL run ends): an iteration that called the commit\n"
                      "// ends the run's loop; the next job goes to the next run (its own kick, the list's tick)\n"
                      "const next = [%s][0];\nconst called = [%s][0] === \"PUBLISH\";\nconst res = { nextIndex: called ? 9999 : next };\n"
                      "console.log(\"worker next\", JSON.stringify({ called: called, nextIndex: res.nextIndex }));\nreturn { nextIndex: res.nextIndex };"
                      % (N("code_node_RWpick", "data.nextIndex"), N("code_node_RWmid", "data.route")), ["nextIndex"])] if cfg["one_commit_per_run"] else []) + [
            K.set_cache("set_cache_RWidxN", "Next loop index", cfg["cache_prefix"] + N(G, "data.nonce"),
                        N("code_node_RWnext" if cfg["one_commit_per_run"] else "code_node_RWpick", "data.nextIndex")),
        ]),
        K.sql("sql_node_RWfinal", "Read-back: the planned jobs (final)", final, ["id", "job_status", "attempt_count", "lease_owner", "error_code", "error_message", cfg["id_alias"]]),
        K.code("code_node_RWresult", "Result (DONE)", wcode(cfg, "result.js", {"__PATH__": "DONE", "__PLAN__": plan_ref, "__ROWS__": "[%s][0]" % N("sql_node_RWfinal", "data")}), res_fields),
        K.ret("return_node_RWdone", "Return the tick's result", [(f, N("code_node_RWresult", "data." + f)) for f in res_fields]),
    ]
    doc = K.workflow([("job_id", "string", "optional: gd_async_job.id (digits) to drive this job only (the form's kick after a submit); empty: the oldest due jobs of the session tenant (at most 5 per tick)")],
                     res_fields, nodes)
    if not cfg["renames"]:
        return doc
    text = json.dumps(doc, ensure_ascii=False)
    for a, b in cfg["renames"]:
        text = text.replace(a, b)
    return json.loads(text)


# ------------------------------------------------------------------------------------------- the two deployed configurations
GR_DOC = "Goods Receiving:Table:1901845517592285186"
GR_LABELS = {"gr_status": "GR Status", "putaway_status": "Putaway Status"}
GR_LOCK_JOIN = """LEFT JOIN goods_receiving g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^GR\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GRC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
GR_ID_COL = "(CASE WHEN g.gr_status = 'Processing' AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS gr_id"
PREV_COL = "IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.previousStatus')), NULL) AS prev_status"


def _ids(path):
    return json.load(open(path)) if os.path.exists(path) else {}


def gr_worker_config(code_dir=None):
    gr_ids = _ids(os.path.join(SCRATCH, "grv2", "ids.json"))
    return worker_config(
        name="GR_COMPLETE_WORKER", code_dir=code_dir or os.path.join(SCRATCH, "grv2", "code", "worker"), ids_base=1798400000000, command="COMPLETE_GR",
        states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GR"], lock_join=GR_LOCK_JOIN, id_col=GR_ID_COL, prev_col=PREV_COL, corr_offset=4,
        id_alias="gr_id", prepare=("GR_COMPLETE_PREPARE", gr_ids.get("GR_COMPLETE_PREPARE", "0")), commit=("GR_COMPLETE_COMMIT", gr_ids.get("GR_COMPLETE_COMMIT", "0")),
        unlock=status_unlock(GR_DOC, "gr_status", GR_LABELS), cache_prefix="grc_wrk_")


TO_DOC = "Transfer Order Putaway:Table:1937714890958053378"
PW_LOCK_JOIN = """LEFT JOIN transfer_order_putaway g
    ON g.tenant_id = j.tenant_id
   AND j.correlation_id REGEXP '^TO\\\\|[0-9]{1,20}$'
   AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)
  LEFT JOIN gd_publish_step lk
    ON lk.id = (SELECT MAX(p.id) FROM gd_publish_step p
                 WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('PWC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0)"""
PW_ID_COL = "(CASE WHEN g.is_processing = 1 AND lk.result_ref = j.idempotency_key THEN CAST(g.id AS CHAR) ELSE '0' END) AS to_id"
PW_RENAMES = [("GR_COMPLETE_PREPARE", "PUTAWAY_BULK_PREPARE"), ("GR_COMPLETE_COMMIT", "PUTAWAY_BULK_COMMIT"), ("COMPLETE_GR", "COMPLETE_PUTAWAY"),
              ("COMMITTING_GR", "COMMITTING_PUTAWAY"), ("code_node_RW", "code_node_PW"), ("sql_node_RW", "sql_node_PW"), ("get_cache_RW", "get_cache_PW"),
              ("set_cache_RW", "set_cache_PW"), ("update_node_RW", "update_node_PW"), ("add_node_RW", "add_node_PW"), ("workflow_node_RW", "workflow_node_PW"),
              ("cor_RW", "cor_PW"), ("cori_YRW", "cori_YPW"), ("cori_NRW", "cori_NPW"), ("if_RW", "if_PW"), ("ifBlock_TRW", "ifBlock_TPW"), ("ifBlock_FRW", "ifBlock_FPW"),
              ("loop_RW", "loop_PW"), ("return_node_RW", "return_node_PW"), ("grc_wrk_", "pwc_wrk_"), ("gr_id", "to_id"), ("Goods Receiving", "Putaway"),
              ("receipt lock", "putaway lock"), ("the receipt", "the putaway")]


def pw_worker_config():
    """build_pwv2.build_worker(): GR's builder on GR's names (renamed afterwards), the putaway's lock join / unlock / worker JS"""
    pw_ids = _ids(os.path.join(SCRATCH, "pwv2", "ids.json"))

    def to_unlock(ids, nid, title, src, field="unlockRows"):
        return K.update(ids, nid, title, TO_DOC, ("id", "in", N(src, "data.%s.id" % field)),
                        [("id", N(src, "data.%s.id" % field)), ("is_processing", N(src, "data.%s.is_processing" % field))])
    return worker_config(
        name="PUTAWAY_ASYNC_WORKER", code_dir=os.path.join(SCRATCH, "pwv2", "code", "worker"), ids_base=1798400000000, command="COMPLETE_GR",
        states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GR"], lock_join=PW_LOCK_JOIN, id_col=PW_ID_COL, prev_col="'' AS prev_status", corr_offset=4,
        id_alias="gr_id", prepare=("GR_COMPLETE_PREPARE", pw_ids.get("PUTAWAY_BULK_PREPARE", "0")), commit=("GR_COMPLETE_COMMIT", pw_ids.get("PUTAWAY_BULK_COMMIT", "0")),
        unlock=to_unlock, cache_prefix="grc_wrk_", renames=PW_RENAMES)


def build(builders, out_dir, write, want=()):
    """the build_grv2 __main__ loop: wrap SQL, check node ids, print sizes, write <out_dir>/<NAME>.json when `write`;
    a builder raising NotImplementedError is skipped (a package not there yet)"""
    built = {}
    for name, fn in builders:
        if want and name not in want:
            continue
        try:
            doc = wrap_doc_sql(fn())
        except NotImplementedError as e:
            print(f"{name}: skipped ({e})")
            continue
        K.check_ids(doc)
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        path = os.path.join(out_dir, name + ".json")
        print(f"{name}: {len(text)} chars, {len(K.check_ids(doc))} nodes" + (f" -> {path}" if write else " (dry; --write to save)"))
        if write:
            os.makedirs(out_dir, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text + "\n")
        built[name] = doc
    return built
