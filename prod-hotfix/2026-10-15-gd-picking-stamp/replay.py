#!/usr/bin/env python3
"""Replay GD_UNUSED_FN_NEW Branch 4 (Picking stamp) on real prod runs: BASE (prod enabled) vs the built fix.

  python3 replay.py            # incident + Created-path case + sweep of recent prod Branch-4 runs
  python3 replay.py --days 20  # widen the sweep
"""
import json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import find  # noqa: E402
sys.path.insert(1, os.path.join(HERE, "..", "2026-10-08-bug-register"))
from replay_tests import db, trace, run, same, same_as_recorded, run_time_ms, wrap  # noqa: E402

WF_ID = 2032273338771128322
INCIDENT_RUN = 2105589201708912641   # TA188799 completion, 2026-10-01 17:22
PK03767_REC = "2105515679116562433"
PK03767_HDR = "2105515672686694402"

BASE_VERSION = 49   # prod before the fix (v50 = the fix)
_row = db(f"SELECT script_json FROM su_code_workflow_history WHERE data_id={WF_ID} AND version_number={BASE_VERSION} "
          f"AND status <> 'draft' ORDER BY create_time LIMIT 1")
BASE_DOC = json.loads(_row[0]["script_json"])
FIX_DOC = json.load(open(os.path.join(HERE, "GD_UNUSED_FN_NEW.prod.json"), encoding="utf-8"))
code = lambda doc, nid: find(doc, nid)["data"]["script"]["code"]


def rows_by_id(sql):
    return {str(r["id"]): r for r in db(sql)}


def record_headers(record_ids):
    ids = [i for i in record_ids if str(i).isdigit() and i != "0"]
    if not ids:
        return {}
    return rows_by_id(f"SELECT id, transfer_order_id FROM transfer_order_vrqs3cmr_sub WHERE id IN ({','.join(ids)})")


def search_out(rows):
    return wrap({"total": len(rows), "count": len(rows), "data": rows})


def fixed_chain(params, nodes, headers_fixture, now):
    """OBz5tEws -> PkRec8Hd (from DB) -> PkHdrIds -> 68C0TVzK (fixture) -> xVqrs3Yi, on the fixed scripts."""
    nodes = dict(nodes)
    ob = run(code(FIX_DOC, "code_node_OBz5tEws"), params, nodes, now)
    nodes["code_node_OBz5tEws"] = wrap(ob)
    recs = record_headers(ob["recordIds"])
    nodes["search_node_PkRec8Hd"] = search_out([{"id": int(k), "transfer_order_id": int(v["transfer_order_id"])} for k, v in recs.items()])
    hdr = run(code(FIX_DOC, "code_node_PkHdrIds"), params, nodes, now)
    nodes["code_node_PkHdrIds"] = wrap(hdr)
    nodes["search_node_68C0TVzK"] = headers_fixture(hdr["pickingIds"])
    xv = run(code(FIX_DOC, "code_node_xVqrs3Yi"), params, nodes, now)
    return ob, hdr, xv


def base_chain(params, nodes, now):
    nodes = dict(nodes)
    ob = run(code(BASE_DOC, "code_node_OBz5tEws"), params, nodes, now)
    nodes["code_node_OBz5tEws"] = wrap(ob)
    xv = run(code(BASE_DOC, "code_node_xVqrs3Yi"), params, nodes, now)
    return ob, xv


FAILS = []
def check(cond, msg):
    print(("  PASS  " if cond else "  FAIL  ") + msg)
    if not cond:
        FAILS.append(msg)


def incident():
    print("== TA188799 completion (line picks span PK-03768 = line_to_id, and PK-03767)")
    params, nodes = trace(INCIDENT_RUN)
    now = run_time_ms(INCIDENT_RUN)
    b_ob, b_xv = base_chain(params, nodes, now)
    check(same_as_recorded(b_ob, nodes["code_node_OBz5tEws"]["data"]), "BASE OBz5tEws reproduces the recorded output")
    check(same_as_recorded(b_xv, nodes["code_node_xVqrs3Yi"]["data"]), "BASE xVqrs3Yi reproduces the recorded output")
    check(PK03767_REC not in [str(u["id"]) for u in b_xv["recordUpdates"]], "BASE skips the PK-03767 record (the bug)")

    recorded = nodes["search_node_68C0TVzK"]["data"]["data"]
    # PK-03767 as it stood at 17:22 (gd_completion_snapshot 2105589200953937922: reserved 0, delivered 0)
    pk03767 = {"id": int(PK03767_HDR), "table_picking_records": [
        {"id": int(PK03767_REC), "store_out_qty": 30.0, "delivered_qty": 0.0, "reserved_qty": 0.0}]}
    fixture = lambda ids: search_out([h for h in recorded + [pk03767] if str(h["id"]) in ids])
    ob, hdr, xv = fixed_chain(params, nodes, fixture, now)
    check(sorted(hdr["pickingIds"]) == sorted(["2105515903708958722", PK03767_HDR]), f"FIX fetches both Pickings {hdr['pickingIds']}")
    upd = {str(u["id"]): u for u in xv["recordUpdates"]}
    check(same(upd.get("2105515910063329281"), next(u for u in b_xv["recordUpdates"] if str(u["id"]) == "2105515910063329281")),
          "FIX leaves the PK-03768 record update unchanged")
    check(upd.get(PK03767_REC, {}).get("delivered_qty") == 30 and upd[PK03767_REC]["delivery_status"] == "Fully Delivered",
          f"FIX stamps PK-03767 delivered 30 / Fully Delivered: {upd.get(PK03767_REC)}")
    hd = {str(h["id"]): h["delivery_status"] for h in xv["headerUpdates"]}
    check(hd.get(PK03767_HDR) == "Fully Delivered", f"FIX rolls PK-03767 header to Fully Delivered: {hd}")


