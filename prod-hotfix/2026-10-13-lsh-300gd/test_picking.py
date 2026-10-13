#!/usr/bin/env python3
"""Replays the changed PICKING nodes against recorded runs (read-only), BASE = dev's enabled v149.

usage: python3 test_picking.py [built.json]     (default: the repo file)
       LSH_CACHE=<dir> keeps the big traces between runs.
"""
import json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import replay_tests as rt  # noqa: E402
import build_repair_sql as brs  # noqa: E402  recorded(), as_fetched()

HEALTHY = 2109783579109232642   # 8 GDs, 19 sibling Pickings, completed
FAILED = 2109686904730554369    # PI-20261013-1502, 300 GDs, died at the sibling search
PP_DEV = 2105832026566725634    # a Picking Plan confirm on dev
# confirms whose GD lines also carry another Picking's records (split picks, the 10-09 duplicate split)
SIBLING_RUNS = [2108395734540881922, 2108395647752343553, 2108395609017946114, 2108395183723909122,
                2108394907948421122, 2107768919564619778, 2107734225896738818]
EPS = 1e-6


def nodes_of(wf):
    out = {}

    def walk(lst):
        for n in lst:
            if isinstance(n, dict) and "type" in n and "data" in n:
                out[n["id"]] = n
                walk(n.get("blocks") or [])

    walk(wf["nodes"])
    return out


def enabled(env):
    out = subprocess.run([os.path.join(REPO, ".dbtools", "db"), env, "--json",
                          "SELECT script_json FROM su_code_workflow_history WHERE data_id=2020683258347081730 "
                          "AND status='enabled' ORDER BY version_number DESC LIMIT 1"], capture_output=True, text=True)
    return json.loads(json.loads(out.stdout)[0]["script_json"])


def db(env, sql):
    out = subprocess.run([os.path.join(REPO, ".dbtools", "db"), env, "--json", sql], capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr.strip()[-600:])
    return json.loads(out.stdout)


def sql_text(node, outputs):
    """The sql-node's statement as the platform substitutes it (raw text)."""
    return re.sub(r"\{\{node:([A-Za-z0-9_]+)\.data\.([A-Za-z0-9_]+)\}\}",
                  lambda m: str(outputs[m.group(1)][m.group(2)]), node["data"]["script"]["code"])


def recorded_dev(run):
    row = db("--dev", f"SELECT request_json_data, nodes_data FROM su_code_workflow_inst WHERE id={run}")[0]
    params = json.loads(row["request_json_data"]).get("request_json") or {}
    nodes = {n["node_id"]: json.loads(n["response_json_data"])
             for n in json.loads(row["nodes_data"] or "[]") if n.get("node_id") and n.get("response_json_data")}
    return params, nodes


def as_sql_rows(siblings, line_key, line_ids, own_id, skip_cancelled=False):
    """What the new sibling query returns, built from a recorded sibling search-node."""
    rows = []
    for sib in siblings:
        if str(sib["id"]) == str(own_id):
            continue
        if skip_cancelled and (sib.get("to_status") == "Cancelled" or int(sib.get("is_deleted") or 0) == 1):
            continue
        for r in sib.get("table_picking_records") or []:
            if str(r.get(line_key)) not in line_ids or int(r.get("is_deleted") or 0) == 1:
                continue
            row = {"sibling_id": str(sib["id"]), line_key: str(r[line_key]),
                   "store_out_qty": f"{float(r.get('store_out_qty') or 0):.8f}"}
            for k in ("source_bin", "target_location", "batch_no", "target_batch", "handling_unit_id"):
                row[k] = None if r.get(k) in (None, "") else str(r[k])
            rows.append(row)
    return rows


def qty_by_key(entries, qty_field):
    out = {}
    for e in entries or []:
        q = round((float(e.get(qty_field) or 0)) * 1000)
        if q <= 0:
            continue
        b = e.get("batch_id")
        b = "none" if b in (None, "undefined") else b
        k = f"{e.get('location_id') or 'no-location'}_{b}_{e.get('handling_unit_id') or 'no_hu'}"
        out[k] = out.get(k, 0) + q
    return out


