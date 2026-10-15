"""Generates scratchpad/grv2/code/worker/*.js from GD Completed V2's worker code (scratchpad/gdc/code/worker, read only):
same claim gate / lease / retry / SPLIT logic, GR names, and one real change - a lock released before COMMIT puts the
Goods Receiving back to the status it had before the submit (request_payload.previousStatus: Draft or Created), not to
a fixed status. Run: python3 gen_worker_code.py (rewrites the GR copies; the GD files are never touched)."""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "gdc", "code", "worker")
DST = os.path.join(HERE, "code", "worker")

# order matters: longer / more specific first
SUBS = [
    ("GD_COMPLETE_WORKER", "GR_COMPLETE_WORKER"),
    ("GD_COMPLETE_PREPARE", "GR_COMPLETE_PREPARE"),
    ("GD_COMPLETE_COMMIT", "GR_COMPLETE_COMMIT"),
    ("COMPLETE_GD", "COMPLETE_GR"),
    ("COMMITTING_GD", "COMMITTING_GR"),
    ("GDC_GD_NOT_FOUND", "GRC_GR_NOT_FOUND"),
    ("GDC_", "GRC_"),
    ("code_node_GW", "code_node_RW"),
    ("sql_node_GW", "sql_node_RW"),
    ("get_cache_GW", "get_cache_RW"),
    ("gdId", "grId"),
    ("gd_id", "gr_id"),
    ("Goods Delivery", "Goods Receiving"),
    ("the delivery was completed", "the receipt was completed"),
    ("completing this delivery", "completing this receipt"),
    ("for the Packing and the finish", "for the purchase orders, the putaway and the finish"),
    ("the Goods Receiving back to Created", "the Goods Receiving back to its status before the submit"),
    ("put the Goods Receiving back to Created", "put the Goods Receiving back to its status before the submit"),
    ("Called once by the form after a submit and by its Quartz row (one per tenant)", "Called by the form after a submit and by the list's mounted kick (no Quartz)"),
]

HARD_GD = '["GRC_INVALID_REQUEST", "GRC_INVALID_DATA", "GRC_GR_NOT_FOUND", "GRC_NOT_LOCKED", "GRC_NOT_ELIGIBLE", "GRC_NOT_YET_SUPPORTED", "GRC_400", "GRC_401", "GRC_412", "GRC_UNEXPECTED_PATCH", "GRC_RES_BLANK", "GRC_LINES_CHANGED", "GRC_STALE", "JOB_ILLEGAL_TRANSITION"]'
HARD_GR = '["GRC_INVALID_REQUEST", "GRC_INVALID_DATA", "GRC_GR_NOT_FOUND", "GRC_NOT_LOCKED", "GRC_NOT_ELIGIBLE", "GRC_400", "GRC_401", "GRC_LINES_CHANGED", "GRC_STALE", "GRC_PO_CHANGED", "GRC_ENGINE_REFUSED", "JOB_ILLEGAL_TRANSITION"]'

# the unlock rows: back to the status before the submit (carried on every worker item as prevStatus)
UNLOCK_GD = '{ id: s(pick.grId), gd_status: "Created" }'
UNLOCK_GR = '{ id: s(pick.grId), gr_status: s(item.prevStatus) || "Draft" }'
UNLOCK_GD_OWN = '{ id: s(own.grId), gd_status: "Created" }'
UNLOCK_GR_OWN = '{ id: s(own.grId), gr_status: s(own.prevStatus) || "Draft" }'

ITEM_OLD = 'return { jobId: s(row.id), organizationId: s(row.organization_id), grId: s(row.gr_id), jobStatus'
ITEM_NEW = 'return { jobId: s(row.id), organizationId: s(row.organization_id), grId: s(row.gr_id), prevStatus: s(row.prev_status) || "Draft", jobStatus'


def gen():
    os.makedirs(DST, exist_ok=True)
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".js"):
            continue
        body = open(os.path.join(SRC, name), encoding="utf-8").read()
        for a, b in SUBS:
            body = body.replace(a, b)
        if name == "_common.js":
            assert body.count(HARD_GD) == 1, name
            body = body.replace(HARD_GD, HARD_GR)
        if name in ("plan.js", "pick.js"):
            assert body.count(ITEM_OLD) == 1, name
            body = body.replace(ITEM_OLD, ITEM_NEW)
        if name == "claim.js":
            assert body.count(UNLOCK_GD) == 1, name
            body = body.replace(UNLOCK_GD, UNLOCK_GR)
            # carry the previous status to own / after_prepare / after_publish
            old = 'const base = { route: "SKIP", dbNow: pick.dbNow, jobId: pick.jobId, jobStatus: item ? item.jobStatus : "", organizationId: pick.organizationId, grId: pick.grId,'
            assert body.count(old) == 1, name
            body = body.replace(old, old + ' prevStatus: item ? item.prevStatus : "Draft",')
        if name == "own.js":
            old = 'const base = { route: claim.route, dbNow: dbNow, jobId: claim.jobId, jobStatus: job ? s(job.job_status) : "", organizationId: claim.organizationId, grId: claim.grId,'
            assert body.count(old) == 1, name
            body = body.replace(old, old + " prevStatus: claim.prevStatus,")
        if name in ("after_prepare.js", "after_publish.js"):
            assert body.count(UNLOCK_GD_OWN) == 1, name
            body = body.replace(UNLOCK_GD_OWN, UNLOCK_GR_OWN)
        left = [w for w in ("gd_status", "COMPLETE_GD", "GDC_", "_GW", "gdId", "Goods Delivery", "delivery") if w in body]
        assert not left, (name, left)
        open(os.path.join(DST, name), "w", encoding="utf-8").write(body)
        print("wrote", os.path.relpath(os.path.join(DST, name), HERE))


if __name__ == "__main__":
    gen()