def created_path():
    print("== Created save of the same line (reserved_qty stamp)")
    params, nodes = trace(INCIDENT_RUN)
    params["saveAs"] = "Created"
    for line in params["tableData"]:
        line["prev_temp_qty_data"] = None
    recorded = nodes["search_node_68C0TVzK"]["data"]["data"]
    for h in recorded:
        for r in h["table_picking_records"]:
            r["reserved_qty"], r["delivered_qty"] = 0.0, 0.0
    pk03767 = {"id": int(PK03767_HDR), "table_picking_records": [
        {"id": int(PK03767_REC), "store_out_qty": 30.0, "delivered_qty": 0.0, "reserved_qty": 0.0}]}
    nodes["search_node_68C0TVzK"] = search_out(recorded)
    _, b_xv = base_chain(params, nodes, None)
    check(PK03767_REC not in [str(u["id"]) for u in b_xv["recordUpdates"]], "BASE never reserves the PK-03767 record")
    fixture = lambda ids: search_out([h for h in recorded + [pk03767] if str(h["id"]) in ids])
    _, _, xv = fixed_chain(params, nodes, fixture, None)
    upd = {str(u["id"]): u for u in xv["recordUpdates"]}
    check(upd.get(PK03767_REC, {}).get("reserved_qty") == 30 and upd[PK03767_REC]["delivered_qty"] == 0,
          f"FIX reserves 30 on PK-03767, delivers nothing: {upd.get(PK03767_REC)}")
    check(upd.get("2105515910063329281", {}).get("reserved_qty") == 4, "FIX reserves 4 on PK-03768")


def empty_lists():
    print("== No picking records and no line_to_id")
    params, nodes = trace(INCIDENT_RUN)
    for line in params["tableData"]:
        line["temp_qty_data"] = line["prev_temp_qty_data"] = None
        line["line_to_id"] = ""
    ob = run(code(FIX_DOC, "code_node_OBz5tEws"), params, nodes, None)
    check(ob["recordIds"] == ["0"], f"recordIds sentinel {ob['recordIds']}")
    nodes["code_node_OBz5tEws"] = wrap(ob)
    nodes["search_node_PkRec8Hd"] = search_out([])
    hdr = run(code(FIX_DOC, "code_node_PkHdrIds"), params, nodes, None)
    check(hdr["pickingIds"] == ["0"], f"pickingIds sentinel {hdr['pickingIds']}")
    nodes["code_node_PkHdrIds"] = wrap(hdr)
    nodes["search_node_68C0TVzK"] = None
    xv = run(code(FIX_DOC, "code_node_xVqrs3Yi"), params, nodes, None)
    check(xv["isRecord"] == 0 and xv["isHeader"] == 0, "xVqrs3Yi survives a null search result and writes nothing")


def sweep(days):
    print(f"== Sweep: prod Branch-4 runs of the last {days} days")
    since = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))) - datetime.timedelta(days=days)
    to_id = lambda dt: (int(dt.timestamp() * 1000) - 1288834974657) << 22
    ids = []
    for h in range(0, days * 24, 6):   # 6h slices: a longtext LIKE over a wider id range hits prod's statement timeout
        a, b = since + datetime.timedelta(hours=h), since + datetime.timedelta(hours=h + 6)
        ids += [r["id"] for r in db(f"SELECT id FROM su_code_workflow_inst WHERE workflow_id={WF_ID} "
                                     f"AND id BETWEEN {to_id(a)} AND {to_id(b)} "
                                     f"AND request_json_data LIKE '%isGDPP_:1,%' ORDER BY id")]
    same_n, changed, skipped = 0, [], {"Branch 4 not run": 0, "BASE differs from recorded": 0}
    for iid in ids:
        params, nodes = trace(iid)
        if not nodes.get("code_node_xVqrs3Yi") or not nodes.get("search_node_68C0TVzK"):
            skipped["Branch 4 not run"] += 1
            continue
        now = run_time_ms(iid)
        b_ob, b_xv = base_chain(params, nodes, now)
        if not same_as_recorded(b_xv, nodes["code_node_xVqrs3Yi"]["data"]):
            skipped["BASE differs from recorded"] += 1   # nothing to compare against
            print(f"        BASE differs from recorded: run {iid}")
            continue
        recorded = nodes["search_node_68C0TVzK"]["data"]["data"]
        rec_ids = {str(h["id"]) for h in recorded}

        def fixture(ids_):
            extra = [i for i in ids_ if i not in rec_ids and i != "0"]
            if extra:
                changed.append((iid, extra))
            return search_out([h for h in recorded if str(h["id"]) in ids_])
        ob, hdr, xv = fixed_chain(params, nodes, fixture, now)
        if set(hdr["pickingIds"]) - {"0"} != rec_ids - {"0"}:
            continue
        if same(ob["pickingRecordUpdates"], b_ob["pickingRecordUpdates"]) and same_as_recorded(xv, nodes["code_node_xVqrs3Yi"]["data"]):
            same_n += 1
        else:
            FAILS.append(f"run {iid}: identical Pickings but different stamps")
            print(f"  FAIL  run {iid}: identical Pickings but different stamps")
    print(f"  {len(ids)} runs: {same_n} byte-identical, {len(changed)} now fetch an extra Picking, {skipped} skipped")
    for iid, extra in changed:
        print(f"        run {iid} adds Picking(s) {extra}")


if __name__ == "__main__":
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 7
    incident()
    created_path()
    empty_lists()
    sweep(days)
    print("\nALL PASS" if not FAILS else f"\n{len(FAILS)} FAILED")
    sys.exit(1 if FAILS else 0)