def check_mn(label, base, new, params, nodes, sib_rows, now):
    old_out = rt.run(base["code_node_MNRecompute"]["data"]["script"]["code"], params, nodes, now)
    nodes = dict(nodes, sql_node_SibRecs={"data": sib_rows})
    new_out = rt.run(new["code_node_MNRecompute"]["data"]["script"]["code"], params, nodes, now)
    written = {str(w["id"]): w for w in nodes["code_node_iES7iMKA"]["data"]["updatedGdLines"]}
    new_by = {str(l["id"]): l for l in new_out["updatedLines"]}
    skipped = 0
    for l in old_out["updatedLines"]:
        nl = new_by.pop(str(l["id"]), None)
        if nl is not None:
            assert rt.same(nl, l), (label, "a written line differs from BASE", l["id"])
            continue
        w = written[str(l["id"])]
        assert w["picking_status"] == l["picking_status"], (label, l["id"])
        assert abs(float(w["picked_qty"]) - float(l["picked_qty"])) < EPS, (label, l["id"])
        assert qty_by_key(json.loads(w["picked_temp_qty_data"]), "gd_quantity") == \
            qty_by_key(json.loads(l["picked_temp_qty_data"]), "gd_quantity"), (label, l["id"])
        skipped += 1
    assert not new_by, (label, "NEW writes a line BASE does not", list(new_by)[:3])
    assert new_out["hasUpdates"] == (1 if new_out["updatedLines"] else 0)
    print(f"  {label}: BASE writes {len(old_out['updatedLines'])} lines, NEW {len(new_out['updatedLines'])}; "
          f"the {skipped} skipped equal what iES7iMKA already wrote; the rest identical to BASE")
    return old_out, new_out


def test_mn_healthy(base, new):
    params, nodes = brs.recorded(HEALTHY)
    line_ids = {str(l["id"]) for l in nodes["search_node_krPmTbfL"]["data"]["data"]}
    sibs = nodes["search_node_SiblingPickings"]["data"]["data"]
    rows = as_sql_rows(sibs, "gd_line_id", line_ids, params["allData"]["id"])
    old_out, _ = check_mn("MNRecompute, healthy run", base, new, params, nodes, rows, rt.run_time_ms(HEALTHY))
    assert rt.same_as_recorded(old_out, nodes["code_node_MNRecompute"]["data"]), "BASE replay != recorded"
    return params, nodes, rows


def test_mn_failed(base, new):
    params, nodes = brs.recorded(FAILED)
    line_ids = nodes["code_node_oHIIKfiw"]["data"]["gdLineIds"]
    # the trace keeps no rows for this search-node (2,096 lines, written to a file): rebuilt from the database
    lines = [brs.as_fetched(r, "goods_delivery_fwii8mvb_sub") for r in rt.db(
        f"SELECT * FROM goods_delivery_fwii8mvb_sub WHERE id IN ({','.join(str(x) for x in line_ids)}) AND is_deleted = 0")]
    nodes["search_node_krPmTbfL"] = rt.wrap({"total": len(lines), "count": len(lines), "data": lines})
    prep = rt.run(new["code_node_SibPrep"]["data"]["script"]["code"], params, nodes)
    sql = sql_text(new["sql_node_SibRecs"], {"code_node_SibPrep": prep})
    t = time.time()
    rows = rt.db(sql)
    took = time.time() - t
    print(f"  sql_node_SibRecs on prod for PI-20261013-1502 (300 GDs, {len(line_ids)} lines): "
          f"{len(rows)} rows in {took:.2f}s (incl. connection)")
    check_mn("MNRecompute, the 300-GD run", base, new, params, nodes, rows, rt.run_time_ms(FAILED))


def test_sibling_runs(base, new):
    for run in SIBLING_RUNS:
        params, nodes = brs.recorded(run)
        line_ids = {str(l["id"]) for l in nodes["search_node_krPmTbfL"]["data"]["data"]}
        sibs = nodes["search_node_SiblingPickings"]["data"]["data"]
        rows = as_sql_rows(sibs, "gd_line_id", line_ids, params["allData"]["id"])
        old_out, _ = check_mn(f"MNRecompute, {params['allData'].get('to_id')} ({len(rows)} sibling records)",
                              base, new, params, nodes, rows, rt.run_time_ms(run))
        assert rt.same_as_recorded(old_out, nodes["code_node_MNRecompute"]["data"]), "BASE replay != recorded"
        test_sib_sql_healthy(new, params, nodes, rows)


