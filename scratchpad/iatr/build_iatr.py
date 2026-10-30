"""IA_TRANSFER_REQUEST (ENH-20261027-001; plan top section): an Item Assembly's Location Transfer request - CREATE, REFRESH, CANCEL,
STATUS; v8 (reserved requests, scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 7): a Created IA's, from its RES-01 reservation, plus
REPLACE (after a receipt) and DEFECT (Reserved -> Blocked at the staging bin, one engine operation). Goes into the spare workflow slot
"Workflow 5" 1985966508400201729 (same id on dev and prod, user 10-28).

  guard -> 4 reads in one fork-join (the IA + lines + items + units; its requests + the one named; the destination + number rule; the
  session user + clock + claim number) -> decide: an answer now, or GO -> our claim (IATR|<ia> / CLAIM|<n>, HELD; a twin's insert fails
  on the unique key) -> the claims read back -> win (the lowest live claim, the facts unchanged) or LOSE (claim freed, 409) -> the write
  (CREATE / REPLACE: add-node, the LOT + its lines, numbered at the insert; REFRESH: the LOT's fingerprint, revision, log and lines;
  DEFECT: INVENTORY_BULK_APPLY, then the reservation rows, the IA lines, the received request's log; CANCEL: Cancelled + the log, no
  stock call) -> the request read back -> done (verify, the IA link for CREATE / REPLACE, our claim freed) -> answer.

usage: python3 scratchpad/iatr/build_iatr.py [--write]   (IATR_REQ_OUT=<dir> writes there instead of the repo)"""
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "scratchpad", "iav2", "lib"))
sys.path.insert(0, os.path.join(HERE, "request"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402
import request_sql as Q  # noqa: E402

CODE = os.path.join(HERE, "code")
OUT = os.environ.get("IATR_REQ_OUT") or os.path.join(REPO, "Item Assembly & BOM", "TransferRequest")
WF_ID = "1985966508400201729"
LOT = "Location Transfer:Table:2013791389687349250"
IA_TABLE = "Item Assembly:Table:2098256587713404929"
ONRES = "On Reserved Goods Delivery:Table:1935880014687440897"
IA_LINES = "Stock movement(Item Assembly):Table:2098269596661833730"
N = V.N
G, DEC, WIN, DONE = "code_node_TRguard", "code_node_TRdecide", "code_node_TRwin", "code_node_TRdone"
# the classic's add_node_xxQX3uMU props (SM_LOCATION_TRANSFER v85) + the request's fields (the LOT form publish creates them)
LOT_ADD_PROPS = ["stock_movement_status", "issuing_operation_faci", "issue_date", "stock_movement_no", "movement_type", "movement_type_id", "movement_reason",
                 "issued_by", "reference_documents", "organization_id", "project_id", "is_production_order", "production_order_id", "stock_movement", "remarks", "remark",
                 "remark2", "remark3", "stock_movement_no_type"] + Q.NEW_LOT_COLUMNS
REFRESH_PROPS = ["source_ia_fp", "source_ia_rev", "request_log", "stock_movement"]
CANCEL_PROPS = ["stock_movement_status", "lot_v2_job_id", "request_log"]
DECIDE_FIELDS = ["route", "code", "message", "result_json", "claimRows", "claimName", "isCreate", "isRefresh", "isDefect", "isCancel", "lot", "refresh", "cancel", "defect",
                 "want", "relink"]
SHARED_JS = ["iatr_rules.js", "iatr_ia.js", "iatr_reserve.js", "iatr_ia2.js"]


def node(nid, title, path, names, arrays=(), objects=()):
    body = "\n".join([V.include_js(CODE, "shared/" + f) for f in SHARED_JS] + [V.raw(CODE, "request/_common.js"), V.raw(CODE, path)])
    return K.code(nid, title, body, names, arrays=arrays, objects=objects)


def ret(nid, title, src):
    return K.ret(nid, title, [("code", N(src, "data.code")), ("message", N(src, "data.message")), ("result_json", N(src, "data.result_json"))])


def build():
    ids = K.Ids(1797800000000)
    T, IA, ORG, UID, LOTQ = N(G, "data.tenantId"), N(G, "data.ia"), N(G, "data.org"), N(G, "data.uid"), N(G, "data.lot")
    reads = K.parallel("condition_all_TRread", "Reads (independent, one join)", [
        ("cai_TRia", "IA", [K.sql("sql_node_TRia", "The Item Assembly: header; with its lines (+ picks), items, units and RES-01 reservation rows; DEFECT: the summary's names",
                                  V.sub(Q.IA_READ, T=T, IA=IA, ORG=ORG, NEEDLINES=N(G, "data.needLines"), NEEDDEFECT=N(G, "data.needDefect")), ["j"])]),
        ("cai_TRreq", "Requests", [K.sql("sql_node_TRreq", "The IA's transfer requests (DEFECT: + logs); the one named (REFRESH / CANCEL) with its lines, open jobs and In Transit rows",
                                         V.sub(Q.REQ_READ, T=T, IA=IA, LOT=LOTQ, NEEDNAMED=N(G, "data.needNamed"), NEEDDEFECT=N(G, "data.needDefect")), ["j"])]),
        ("cai_TRdest", "Destination", [K.sql("sql_node_TRdest", "CREATE / REPLACE: the destination storage location and bin, the organisation's Location Transfer number rule",
                                             V.sub(Q.DEST_READ, T=T, ORG=ORG, SL=N(G, "data.sl"), BIN=N(G, "data.bin"), NEEDDEST=N(G, "data.needDest")), ["j"])]),
        ("cai_TRwho", "User", [K.sql("sql_node_TRwho", "The session user: assigned to the organisation (FIX-03), its name; the clock; the IA's highest claim number; Item Assembly Setup",
                                     V.sub(Q.WHO_READ, T=T, ORG=ORG, UID=UID, IA=IA), ["j"])]),
    ])
    DANS = "code_node_TRdefectAns"
    defect = [
        V.call(ids, "workflow_node_TRdefect", "INVENTORY_BULK_APPLY APPLY: Reserved -> Blocked at the staging bin (IA-D; IAD|<click>: the same click replays it)", V.ENGINE, [
            ("operation_key", N(DEC, "data.defect.opKey")), ("mode", "APPLY", "value"), ("organization_id", N(G, "data.org")), ("movements", N(DEC, "data.defect.movements"))]),
        node(DANS, "DEFECT: the engine's answer (200 -> the rows follow; else nothing more, our claim freed)", "request/defect.js", ["route", "code", "message", "free"],
             objects=("free",)),
        K.if_(ids, "if_TRdefectStop", "IF the engine did not move it: free our claim, answer", V.is_(DANS, "route", "STOP"), [
            K.update(ids, "update_node_TRfreeDefect", "GD Publish Step: our claim FREE (the engine refused)", V.STEP, ("id", "in", N(DANS, "data.free.id")),
                     [(p, N(DANS, "data.free." + p)) for p in ("step_status", "finished_at", "result_ref")]),
            K.ret("return_node_TRdefectStop", "Return the engine's refusal", [("code", N(DANS, "data.code")), ("message", N(DANS, "data.message")), ("result_json", "{}")]),
        ]),
        K.update(ids, "update_node_TRdefectHolds", "On Reserved: the defect off the IA's rows at the staging bin (open / reserved; Cancelled at 0)", ONRES,
                 ("id", "in", N(DEC, "data.defect.holdRows.id")), [(p, N(DEC, "data.defect.holdRows." + p)) for p in ("id", "open_qty", "reserved_qty", "status")]),
        K.update(ids, "update_node_TRdefectLines", "Item Assembly lines: the picks, total and stock summary less the defect", IA_LINES,
                 ("id", "in", N(DEC, "data.defect.iaRows.id")), [(p, N(DEC, "data.defect.iaRows." + p)) for p in ("id", "temp_qty_data", "total_quantity", "stock_summary")]),
        K.update(ids, "update_node_TRdefectLog", "Location Transfer: the received request's log gains the defect", LOT, ("id", "in", N(DEC, "data.defect.logRow.id")),
                 [(p, N(DEC, "data.defect.logRow." + p)) for p in ("id", "request_log")]),
    ]
    writes = K.if_(ids, "if_TRcreate", "IF CREATE / REPLACE: insert the request", V.is_(DEC, "isCreate", "YES"), [
        K.add(ids, "add_node_TRlot", "Location Transfer + lines: the request (Requested; numbered at the insert by the organisation's rule)", LOT,
              [(p, N(DEC, "data.lot." + p)) for p in LOT_ADD_PROPS], labels={"stock_movement_status": "Stock Movement Status"}),
    ], [
        K.if_(ids, "if_TRrefresh", "IF REFRESH (else DEFECT / CANCEL)", V.is_(DEC, "isRefresh", "YES"), [
            K.update(ids, "update_node_TRrefresh", "Location Transfer: the request's new lines (the old ones soft-deleted), fingerprint, revision, log", LOT,
                     ("id", "in", N(DEC, "data.refresh.id")), [(p, N(DEC, "data.refresh." + p)) for p in REFRESH_PROPS]),
        ], [
            K.if_(ids, "if_TRdefect", "IF DEFECT (else CANCEL)", V.is_(DEC, "isDefect", "YES"), defect, [
                K.update(ids, "update_node_TRcancel", "Location Transfer: the request Cancelled (state only: no stock call), not linked to a job, its log", LOT,
                         ("id", "in", N(DEC, "data.cancel.id")), [(p, N(DEC, "data.cancel." + p)) for p in CANCEL_PROPS],
                         labels={"stock_movement_status": "Stock Movement Status"}),
            ]),
        ]),
    ])
    go = [
        V.step_add(ids, "add_node_TRclaim", "GD Publish Step: our claim on the IA's request (IATR|<ia> / CLAIM|<n>; a twin's insert fails on the unique key)", DEC,
                   "claimRows"),
        K.sql("sql_node_TRclaims", "The IA's HELD claims, its status, its requests and the named request's open jobs now",
              V.sub(Q.CLAIM_READ, T=T, IA=IA, LOT=LOTQ), ["j"]),
        node(WIN, "Win: ours the lowest live claim, the facts unchanged?", "request/win.js", ["route", "message", "claimId", "free", "needFree"], objects=("free",)),
        K.if_(ids, "if_TRlose", "IF another change holds the IA's request (or the facts changed): free our claim, 409", V.is_(WIN, "route", "LOSE"), [
            V.gate(ids, "cor_TRfreeLose", "Our claim to free?", WIN, "needFree", [
                K.update(ids, "update_node_TRfreeLose", "GD Publish Step: our claim FREE (lost)", V.STEP, ("id", "in", N(WIN, "data.free.id")),
                         [(p, N(WIN, "data.free." + p)) for p in ("step_status", "finished_at", "result_ref")])]),
            K.ret("return_node_TRlose", "Return 409", [("code", "409"), ("message", N(WIN, "data.message")), ("result_json", "{}")]),
        ], [
            writes,
            K.sql("sql_node_TRback", "Read-back: the request (the one named, else the IA's newest) with its lines; DEFECT: the IA's reservation rows and lines",
                  V.sub(Q.BACK_READ, T=T, IA=IA, LOT=LOTQ, ORG=ORG, NEEDDEFECT=N(G, "data.needDefect")), ["j"]),
            node(DONE, "Done: the read-back shows the write; CREATE / REPLACE link the IA; our claim freed", "request/done.js",
                 ["code", "message", "result_json", "link", "needLink", "free"], objects=("link", "free")),
            V.gate(ids, "cor_TRlink", "CREATE / REPLACE: link the IA to its request (CANCEL of a replacement: back to the received one)?", DONE, "needLink", [
                K.update(ids, "update_node_TRia", "Item Assembly: transfer_request_id / _no (display; the request's source_ia_id is authoritative)", IA_TABLE,
                         ("id", "in", N(DONE, "data.link.id")), [(p, N(DONE, "data.link." + p)) for p in ("transfer_request_id", "transfer_request_no")])]),
            K.update(ids, "update_node_TRfree", "GD Publish Step: our claim FREE (done)", V.STEP, ("id", "in", N(DONE, "data.free.id")),
                     [(p, N(DONE, "data.free." + p)) for p in ("step_status", "finished_at", "result_ref")]),
            ret("return_node_TRdone", "Return", DONE),
        ]),
    ]
    nodes = [
        node(G, "Guard: the operation, digit ids, the session tenant and user, what the operation reads", "request/guard.js",
             ["route", "code", "message", "tenantId", "uid", "op", "ia", "org", "lot", "sl", "bin", "requiredDate", "expectFp", "key", "needLines", "needNamed", "needDest",
              "needDefect", "defects", "result_json"], objects=("defects",)),
        K.if_(ids, "if_TRreject", "IF the request is invalid", V.is_(G, "route", "REJECT"), [ret("return_node_TRreject", "Return 400", G)], [
            reads,
            node(DEC, "Decide: an answer now, or our claim and the write", "request/decide.js", DECIDE_FIELDS, arrays=("claimRows",),
                 objects=("lot", "refresh", "cancel", "defect", "want", "relink")),
            K.if_(ids, "if_TRanswer", "IF answered now (STATUS, a refusal, already done)", "'%s' != 'GO'" % N(DEC, "data.route"),
                  [ret("return_node_TRanswer", "Return the answer", DEC)], go),
        ]),
    ]
    request = [(n, "string", d) for n, d in [
        ("operation", "CREATE | REFRESH | REPLACE | DEFECT | CANCEL | STATUS"), ("ia_id", "the Item Assembly"), ("organization_id", "the caller's organisation"),
        ("lot_id", "REFRESH / CANCEL: the request"), ("expected_fp", "CREATE / REFRESH / REPLACE: the IA as the form shows it (iatrIaFp, IA1)"),
        ("storage_location_id", "CREATE / REPLACE: the destination storage location (REPLACE: the received request's)"),
        ("location_id", "CREATE / REPLACE: the destination bin (REPLACE: the received request's staging bin)"), ("required_date", "CREATE / REPLACE: YYYY-MM-DD"),
        ("idempotency_key", "every operation but STATUS: the click's key"),
        ("defects", "DEFECT: JSON text {<IA line id>: {qty, reason} | {batches: {<batch id>: qty}, reason}}")]]
    doc = K.workflow(request, ["code", "message", "result_json"], nodes)
    K.check_ids(doc)
    return doc


def render(doc):
    return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


if __name__ == "__main__":
    doc = V.wrap_doc_sql(build())
    text = render(doc)
    path = os.path.join(OUT, "IA_TRANSFER_REQUEST.json")
    print("IA_TRANSFER_REQUEST: %d chars, md5 %s%s" % (len(text), hashlib.md5(text.encode("utf-8")).hexdigest(), " -> " + path if "--write" in sys.argv else " (dry)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text)
