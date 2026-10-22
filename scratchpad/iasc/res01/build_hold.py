"""IA_HOLD (RES-01, scratchpad/iasc/res01/RES01_PLAN.md): an Item Assembly's raw-material holds. RECONCILE (after a Draft save,
the desktop's kick, a revert) holds what the saved picks want and is free, releases what they no longer want; RELEASE_ALL (a
Draft deleted) releases everything; CLOSE (after completion) delivers what the completion issued from Reserved and releases the
rest. One INVENTORY_BULK_APPLY operation per run (locked, all or nothing), rows written Processing / Releasing before it and
resolved after it, a ticket mutex per IA, the IA header's material_hold_status / material_hold_at.

  python3 scratchpad/iasc/res01/build_hold.py [--write]      -> Item Assembly & BOM/SmallCycle/IA_HOLD.json
"""
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(IASC, "..", ".."))
sys.path.insert(0, os.path.join(IASC, "..", "iav2", "lib"))
# HD_CODE (a mutant copy) also supplies the SQL
sys.path.insert(0, os.environ.get("HD_CODE") or os.path.join(HERE, "code"))
sys.path.insert(0, os.path.join(IASC, "code", "shared"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402
import sql_hold as S  # noqa: E402
import sql as SC  # noqa: E402

CODE = os.environ.get("HD_CODE") or os.path.join(HERE, "code")
OUT = os.environ.get("HD_OUT") or os.path.join(ROOT, "Item Assembly & BOM", "SmallCycle")
ONRES = "On Reserved Goods Delivery:Table:1935880014687440897"
IA_TABLE = "Item Assembly:Table:2098256587713404929"
N = V.N
ROW_COLS = ["doc_type", "status", "doc_id", "doc_no", "doc_line_id", "material_id", "bin_location", "batch_id", "item_uom", "reserved_qty", "open_qty", "delivered_qty",
            "from_category", "plant_id", "organization_id", "reserved_date", "job_line_key", "parent_id", "parent_no", "parent_line_id", "target_gd_id", "source_reserved_id",
            # the item master's code / name / description, as a Goods Delivery's rows carry them (user 10-22)
            "item_code", "item_name", "item_desc"]


def node(nid, title, path, names, arrays=(), objects=(), extra=()):
    body = "\n".join(V.include_js(CODE, p) for p in ("shared/hold.js",) + tuple(extra)) + "\n" + V.raw(CODE, path)
    return K.code(nid, title, body, names, arrays=arrays, objects=objects)


def upd(ids, nid, title, src, field, props, table=ONRES):
    """an update by the exact ids a code node computed (an update-node's WHERE does not filter: never rely on it)"""
    return K.update(ids, nid, title, table, ("id", "in", N(src, "data.%s.id" % field)), [(p, N(src, "data.%s.%s" % (field, p))) for p in ["id"] + props])


def ret(nid, title, src):
    return K.ret(nid, title, [("code", N(src, "data.code")), ("message", N(src, "data.message")), ("result_json", N(src, "data.result_json"))])


def fixes(ids, tag, src):
    """the four row writes of an outcome (DONE: publish + close; NOTHING: drop + restore), each gated on its own list"""
    return [V.gate(ids, "cor_HD%sPublish" % tag, "New holds to publish (Processing -> Allocated)?", src, "needPublish",
                   [upd(ids, "update_node_HD%sPublish" % tag, "On Reserved: Processing -> Allocated (the stock moved)", src, "%spublish" % ("fix." if tag == "fix" else ""), ["status"])]),
            V.gate(ids, "cor_HD%sClose" % tag, "Released holds to close?", src, "needClose",
                   [upd(ids, "update_node_HD%sClose" % tag, "On Reserved: Releasing -> Cancelled (open 0; reserved kept as the released amount)", src,
                        "%sclose" % ("fix." if tag == "fix" else ""), ["status", "open_qty", "reserved_qty"])]),
            V.gate(ids, "cor_HD%sDrop" % tag, "New holds to drop (nothing moved)?", src, "needDrop",
                   [upd(ids, "update_node_HD%sDrop" % tag, "On Reserved: Processing rows soft-deleted (nothing moved)", src, "%sdrop" % ("fix." if tag == "fix" else ""), ["is_deleted"])]),
            V.gate(ids, "cor_HD%sRestore" % tag, "Released holds to restore (nothing moved)?", src, "needRestore",
                   [upd(ids, "update_node_HD%sRestore" % tag, "On Reserved: Releasing -> Allocated (nothing moved)", src, "%srestore" % ("fix." if tag == "fix" else ""), ["status"])])]


def build():
    ids = K.Ids(1792200000000)
    G, P, D, MV, MX, A, F, R = ("code_node_HDguard", "code_node_HDplan", "code_node_HDdelta", "code_node_HDmoves", "code_node_HDmutex", "code_node_HDans",
                                "code_node_HDfinish", "code_node_HDreview")
    t, ia, org, uid = N(G, "data.tenantId"), N(G, "data.ia"), N(G, "data.org"), N(G, "data.uid")
    j = ["j"]
    ticket = [
        K.add(ids, "add_node_HDticket", "GD Publish Step: our ticket of the IA's hold mutex (IAH|<ia> / TICKET|<n>, HELD)", V.STEP,
              [(p, N(MV, "data.ticketRows.%s" % p)) for p in V.STEP_PROPS], labels={"organization_id": "Organization"}),
        K.sql("sql_node_HDtickets", "The HELD tickets now (the lowest live one wins)", V.sub(S.TICKETS, T=t, IAQ=ia), j),
        node(MX, "Mutex: are we the lowest live ticket?", "hold/mutex.js", ["route", "ticketId", "freeRows", "needFree"], arrays=("freeRows",)),
        K.if_(ids, "if_HDlose", "IF another run holds the IA: free our ticket, BUSY", V.is_(MX, "route", "LOSE"), [
            upd(ids, "update_node_HDfreeLose", "GD Publish Step: our ticket FREE (we lost)", MX, "freeRows", ["step_status", "finished_at"], table=V.STEP),
            K.ret("return_node_HDbusy", "Return 409 BUSY", [("code", "409"), ("message", "Another reservation of this Item Assembly is running: try again in a moment."),
                                                           ("result_json", "")])]),
        V.gate(ids, "cor_HDdeliver", "CLOSE: used holds to deliver?", MV, "needDeliver", [
            upd(ids, "update_node_HDdeliver", "On Reserved: the used holds Delivered (reserved = delivered, open 0, the completed number)", MV, "deliver",
                ["status", "delivered_qty", "reserved_qty", "open_qty", "doc_no"])]),
        V.gate(ids, "cor_HDadd", "New rows to write (Processing; a CLOSE remainder Releasing)?", MV, "needAdd", [
            K.add(ids, "add_node_HDrows", "On Reserved: the new holds and kept remainders, Processing (every reader skips them until the stock moved)", ONRES,
                  [(c, N(MV, "data.add.%s" % c)) for c in ROW_COLS])]),
        V.gate(ids, "cor_HDmark", "Rows to release (Releasing)?", MV, "needMark", [
            upd(ids, "update_node_HDmark", "On Reserved: the rows to release -> Releasing (with the operation key)", MV, "mark", ["status", "job_line_key"])]),
        V.gate(ids, "cor_HDcall", "Stock to move?", MV, "needCall", [
            V.call(ids, "workflow_node_HDapply", "INVENTORY_BULK_APPLY APPLY (IAH|<ia>|<n>: releases then holds; locked, all or nothing, replayed on a re-run)", V.ENGINE, [
                ("operation_key", N(MV, "data.opKey")), ("mode", "APPLY", "value"), ("organization_id", org), ("movements", N(MV, "data.moves"))])]),
    ]
    go = [
        V.gate(ids, "cor_HDbal", "Free stock to read?", D, "needBal", [
            K.sql("sql_node_HDbal", "The free stock at the keys (Unrestricted / Blocked), duplicate balance rows, costing rows to migrate",
                  V.sub(S.BAL, T=t, KEYS=N(D, "data.keysJson"), MATS=N(D, "data.mats"), PLANT=N(D, "data.plant"), PLANTQ=N(D, "data.plant"), ORG=org), j)]),
        node(MV, "Moves: screens, caps by free stock, the ticket, the engine moves (releases first), the rows to write", "hold/moves.js",
             ["route", "opKey", "moves", "holds", "releases", "short", "notHeld", "stuck", "add", "mark", "ticketRows", "needTicket", "needCall", "needAdd", "needMark", "why",
              "deliver", "needDeliver"], arrays=("moves", "holds", "releases", "short", "notHeld", "add", "mark", "ticketRows", "deliver")),
        V.gate(ids, "cor_HDticket", "A move to make: take the IA's hold ticket", MV, "needTicket", ticket),
        node(A, "Answer: 200 = applied; 400 with a result_code = refused, nothing moved; else read the engine's record", "hold/ans.js",
             ["outcome", "code", "result_code", "message", "needOps", "opsJson"]),
        V.gate(ids, "cor_HDops2", "Uncertain answer: the engine's record of our operation?", A, "needOps", [
            K.sql("sql_node_HDops2", "The engine's record of our operation (DONE / intents)", V.sub(S.OPS, T=t, OPSQ=N(A, "data.opsJson")), j)]),
        K.sql("sql_node_HDhead", "The IA header now (a save while this run worked marked it RESERVING again)", V.sub(S.HEAD, T=t, IA=ia), j),
        node(F, "Finish: our rows by outcome, the label from required versus held, the header, the ticket", "hold/finish.js",
             ["outcome", "publish", "close", "drop", "restore", "needPublish", "needClose", "needDrop", "needRestore", "headRows", "cancelRows", "needCancel", "freeRows", "needFree",
              "code", "message", "result_json"],
             arrays=("publish", "close", "drop", "restore", "headRows", "cancelRows", "freeRows")),
    ] + fixes(ids, "", F) + [
        upd(ids, "update_node_HDhead", "Item Assembly: material_hold_status / material_hold_at", F, "headRows", ["material_hold_status", "material_hold_at"], table=IA_TABLE),
        V.gate(ids, "cor_HDcancel", "CANCEL with everything released: the IA Cancelled", F, "needCancel", [
            upd(ids, "update_node_HDcancel", "Item Assembly: item_assembly_status Cancelled", F, "cancelRows", ["item_assembly_status"], table=IA_TABLE)]),
        V.gate(ids, "cor_HDfree", "Our ticket to free?", F, "needFree", [
            upd(ids, "update_node_HDfree", "GD Publish Step: our ticket FREE", F, "freeRows", ["step_status", "finished_at"], table=V.STEP)]),
        ret("return_node_HDdone", "Return the reservation result", F),
    ]
    after_plan = [
        V.gate(ids, "cor_HDops", "An unfinished run's rows: the engine's record of its operations?", P, "needOps", [
            K.sql("sql_node_HDops", "The engine's record of the unfinished operations (DONE / intents)", V.sub(S.OPS, T=t, OPSQ=N(P, "data.opsJson")), j)]),
        V.gate(ids, "cor_HDconsumed", "CLOSE: what the completion issued from Reserved, and this cycle's deliveries?", P, "needConsumed", [
            K.sql("sql_node_HDconsumed", "This cycle's IA OUT movements from Reserved (by item, bin, batch) and its Delivered rows",
                  V.sub(S.CONSUMED, T=t, IA=ia, IAQ=ia, NOHEX=N(P, "data.noHex"), ORG=org), j)]),
        node(D, "Delta: an unfinished run resolved, then wanted versus held: holds, releases, the keys to read", "hold/delta.js",
             ["route", "fix", "needPublish", "needClose", "needDrop", "needRestore", "rowsAfter", "holds", "releases", "notHeld", "keysJson", "mats", "needBal", "plant",
              "deliver", "over", "under", "why", "acquireOff"], arrays=("rowsAfter", "holds", "releases", "notHeld", "deliver", "over", "under"), objects=("fix",),
             extra=("shared/split.js",)),
    ] + fixes(ids, "fix", D) + [
        K.if_(ids, "if_HDreview", "IF an earlier move did not report back: Needs review, no new move", V.is_(D, "route", "REVIEW"), [
            node(R, "Review: the IA marked Needs review", "hold/review.js", ["headRows", "code", "message", "result_json"], arrays=("headRows",)),
            upd(ids, "update_node_HDreviewHead", "Item Assembly: material_hold_status REVIEW", R, "headRows", ["material_hold_status", "material_hold_at"], table=IA_TABLE),
            ret("return_node_HDreview", "Return Needs review", R)]),
    ] + go
    nodes = [
        node(G, "Guard: digit ids, the operation and its caller, the session tenant and user", "hold/guard.js",
             ["route", "code", "tenantId", "uid", "ia", "org", "op", "source", "result_message", "result_json"]),
        K.if_(ids, "if_HDreject", "IF the request is invalid", V.is_(G, "route", "REJECT"),
              [K.ret("return_node_HDreject", "Return 400", [("code", N(G, "data.code")), ("message", N(G, "data.result_message")), ("result_json", N(G, "data.result_json"))])]),
        # BA rev 1.2 C2: CHECK, read-only, before any IA read: how a completed IA's completion ended
        K.if_(ids, "if_HDcheck", "IF CHECK: how a completed IA's completion ended", V.is_(G, "route", "CHECK"), [
            K.sql("sql_node_HDcheck", "The IA's completion claims, its status and organisation, the clock", V.sub(S.CHECK, T=t, IAQ=ia), j),
            node("code_node_HDcheck", "Check: the latest claim that did not lose decides", "hold/check.js", ["code", "message", "result_json"]),
            ret("return_node_HDcheck", "Return how the completion ended", "code_node_HDcheck")]),
        # MIN-05 (BA 10-22): SWEEP, read-only, before any IA read
        K.if_(ids, "if_HDsweep", "IF SWEEP: the IAs deleted while still holding", V.is_(G, "route", "SWEEP"), [
            K.sql("sql_node_HDsweep", "The IAs deleted while still marked as holding (at most 20)", V.sub(S.SWEEP, T=t), j),
            node("code_node_HDsweep", "Sweep: their ids and organisations", "hold/sweep.js", ["code", "message", "result_json"]),
            ret("return_node_HDsweep", "Return the IAs to release", "code_node_HDsweep")]),
        K.parallel("condition_all_HDread", "Reads (independent, one join)", [
            ("cai_HDstate", "IA", [K.sql("sql_node_HDstate", "The IA: header, lines, its own hold rows, its tickets, the clock", V.sub(S.STATE, T=t, IA=ia, IAQ=ia, ORG=org), j)]),
            ("cai_HDitems", "Items", [K.sql("sql_node_HDitems", "The IA's items: flags, units, costing method", V.sub(S.ITEMS, T=t, IA=ia), j)]),
            ("cai_HDmember", "Member", [K.sql("sql_node_HDmember", "Is the session user assigned to the organisation (FIX-03)", V.sub(SC.MEMBER, T=t, ORG=org, UID=uid), j)]),
        ]),
        node(P, "Plan: refusals, enrolment, the mutex, an unfinished run's operations, CLOSE's read", "hold/plan.js",
             ["route", "code", "message", "needOps", "opsJson", "now", "needConsumed", "noHex", "badNo"]),
        K.if_(ids, "if_HDstop", "IF there is nothing to do or it is refused", V.is_(P, "route", "STOP"),
              [K.ret("return_node_HDstop", "Return", [("code", N(P, "data.code")), ("message", N(P, "data.message")), ("result_json", "")])]),
    ] + after_plan
    request = [(n, "string", d) for n, d in [("ia_id", "the Item Assembly"), ("organization_id", "its organisation"), ("operation", "RECONCILE | RELEASE_ALL | CLOSE | CANCEL | SWEEP | CHECK"),
                                              ("source", "SAVE | FORM | LIST | REVERT | COMPLETE")]]
    return K.workflow(request, ["code", "message", "result_json"], nodes)


BUILDERS = [("IA_HOLD", build)]

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    V.build(BUILDERS, OUT, "--write" in sys.argv, args)