def test_sib_sql_healthy(new, params, nodes, expected):
    prep = rt.run(new["code_node_SibPrep"]["data"]["script"]["code"], params, nodes)
    sql = sql_text(new["sql_node_SibRecs"], {"code_node_SibPrep": prep})
    t = time.time()
    rows = rt.db(sql)
    took = time.time() - t
    key = lambda r: (r["sibling_id"], r["gd_line_id"], f"{float(r['store_out_qty']):.3f}", r["source_bin"],
                     r["target_location"], r["batch_no"], r["target_batch"], r["handling_unit_id"])
    got = sorted(map(key, ({k: (None if v in (None, "") else str(v)) if k != "store_out_qty" else v
                            for k, v in r.items()} for r in rows)))
    want = sorted(map(key, expected))
    extra = [r for r in got if r not in want]
    missing = [r for r in want if r not in got]
    print(f"  sql_node_SibRecs on prod: {len(rows)} rows in {took:.2f}s; vs the recorded "
          f"search-node: {len(want)} records, {len(missing)} missing, {len(extra)} new since")
    for r in missing[:5]:
        print("     missing:", r)
    for r in extra[:5]:
        print("     new:    ", r)
    assert not missing


def test_pp(base, new):
    params, nodes = recorded_dev(PP_DEV)
    sibs = nodes["search_node_PpSiblings"]["data"]["data"]
    line_ids = {str(x) for x in nodes["code_node_Q3hWck9R"]["data"]["toLineIds"]}
    prep = rt.run(new["code_node_PpSibPrep"]["data"]["script"]["code"], params, nodes)
    rows = db("--dev", sql_text(new["sql_node_PpSibRecs"], {"code_node_PpSibPrep": prep}))
    # The run's own Picking holds numeric to_no; let it in to show the string ids still match it (it has the
    # records this very run wrote, which the search-node, read before the write, could not show).
    own_id = str(params["allData"]["id"])
    own = db("--dev", sql_text(new["sql_node_PpSibRecs"], {"code_node_PpSibPrep": dict(prep, ownId="0")}))
    print(f"  sql_node_PpSibRecs on dev: {len(rows)} sibling rows; with the own Picking let in: {len(own)} "
          f"rows, all of it, for this run's lines")
    assert not rows and own and all(r["sibling_id"] == own_id and r["to_line_id"] in line_ids for r in own)
    expected = as_sql_rows(sibs, "to_line_id", line_ids, params["allData"]["id"], skip_cancelled=True)
    now = rt.run_time_ms(PP_DEV)
    old_out = rt.run(base["code_node_AGoxWP7x"]["data"]["script"]["code"], params, nodes, now)
    new_out = rt.run(new["code_node_AGoxWP7x"]["data"]["script"]["code"], params,
                     dict(nodes, sql_node_PpSibRecs={"data": expected}), now)
    assert rt.same(old_out, new_out), "AGoxWP7x differs"
    assert rt.same_as_recorded(old_out, nodes["code_node_AGoxWP7x"]["data"]), "BASE replay != recorded"
    print(f"  AGoxWP7x on dev run {PP_DEV}: NEW output identical to BASE ({len(new_out['updatedToLines'])} lines)")


def route_old(base, gd, setup, size_guard):
    nodes = {"code_node_9rK80jNQ": rt.wrap({"gdData": gd, "pickingStatus": gd.get("picking_status")}),
             "get_node_Uj1uV9PU": setup, "code_node_SizeGuard": rt.wrap(size_guard)}
    return rt.run(base["code_node_GdRoute"]["data"]["script"]["code"], {}, nodes)


