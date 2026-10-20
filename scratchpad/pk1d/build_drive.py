"""build_drive.py [--write]: builds PICKING_FC_DRIVE (Picking/AsyncV2/PICKING_FC_DRIVE.json), Picking V2 stage 1d's new workflow.
PICKING_ASYNC_WORKER calls it for a force complete's job (CONFIRM_PICKING, operation FORCE_COMPLETE) once PREPARE has planned
it: each call claims the job (DRV|<nonce>, 10 min), touches the Picking lock and takes at most 12 actions, one per loop
iteration from a fresh read (scratchpad/pk1d/code/fc_next.js): F0, GD_EDIT_SUBMIT's SUBMIT / RELEASE / CANCEL_HELD of a
delivery's edit, or an FC step. It never calls GD_EDIT_WORKER: its answer names the edit jobs the screen must kick (kick).
Code and SQL come from scratchpad/pk1d/code/ (tested by scratchpad/pk1d/test/test_drive.js on the 1c sim); gdc's wfkit is
imported unchanged. Published with .dbtools/wf_upload.mjs into an empty workflow created in the dev designer.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
sys.path.insert(0, R + "scratchpad/gdc/pkv2tools")
sys.path.insert(0, HERE)
import wfkit as K  # noqa: E402
from patch_pk1d import fmt  # noqa: E402

OUT = R + "Picking/AsyncV2/PICKING_FC_DRIVE.json"
IDS = json.load(open(os.path.join(HERE, "ids.json")))
JOB = "GD Async Job:Table:2104845286495150081"
STEP = "GD Publish Step:Table:2105131615547461634"
PICKT = "Transfer Order Picking:Table:1935556443668959233"
GD_EDIT_SUBMIT = ("GD_EDIT_SUBMIT", IDS["GD_EDIT_SUBMIT"])
JOB_PROPS = ["id", "job_status", "progress_percent", "progress_message", "attempt_count", "next_attempt_at", "lease_owner", "lease_expires_at", "row_version", "error_code",
             "error_message", "error_details", "finished_at"]
STEP_PROPS = ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "started_at", "finished_at", "inventory_operation_id", "result_ref", "error_code",
              "error_message"]
ORG = {"organization_id": "Organization"}
G, E, NX, F0, CL, FIN, RES = ("code_node_DRguard", "code_node_DRentry", "code_node_DRnext", "code_node_DRf0", "code_node_DRcall", "code_node_DRfinal",
                              "code_node_DRresult")
KEY = "pk_drv_{{node:%s.data.nonce}}" % G
GUARD_FIELDS = ["route", "jobId", "tenantId", "nonce", "leaseOwner", "callerLease", "result_code", "result_message"]
ENTRY_FIELDS = ["route", "jobId", "organizationId", "pickingId", "pickingNo", "jobStatus", "dbNow", "runStart", "nonce", "manifest", "fp", "counts", "snapToStatus", "snapGds",
                "gdIdsSql", "gdIdsAllSql", "edLikeSql", "slots", "claimRows", "needClaim", "touchRows", "needTouch", "result_code", "result_message"]
NEXT_FIELDS = ["kind", "index", "dbNow", "phase", "gi", "gdNo", "terminal", "needF0", "call", "operation", "gdId", "fcdRef", "cascadeRef", "stepRows", "needStep", "jobRows",
               "needJob", "result_message"]
FINAL_FIELDS = ["route", "kick", "progress_message", "jobRows", "needJob", "unlockRows", "needUnlock", "result_code", "result_message", "job_status"]
RESULT_FIELDS = ["route", "job_id", "job_status", "kick", "actions", "progress_message", "result_code", "result_message"]
JOB_COLS = ["db_now", "lease_until", "id", "command", "is_deleted", "organization_id", "picking_id", "job_status", "row_version", "attempt_count", "lease_owner",
            "lease_expires_at", "lease_live", "progress_percent", "progress_message", "operation", "fc", "picking_no", "snap_to_status", "snap_gds", "gd_ids_all", "fc_steps"]
STATE_COLS = ["db_now", "id", "job_status", "row_version", "lease_owner", "lease_live", "progress_percent", "edits", "steps"]
F0_COLS = ["db_now", "kind", "id", "status", "a", "b", "c"]


def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def is_(node, field, value):
    return "'%s' == '%s'" % (N(node, "data." + field), value)


def text(name):
    with open(os.path.join(HERE, "code", name), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def module(name):
    """an inlined module: its require / exports lines dropped (the code-node runtime has no require), no platform tokens"""
    t = re.sub(r'^const \{[^}]*\} = require\([^)]*\);\s*$', "", text(name), flags=re.M)
    t = re.sub(r'^(if \(typeof module !== "undefined"\) )?module\.exports = .*$', "", t, flags=re.M).strip("\n")
    assert "{{" not in t, name + " holds a platform token"
    return t


def cnode(nid, title, mods, own, fields, arrays=(), objects=()):
    """the modules inlined, then the node's own file (its function and the tail that reads the node's inputs)"""
    body = "\n".join([module(m) for m in mods] + [text(own)]) + "\n"
    assert "require(" not in body and "module.exports" not in body
    return K.code(nid, title, body, fields, arrays, objects)


def sql(nid, title, name, cols):
    t = text(name)
    assert max(len(line) for line in t.split("\n")) <= 400, name + ": a long SQL line (the platform's addDraft failed on a 5,681-char line)"
    return K.sql(nid, title, t, cols)


def gate(ids, nid, title, src, flag, nodes):
    return K.when_yes(ids, nid, title, "node.%s.data.%s" % (src, flag), flag, nodes)


def rows_update(ids, nid, title, table, src, field, props):
    return K.update(ids, nid, title, table, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in ["id"] + props])


def step_add(ids, nid, title, src, field):
    return K.add(ids, nid, title, STEP, [(p, N(src, "data.%s.%s" % (field, p))) for p in STEP_PROPS], ORG)


def call(ids, nid, title, wf, params):
    """params: (prop, reference) or (prop, literal, "value")"""
    n = K.call(ids, nid, title, wf[0], wf[1], [(p[0], p[1]) for p in params])
    for item, p in zip(n["data"]["body_params"]["list"], params):
        if len(p) > 2:
            item["valueType"] = p[2]
    return n


def build():
    assert IDS.get("GD_EDIT_SUBMIT"), "ids.json: GD_EDIT_SUBMIT"
    ids = K.Ids(1798700000000)
    fn_only = lambda name: text(name).split("\nconst res = ")[0]  # noqa: E731
    rej = fn_only("drive_result.js") + "\nconst res = driveResult([%s][0], null, null, null);\nreturn res;" % N(G, "data")
    loop_body = [
        K.get_cache("get_cache_DRstop", "Loop stop flag", KEY),
        K.if_(ids, "if_DRgo", "IF the loop has not stopped: read the state, take ONE action", "'%s' == '0'" % N("get_cache_DRstop", "data"), [
            sql("sql_node_DRstate", "State: the job, its FC steps, its deliveries' EDIT_GD jobs (by idempotency key: GDE|<gd>|) + DB clock", "drive_state.sql", STATE_COLS),
            cnode(NX, "Next: fcNext's ONE action within the call's budget (12 actions, 20 s, ~600 line weight; the first always runs)",
                  ["fc_next.js", "drive_state.js"], "drive_next.js", NEXT_FIELDS, arrays=("stepRows", "jobRows")),
            K.if_(ids, "if_DRf0", "IF F0: the Picking, its rows, records and deliveries unchanged since PREPARE (once, before any delivery is touched)",
                  is_(NX, "needF0", "YES"), [
                      sql("sql_node_DRf0", "F0 reads: the Picking, its rows, its records (count / sum / max id), its deliveries' statuses", "drive_f0.sql", F0_COLS),
                      cnode(F0, "F0: FC_F0, or FC_ABORT PK_FC_STALE (nothing was touched)", ["fc_fp.js"], "drive_f0.js", ["ok", "stepRows", "result_message"],
                            arrays=("stepRows",)),
                      step_add(ids, "add_node_DRf0", "Step FC_F0 / FC_ABORT (unique per job and step)", F0, "stepRows")]),
            K.if_(ids, "if_DRcall", "IF the action is a GD_EDIT_SUBMIT call: SUBMIT / RELEASE / CANCEL_HELD (never GD_EDIT_WORKER: the screen kicks it)",
                  is_(NX, "call", "YES"), [
                      call(ids, "workflow_node_DRsubmit", "GD_EDIT_SUBMIT: the delivery's edit (source PICKING_FC, its planned parts by reference) or its release / cancel",
                           GD_EDIT_SUBMIT, [("operation", N(NX, "data.operation")), ("gd_id", N(NX, "data.gdId")), ("source", "PICKING_FC", "value"),
                                            ("cascade_ref", N(NX, "data.cascadeRef")), ("fcd_ref", N(NX, "data.fcdRef")), ("causation_job_id", N(E, "data.jobId")),
                                            ("picking_id", N(E, "data.pickingId"))]),
                      cnode(CL, "Call: go on / stop (retried on the next call) / the delivery refused -> FC_ABORT (holding) or FC_REVIEW (committing)", [], "drive_call.js",
                            ["route", "stepRows", "needStep", "stop", "result_message"], arrays=("stepRows",)),
                      gate(ids, "cor_DRcallStep", "Refusal step to write?", CL, "needStep", [
                          step_add(ids, "add_node_DRcallStep", "Step FC_ABORT / FC_REVIEW with the delivery's refusal", CL, "stepRows")]),
                      gate(ids, "cor_DRcallStop", "Stop the loop (retried on the next call)?", CL, "stop", [
                          K.set_cache("set_cache_DRstopC", "Loop stop flag = 1", KEY, "1")])]),
            gate(ids, "cor_DRstep", "Step row to write?", NX, "needStep", [
                step_add(ids, "add_node_DRstep", "Step FC_HOLD / FC_GDS / FC_ABORT / FC_REVIEW (unique per job and step)", NX, "stepRows")]),
            gate(ids, "cor_DRhold", "Every delivery held: job to COMMITTING_PICKING?", NX, "needJob", [
                rows_update(ids, "update_node_DRhold", "Job: COMMITTING_PICKING (this run's lease stays)", JOB, NX, "jobRows",
                            ["job_status", "progress_percent", "progress_message", "row_version"])]),
            gate(ids, "cor_DRstop", "Stop the loop?", NX, "terminal", [K.set_cache("set_cache_DRstop1", "Loop stop flag = 1", KEY, "1")])]),
    ]
    nodes = [
        cnode(G, "Guard: job_id, the calling worker's lease, session tenant, this run's lease owner DRV|<nonce>", [], "drive_guard.js", GUARD_FIELDS),
        K.if_(ids, "if_DRreject", "IF the input is invalid: answer, write nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_DRrejres", "Result (REJECT)", rej + "\n", RESULT_FIELDS, arrays=("kick",)),
            K.ret("return_node_DRrej", "Return (invalid input)", [(f, N("code_node_DRrejres", "data." + f)) for f in RESULT_FIELDS])]),
        sql("sql_node_DRjob", "Job: the force complete's job, its plan (fc: nonce, manifest, fingerprints), lease, FC steps + DB clock", "drive_job.sql", JOB_COLS),
        cnode(E, "Entry: a force complete READY_TO_COMMIT / COMMITTING_PICKING; FC_GDS -> DONE; a live lease of another run -> WAIT; else the claim and the loop's slots",
              [], "drive_entry.js", ENTRY_FIELDS, arrays=("manifest", "slots", "claimRows", "touchRows"), objects=("fp", "counts", "snapGds")),
        gate(ids, "cor_DRclaim", "Claim to write?", E, "needClaim", [
            rows_update(ids, "update_node_DRclaim", "Job: lease DRV|<nonce> for 10 min (row_version + 1)", JOB, E, "claimRows", ["lease_owner", "lease_expires_at", "row_version"])]),
        gate(ids, "cor_DRtouch", "Picking lock to touch?", E, "needTouch", [
            rows_update(ids, "update_node_DRtouch", "Picking is_processing = 1 (touched: its update time is the lock's age)", PICKT, E, "touchRows", ["is_processing"])]),
        K.set_cache("set_cache_DRstop0", "Loop stop flag = 0 (per run: the key carries this run's nonce)", KEY, "0"),
        K.loop(ids, "loop_DRact", "Loop: at most 12 actions, each from a fresh read (a stop flag ends it early)", N(E, "data.slots"), loop_body),
        K.if_(ids, "if_DRran", "IF this call drove the job: the stamp from a fresh read", is_(E, "route", "GO"), [
            sql("sql_node_DRend", "State after the loop (fresh)", "drive_state.sql", STATE_COLS),
            cnode(FIN, "Stamp: the answer + the job's one write, lease released (WAIT / DONE due now; ABORTED -> FAILED + unlock; REVIEW -> REQUIRES_REVIEW)",
                  ["fc_next.js", "drive_state.js"], "drive_final.js", FINAL_FIELDS, arrays=("kick", "jobRows", "unlockRows")),
            gate(ids, "cor_DRfinal", "Job row to write?", FIN, "needJob", [
                K.update(ids, "update_node_DRfinal", "Job: the stamp (lease released)", JOB, ("id", "in", N(FIN, "data.jobRows.id")),
                         [(p, N(FIN, "data.jobRows." + p)) for p in JOB_PROPS])]),
            gate(ids, "cor_DRunlock", "Picking lock to release?", FIN, "needUnlock", [
                rows_update(ids, "update_node_DRunlock", "Picking is_processing = 0 (FAILED: no delivery was committed)", PICKT, FIN, "unlockRows", ["is_processing"])])]),
        cnode(RES, "Result: route, the edit jobs to kick, the actions taken", [], "drive_result.js", RESULT_FIELDS, arrays=("kick",)),
        K.ret("return_node_DRdone", "Return the call's answer", [(f, N(RES, "data." + f)) for f in RESULT_FIELDS]),
    ]
    return K.workflow([("job_id", "string", "gd_async_job.id (digits): a force complete's CONFIRM_PICKING job, planned by PICKING_BULK_PREPARE"),
                       ("lease_owner", "string", "optional: the calling PICKING_ASYNC_WORKER's lease (WRK|<nonce>), taken over")],
                      RESULT_FIELDS, nodes)


if __name__ == "__main__":
    K._rng.seed("pk1d:PICKING_FC_DRIVE")
    K._taken.clear()
    doc = build()
    K.check_ids(doc)
    out = fmt(doc)
    print("PICKING_FC_DRIVE: %d chars, %d nodes" % (len(out), len(K.check_ids(doc))) + (" -> " + OUT if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        open(OUT, "w", encoding="utf-8").write(out)
