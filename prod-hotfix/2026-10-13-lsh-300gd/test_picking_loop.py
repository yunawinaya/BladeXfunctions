#!/usr/bin/env python3
"""PICKING_LOOP, BASE (dev v85 = prod v40) vs the built file, on the LSH 300-GD convert (read-only).

The loop body is not kept in a trace, so the inputs are that run's request (arrayData) and the Picking it
added, read back from the database in the shape the add-node / search-node hand on.
usage: python3 test_picking_loop.py [built.json]     (default: the repo file)
"""
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import replay_tests as rt  # noqa: E402
import build_repair_sql as brs  # noqa: E402  as_fetched()
import build_picking_loop as bl  # noqa: E402

CONVERT_RUN = 2109684612757327874   # PICKING_LOOP Add, PI-20261013-1502, 300 GDs / 2,096 lines, 190 s
PICKING = 2109684632214704129


def code(wf, nid):
    return bl.bp.node(wf, nid)["data"]["script"]["code"]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else bl.MAIN
    _, base = bl.bs_enabled("--prod")
    new = json.load(open(path, encoding="utf-8"))
    row = rt.db(f"SELECT request_json_data FROM su_code_workflow_inst WHERE id={CONVERT_RUN}")[0]
    params = json.loads(row["request_json_data"]).get("request_json") or {}
    item = params["arrayData"][0]
    print(f"convert run {CONVERT_RUN}: saveAs {params['saveAs']}, pageStatus {params['pageStatus']}, "
          f"{len(params['arrayData'])} Picking, {len(item['table_picking_items'])} lines")

    # code_node_hjAwTKzF: the loop item instead of arrayData[index]
    nodes = {"get_cache_node_hGFbHnzQ": {"data": "0"}, "loop_BIfi18oK": item}
    old = rt.run(code(base, "code_node_hjAwTKzF"), params, nodes)
    cur = rt.run(code(new, "code_node_hjAwTKzF"), params, nodes)
    assert cur.pop("itemCount") == len(item["table_picking_items"])
    assert rt.same(old, cur), "hjAwTKzF output changed"
    print("  code_node_hjAwTKzF: same output (+ itemCount 2096)")

    # code_node_jZbs5DDd + CHECK_REQUIRED_FIELD: same verdict with the placeholder list
    _, req_wf = __import__("build_so_to_gd").enabled("--prod", 1988831880511062018)
    validate = bl.bp.node(req_wf, "code_node_AeSdXE85")["data"]["script"]["code"]
    prepared = cur["data"]  # to_id already "issued", as the run passes it on
    for label, items in (("2096 lines", item["table_picking_items"]), ("no lines", []), ("missing", None)):
        data = dict(prepared, table_picking_items=items)
        if items is None:
            data.pop("table_picking_items")
        n = {"code_node_hjAwTKzF": rt.wrap({"data": data, "itemCount": len(items or [])})}
        o = rt.run(code(base, "code_node_jZbs5DDd"), params, n)
        c = rt.run(code(new, "code_node_jZbs5DDd"), params, n)
        vo = rt.run(validate, {"entry": o["data"], "required_fields": o["required_fields"]}, {})
        vc = rt.run(validate, {"entry": c["data"], "required_fields": c["required_fields"]}, {})
        assert vo == vc, (label, vo, vc)
        assert (vc["status"] == "Passed") == (label == "2096 lines"), (label, vc)
        print(f"  CHECK_REQUIRED_FIELD, {label}: same verdict ({vc['status']}); entry {len(o['data'])} -> {len(c['data'])} chars")

    # code_node_1HuvfKMv on the Picking the convert added (read back)
    head = brs.as_fetched(rt.db(f"SELECT * FROM transfer_order WHERE id={PICKING}")[0], "transfer_order")
    lines = [brs.as_fetched(r, "transfer_order_jz8m9w3h_sub") for r in rt.db(
        f"SELECT * FROM transfer_order_jz8m9w3h_sub WHERE transfer_order_id={PICKING} AND is_deleted=0 ORDER BY id")]
    nodes = {"add_node_j6HU6pFP": {"data": [head]}, "search_node_OmBi3hyy": rt.wrap({"data": lines}),
             "code_node_hjAwTKzF": rt.wrap({"data": item})}
    o = rt.run(code(base, "code_node_1HuvfKMv"), params, nodes)
    c = rt.run(code(new, "code_node_1HuvfKMv"), params, nodes)
    assert set(map(str, o["gdIds"])) == set(c["gdIdCsv"].split(","))
    assert {str(i["gd_line_id"]) for i in o["filteredPickingItems"]} == set(c["gdLineIdCsv"].split(","))
    assert c["isPickingPlan"] == o["isPickingPlan"] == 0 and c["toIdCsv"] == c["toLineIdCsv"] == ""
    print(f"  code_node_1HuvfKMv: GD header writes {len(o['gdIds'])} -> {len(c['gdIdCsv'].split(','))}; "
          f"lines {len(o['filteredPickingItems'])} -> {len(c['gdLineIdCsv'].split(','))} (same ids)")

    # sql_node_StampState at that size, then code_node_StampPlan
    sql = bl.bp.node(new, "sql_node_StampState")["data"]["script"]["code"]
    for k in ("gdIdCsv", "gdLineIdCsv", "toIdCsv", "toLineIdCsv"):
        sql = sql.replace("{{node:code_node_1HuvfKMv.data.%s}}" % k, c[k])
    t = time.time()
    rows = rt.db(sql)
    took = time.time() - t
    kinds = {}
    for r in rows:
        kinds[(r["kind"], r["picking_status"])] = kinds.get((r["kind"], r["picking_status"]), 0) + 1
    print(f"  sql_node_StampState on prod: {len(rows)} rows in {took:.2f}s: {kinds}")
    plan_code = code(new, "code_node_StampPlan")
    out = rt.run(plan_code, {}, {"sql_node_StampState": {"data": rows}})
    assert out["hasGdIds"] == out["hasGdLineIds"] == 0  # everything is picked by now: nothing to re-stamp
    mixed = [{"kind": "gd", "id": "1", "picking_status": "Not Created"}, {"kind": "gd", "id": "2", "picking_status": "In Progress"},
             {"kind": "gd", "id": "3", "picking_status": ""}, {"kind": "gd_line", "id": "11", "picking_status": "Completed"},
             {"kind": "gd_line", "id": "12", "picking_status": "Cancelled"}, {"kind": "gd_line", "id": "13", "picking_status": "Created"},
             {"kind": "pp", "id": "21", "picking_status": "Not Created"}, {"kind": "pp_line", "id": "31", "picking_status": "In Progress"}]
    out = rt.run(plan_code, {}, {"sql_node_StampState": {"data": mixed}})
    assert (out["gdIds"], out["gdLineIds"], out["toIds"], out["toLineIds"]) == (["1", "3"], ["12"], ["21"], [])
    assert (out["hasGdIds"], out["hasGdLineIds"], out["hasToIds"], out["hasToLineIds"]) == (1, 1, 1, 0)
    one = rt.run(plan_code, {}, {"sql_node_StampState": {"data": mixed[0]}})  # a single row may come back unwrapped
    assert one["gdIds"] == ["1"]
    print("  code_node_StampPlan: stamps Not Created / Cancelled / empty only; In Progress, Created, Completed kept")

    # code_node_uPSc7Syb no longer needs arrayData
    u = rt.run(code(new, "code_node_uPSc7Syb"), {}, {})
    assert u["unique"] and "_" in u["unique"]
    print("  code_node_uPSc7Syb: key without arrayData:", u["unique"])
    print("all passed")


if __name__ == "__main__":
    main()