def test_gd_plan(base, new, params, nodes):
    gds = nodes["code_node_B3E0xodz"]["data"]["updatedGdDatas"]
    setup = nodes["get_node_Uj1uV9PU"]
    counts = {str(r["gd_id"]): r["n"] for r in rt.db(
        "SELECT CAST(goods_delivery_id AS CHAR) gd_id, COUNT(*) n FROM goods_delivery_fwii8mvb_sub WHERE "
        f"goods_delivery_id IN ({','.join(str(g['id']) for g in gds)}) AND is_deleted = 0 GROUP BY goods_delivery_id")}

    def variant(label, gds, setup, size_guard):
        plan = rt.run(new["code_node_GdPlan"]["data"]["script"]["code"], {},
                      {"code_node_B3E0xodz": rt.wrap({"updatedGdDatas": gds}), "get_node_Uj1uV9PU": setup,
                       "code_node_SizeGuard": rt.wrap(size_guard)})
        want_status, want_loop = [], []
        for gd in gds:
            o = route_old(base, gd, setup, size_guard)
            if o["route"] == "STATUS":
                want_status.append({"id": o["gdId"], "picking_status": o["headerStatus"]})
            else:
                want_loop.append((o["route"], o["failCode"], o["failMessage"], str(gd["id"])))
        got_loop = [(i["route"], i.get("failCode", ""), i.get("failMessage", ""), str(i["gd"]["id"]))
                    for i in plan["loopItems"]]
        assert rt.same(plan["statusRows"], want_status), (label, plan["statusRows"][:2], want_status[:2])
        assert got_loop == want_loop, (label, got_loop, want_loop)
        assert plan["hasStatusRows"] == (1 if want_status else 0) and plan["hasLoopItems"] == (1 if want_loop else 0)
        for i in plan["loopItems"]:  # the loop item hands the same GD to the sub-workflow as before
            out = rt.run(new["code_node_9rK80jNQ"]["data"]["script"]["code"], {}, {"loop_zRdd7yAf": i})
            assert rt.same(out["gdData"], i["gd"]) and out["route"] == i["route"]
            assert out["docNo"] == (i["gd"].get("delivery_no") or i["gd"].get("id"))
        print(f"  GdPlan = per-GD GdRoute ({label}): {len(want_status)} header-only, "
              f"{[r for r, *_ in want_loop]} through the loop")

    variant("the healthy run", gds, setup, {"lineCounts": counts, "needFullSave": 0})
    variant("a bin move: full re-save", gds, setup, {"lineCounts": counts, "needFullSave": 1})
    auto = json.loads(json.dumps(setup))
    auto["data"]["data"]["auto_completed_gd"] = 1
    mixed = json.loads(json.dumps(gds))
    for g in mixed[:3]:
        g["picking_status"] = "Completed"
    mixed[1]["gd_status"] = "Cancelled"
    big = dict(counts, **{str(mixed[2]["id"]): 600})
    variant("auto-complete, a cancelled GD, a 600-line GD", mixed, auto, {"lineCounts": big, "needFullSave": 0})


def test_slices(new):
    pk = [{"gd_id": str(i), "gd_no": f"GD-{i}"} for i in range(300)]
    out = rt.run(new["code_node_PkSlices"]["data"]["script"]["code"], {},
                 {"code_node_gudzrvMQ": rt.wrap({"packingDataList": pk})})
    assert [len(s["rows"]) for s in out["slices"]] == [25] * 12
    rows = []
    for s in out["slices"]:
        rows += rt.run(new["code_node_PkSlice"]["data"]["script"]["code"], {}, {"loop_PkCreates": s})["rows"]
    assert rows == pk
    empty = rt.run(new["code_node_PkSlices"]["data"]["script"]["code"], {},
                   {"code_node_gudzrvMQ": rt.wrap({"packingDataList": [{"gd_id": "1"}]})})
    assert [len(s["rows"]) for s in empty["slices"]] == [1]
    print("  Packing slices: 300 -> 12 x 25, in order; 1 -> 1 x 1")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "Picking", "PickingProcessWorkflow.json")
    base = nodes_of(enabled("--dev"))
    new = nodes_of(json.load(open(path, encoding="utf-8")))
    print("BASE = dev's enabled PICKING; NEW =", os.path.relpath(path, REPO) if path.startswith(REPO) else path)
    params, nodes, rows = test_mn_healthy(base, new)
    test_sib_sql_healthy(new, params, nodes, rows)
    test_gd_plan(base, new, params, nodes)
    test_sibling_runs(base, new)
    test_mn_failed(base, new)
    test_pp(base, new)
    test_slices(new)
    print("all passed")


if __name__ == "__main__":
    main()
