#!/usr/bin/env python3
"""Replay the patched code-nodes against REAL prod inputs (read-only).

Each test pulls a recorded prod run (su_code_workflow_inst), binds every {{node:...}} /
{{workflowparams:...}} placeholder the way the platform does (the recorded output of that node,
or null when it did not run), executes the BASE and the PROD version of the node under node.js,
and asserts the BASE reproduces the defect and the PROD version fixes it.

usage: python3 replay_tests.py [test-name ...]
"""
import copy, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DB = os.path.join(REPO, ".dbtools", "db")
PLACEHOLDER = re.compile(r"\{\{(node|workflowparams|global):([^}]*)\}\}")
_cache = {}


# ---------------------------------------------------------------- data access (read-only)

def db(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr.strip()[-400:])
    return json.loads(out.stdout)


def trace(instance_id):
    """-> (workflow params, {node_id: recorded response}) of one prod run."""
    if instance_id not in _cache:
        row = db(f"SELECT request_json_data, nodes_data FROM su_code_workflow_inst WHERE id={instance_id}")[0]
        params = json.loads(row["request_json_data"]).get("request_json") or {}
        nodes = {}
        for n in json.loads(row["nodes_data"] or "[]"):
            try:
                nodes[n["node_id"]] = json.loads(n.get("response_json_data") or "null")
            except ValueError:
                nodes[n["node_id"]] = None
        _cache[instance_id] = (params, nodes)
    params, nodes = _cache[instance_id]
    return copy.deepcopy(params), copy.deepcopy(nodes)


def script(wf, which, node_id):
    d = json.load(open(os.path.join(HERE, f"{wf}.{which}.json"), encoding="utf-8"))
    hit = []

    def walk(lst):
        for n in lst:
            if isinstance(n, dict) and "type" in n and "data" in n:
                if n["id"] == node_id:
                    hit.append(n)
                walk(n.get("blocks") or [])

    walk(d["nodes"])
    return hit[0]["data"]["script"]["code"]


# ---------------------------------------------------------------- execution

def as_platform(v):
    """Code-node JS receives snowflake ids as strings (a double would round them)."""
    if isinstance(v, dict):
        return {k: as_platform(x) for k, x in v.items()}
    if isinstance(v, list):
        return [as_platform(x) for x in v]
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) > 2**53:
        return str(v)
    return v


def same(a, b):
    """Equal as the platform would write them: 2 == 2.0, '123' == 123 for ids."""
    def norm(v):
        if isinstance(v, dict):
            return {k: norm(x) for k, x in v.items()}
        if isinstance(v, list):
            return [norm(x) for x in v]
        if v is None:
            return v
        if isinstance(v, bool):  # a JS true is recorded as 1
            return float(v)
        if isinstance(v, (int, float)):
            return str(v) if abs(v) > 2**53 else float(v)
        return v
    return json.dumps(norm(a), sort_keys=True) == json.dumps(norm(b), sort_keys=True)


def same_as_recorded(out, recorded):
    """The trace drops null values and undeclared keys; compare on what it kept."""
    def strip(v):
        if isinstance(v, dict):
            return {k: strip(x) for k, x in v.items() if x is not None}
        if isinstance(v, list):
            return [strip(x) for x in v]
        return v
    return same({k: v for k, v in strip(out).items() if k in recorded}, strip(recorded))


def run(code, params, nodes, now_ms=None):
    """Execute a code-node body; placeholders resolve to the fixture value or null.
    now_ms freezes `new Date()` at the recorded run's time so date stamps replay exactly."""
    def bind(m):
        root = {"node": "F.node", "workflowparams": "F.wp", "global": "F.g"}[m.group(1)]
        return f"__get({root}, {json.dumps(m.group(2))})"

    js = (
        "" + ("" if now_ms is None else
           f"const __D = Date; Date = class extends __D {{ constructor(...a) {{ if (a.length) super(...a); "
           f"else super({now_ms}); }} static now() {{ return {now_ms}; }} }};\n")
        + "const F = " + json.dumps(as_platform({"node": nodes, "wp": params, "g": {}})) + ";\n"
        "const __get = (root, path) => {\n"
        "  let v = root;\n"
        "  for (const k of path.split('.')) { if (v === null || v === undefined) return null; v = v[k]; }\n"
        "  return v === undefined ? null : JSON.parse(JSON.stringify(v));\n"
        "};\n"
        "const out = (function(){\n" + PLACEHOLDER.sub(bind, code) + "\n})();\n"
        "console.log(JSON.stringify(out));\n")
    fd, path = tempfile.mkstemp(suffix=".js")
    os.write(fd, js.encode())
    os.close(fd)
    r = subprocess.run(["node", path], capture_output=True, text=True)
    os.unlink(path)
    if r.returncode:
        raise RuntimeError(r.stderr[:1200])
    return json.loads(r.stdout.strip().splitlines()[-1])


def both(wf, node_id, params, nodes, now_ms=None):
    return (run(script(wf, "BASE", node_id), params, nodes, now_ms),
            run(script(wf, "PROD", node_id), params, nodes, now_ms))


def run_time_ms(instance_id):
    """Snowflake id -> epoch ms of the run."""
    return (int(instance_id) >> 22) + 1288834974657


def wrap(data):
    """A node output as the platform records it."""
    return {"code": 200, "data": data}


# ---------------------------------------------------------------- tests

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


@test
def bug002_convert_override_becomes_draft():
    """SI/20261001/0037: CL Override on a Convert -> Draft SI, draft number."""
    params, nodes = trace(2105537077910310913)
    nodes["code_node_Z0Tcxb1v"] = wrap(run(script("SI_SAVE", "PROD", "code_node_Z0Tcxb1v"), params, nodes))
    old, new = both("SI_SAVE", "code_node_JoF0YVzG", params, nodes)
    check(old["entry"]["si_status"] == "Completed", f"BASE should reproduce Completed, got {old['entry']['si_status']}")
    check(new["entry"]["si_status"] == "Draft", f"PROD si_status {new['entry']['si_status']}")
    check(new["entry"]["sales_invoice_no"] == "draft", f"PROD number {new['entry']['sales_invoice_no']}")
    check(new["entry"]["payment_status"] == "", "Draft SI must not be Unpaid")
    return f"BASE {old['entry']['si_status']}/{old['entry']['sales_invoice_no']} -> PROD Draft/draft"


@test
def bug002_passing_cl_unchanged():
    """SI/20261001/0042: CL passed -> identical output."""
    params, nodes = trace(2105540245209616386)
    old, new = both("SI_SAVE", "code_node_JoF0YVzG", params, nodes)
    check(same(old, new), "a run whose CL passed must be unchanged")
    check(new["entry"]["si_status"] == "Completed", "still Completed")
    return "identical, Completed"


@test
def bug009_missing_source_is_not_auto():
    out_none = run(script("GD_Convert_SI", "PROD", "code_node_6JxbETDC"), {}, {})
    out_auto = run(script("GD_Convert_SI", "PROD", "code_node_6JxbETDC"), {"source": "auto"}, {})
    check(out_none["isAuto"] == "0" and out_auto["isAuto"] == "1", f"{out_none} / {out_auto}")
    check(out_none["message"].startswith("Selected Goods Delivery"), "message kept")
    return "source missing -> '0', 'auto' -> '1'"


@test
def bug015_draft_edit_does_not_reconcile():
    """Ascent LOT-09/2026-441 and PTS LOT/2610/036: edited Draft saved as Completed."""
    res = []
    for run_id in (2104456249562238978, 2107744220113670146):
        params, nodes = trace(run_id)
        old, new = both("SM_LOCATION_TRANSFER", "code_node_uht83Wzh", params, nodes)
        check(old["isDifferent"] == 1 and old["movementsLength"] > 0, f"{run_id}: BASE should reproduce the reconcile")
        check(new["isDifferent"] == 0 and new["movementsLength"] == 0, f"{run_id}: PROD still reconciles")
        res.append(f"{run_id}: BASE {old['movementsLength']} movements -> PROD 0")
    return "; ".join(res)


@test
def bug015_other_edits_unchanged():
    """Every other prod run since v65 that reached Reconcile: In Progress edits are identical."""
    res = []
    for run_id in (2105192695164178433, 2105515432139165698, 2107375533737250817,
                   2107699420316438530, 2107738174297083905, 2107782527291887617):
        params, nodes = trace(run_id)
        stored = (nodes.get("get_node_Ij7YbXCA") or {}).get("data", {}).get("data") or {}
        status = stored.get("stock_movement_status") if isinstance(stored, dict) else None
        old, new = both("SM_LOCATION_TRANSFER", "code_node_uht83Wzh", params, nodes)
        if status == "In Progress":
            check(same(old, new), f"{run_id}: In Progress edit changed")
        else:
            check(old["movementsLength"] == 0, f"{run_id}: stored {status} but BASE posted movements")
        res.append(f"{status}:{'same' if same(old, new) else 'skipped(no movements)'}")
    return ", ".join(res)


def gd_line(table_gd, line_id):
    for row in table_gd or []:
        for x in [row] + list(row.get("children") or []):
            if str(x.get("id")) == str(line_id):
                return x
    return None


def stored_gd(nodes):
    raw = nodes["get_node_xTRvHWB8"]["data"]["data"]
    return copy.deepcopy(raw[0] if isinstance(raw, list) else raw)


def merge(run_id, fresh_gd):
    """Run PROD 8pN1MyXz then PROD PkMerge for a recorded GOODS_DELIVERY run."""
    params, nodes = trace(run_id)
    nodes["code_node_8pN1MyXz"] = wrap(run(script("GOODS_DELIVERY", "PROD", "code_node_8pN1MyXz"), params, nodes))
    nodes["get_node_PkMergeGd"] = wrap({"count": 1, "data": fresh_gd})
    out = run(script("GOODS_DELIVERY", "PROD", "code_node_PkMerge"), params, nodes)
    payload = nodes["code_node_GKc0ALEe"]["data"]["allData"]["table_gd"]
    return out, payload, nodes


@test
def bug001_stale_payload_keeps_sibling_pick():
    """The clobbering runs: payload Created/0, the GD already held the sibling's pick."""
    res = []
    cases = [
        (2105479530696282114, "2105475451119079426", None),          # GD-20261001-294, 2nd clobber
        (2105186694377639938, "2105181959943753729", None),          # GD-20260930-280
        # GD-294's 1st clobber: by its write PI-0533 had committed 5/Completed (run ...503777239041).
        (2105479471753728002, "2105475451119079426", 2105479503777239041),
    ]
    for run_id, line_id, committed_by in cases:
        params, nodes = trace(run_id)
        fresh = stored_gd(nodes)
        if committed_by:
            _, sib = trace(committed_by)
            sib_line = gd_line(sib["code_node_GKc0ALEe"]["data"]["allData"]["table_gd"], line_id)
            for row in fresh["table_gd"]:
                if str(row["id"]) == line_id:
                    row.update({k: sib_line.get(k) for k in ("picking_status", "picked_qty",
                               "picked_temp_qty_data", "picked_view_stock")})
        out, payload, _ = merge(run_id, fresh)
        before, after = gd_line(payload, line_id), gd_line(out["table_gd"], line_id)
        check(before["picking_status"] != "Completed", f"{run_id}: payload should be the stale one")
        check(after["picking_status"] == "Completed" and float(after["picked_qty"]) > 0,
              f"{run_id}: merged line {after['picking_status']}/{after['picked_qty']}")
        others_same = all(same(a, b) for a, b in zip(payload, out["table_gd"]) if str(a["id"]) != line_id)
        check(others_same and len(payload) == len(out["table_gd"]), f"{run_id}: other lines changed")
        res.append(f"{run_id}: {before['picking_status']}/{before['picked_qty']} -> "
                   f"{after['picking_status']}/{after['picked_qty']}")
    return "; ".join(res)


@test
def bug001_fresh_payload_survives_clobbered_db():
    """PI-0533's own save read the clobbered 0/Created; its 5/Completed payload must win."""
    run_id, line_id = 2105479503777239041, "2105475451119079426"
    _, nodes = trace(run_id)
    out, payload, _ = merge(run_id, stored_gd(nodes))
    after = gd_line(out["table_gd"], line_id)
    check(after["picking_status"] == "Completed" and float(after["picked_qty"]) == 5.0, f"{after}")
    check(same(payload, out["table_gd"]), "payload already ahead -> written unchanged")
    return "payload 5/Completed kept, table_gd identical to today's write"


@test
def bug001_non_picking_save_untouched():
    """needMerge is off for a user save: table_gd is exactly what is written today."""
    run_id = 2105479503777239041
    params, nodes = trace(run_id)
    params["isPicking"] = None
    nodes["code_node_8pN1MyXz"] = wrap(run(script("GOODS_DELIVERY", "PROD", "code_node_8pN1MyXz"), params, nodes))
    check(nodes["code_node_8pN1MyXz"]["data"]["needMerge"] == "0", "needMerge should be off")
    nodes["get_node_PkMergeGd"] = None
    out = run(script("GOODS_DELIVERY", "PROD", "code_node_PkMerge"), params, nodes)
    payload = nodes["code_node_GKc0ALEe"]["data"]["allData"]["table_gd"]
    check(same(payload, out["table_gd"]), "changed")
    return "identical"


@test
def bug005_stale_header_rolls_up():
    """LSH GD-20261002-340: Packing's save carried a stale header over all-Completed lines."""
    params, nodes = trace(2105858521001234434)
    old, new = both("GOODS_DELIVERY", "code_node_8pN1MyXz", params, nodes)
    check(same_as_recorded(old, nodes["code_node_8pN1MyXz"]["data"]), "BASE replay != recorded")
    check(old["picking_status"] != "Completed", f"BASE should be stale, got {old['picking_status']}")
    check(new["picking_status"] == "Completed", f"PROD {new['picking_status']}")
    return f"header {old['picking_status']} -> Completed"


@test
def bug005_partial_and_fresh_gds_unchanged():
    """A GD with unpicked lines keeps its header (sampled from the BUG-001 runs)."""
    res = []
    for run_id in (2105479471753728002, 2105186694377639938):
        params, nodes = trace(run_id)
        old, new = both("GOODS_DELIVERY", "code_node_8pN1MyXz", params, nodes)
        check(old["picking_status"] == new["picking_status"], f"{run_id}: header changed")
        res.append(new["picking_status"])
    return "headers kept: " + ", ".join(res)


@test
def bug004_cancelled_gd_not_revived_by_packing():
    """GD-20260930-287: PACKING_SAVE's GD call (saveAs Created) on the cancelled GD."""
    params, nodes = trace(2105473604685795330)
    old, new = both("GOODS_DELIVERY", "code_node_IyJHrBst", params, nodes)
    check(old["invalidData"] == 0, "BASE should let it through")
    check(new["invalidData"] == 1 and "Cancelled" in new["invalidDataMessage"], f"{new.get('invalidDataMessage')}")
    p2, n2 = trace(2105473597786165249)
    o2, n2_ = both("PACKING_SAVE", "code_node_PkPickChk", p2, n2)
    check(o2["notPicked"] == 0 and n2_["notPicked"] == 1, f"PkPickChk {o2} / {n2_}")
    n2["get_node_nqe6SJFz"] = n2.get("get_node_nqe6SJFz") or n2["get_node_PkPickGd"]
    o3, n3 = both("PACKING_SAVE", "code_node_GKPcKOcF", p2, n2)
    check(o3["shouldCallGdWorkflow"] == 1 and n3["shouldCallGdWorkflow"] == 0, f"GKPcKOcF {o3} / {n3}")
    return "GD save 400s; Packing completion blocked; no GD re-save"


@test
def bug004_normal_picking_save_unchanged():
    params, nodes = trace(2105479503777239041)
    old, new = both("GOODS_DELIVERY", "code_node_IyJHrBst", params, nodes)
    check(same(old, new), "a live GD's fillback changed")
    return "identical"


@test
def bug004_cancelled_picking_refused():
    code = script("PICKING_LOOP", "PROD", "code_node_LockDecide")
    state = lambda row: run(code, {}, {"sql_node_LockGate": wrap([row])})["lockState"]
    got = (state({"id": "1", "to_status": "Cancelled", "is_processing": 0, "lock_age_sec": 5}),
           state({"id": "1", "to_status": "Completed", "is_processing": 0, "lock_age_sec": 5}),
           state({"id": "1", "to_status": "Created", "is_processing": 0, "lock_age_sec": 5}),
           state({"id": "1", "to_status": "Created", "is_processing": 1, "lock_age_sec": 5}))
    check(got == (3, 2, 0, 1), f"lockStates {got}")
    return "Cancelled 3, Completed 2, free 0, busy 1"


@test
def bug006_force_complete_skips_cancelled():
    """GD/20261008/1483: Force Complete flipped a line on PI-20261008-0200-Cancelled."""
    params, nodes = trace(2108064688226045954)
    old = run(script("GOODS_DELIVERY", "BASE", "code_node_UiubQSk5"), params, nodes)
    touched = [p["to_id"] for p in old["pickingData"] if p.get("to_status") == "Cancelled"]
    check(touched, "BASE run should have rewritten a Cancelled Picking")

    # The lookup is a get-node (it returned only that Cancelled Picking), so the fix is its filter.
    d = json.load(open(os.path.join(HERE, "GOODS_DELIVERY.PROD.json"), encoding="utf-8"))
    leaves = []

    def walk(lst):
        for n in lst:
            if isinstance(n, dict) and "type" in n and "data" in n:
                if n["id"] == "get_node_oU2TK3ms":
                    leaves.extend(n["data"]["table_id"]["rules"]["list"][0]["children"])
                walk(n.get("blocks") or [])
    walk(d["nodes"])
    check(any(l["prop"] == "to_status" and l["operator"] == "notEqual" and l["value"] == "Cancelled"
              for l in leaves), "PROD lookup lacks the Cancelled filter")

    # And a Cancelled line on a Picking it does receive is left alone.
    picking = {"id": "P1", "to_status": "In Progress", "table_picking_items": [
        {"gd_id": "G1", "line_status": "Cancelled"}, {"gd_id": "G1", "line_status": "Open"}]}
    fx = {"get_node_oU2TK3ms": wrap({"count": 1, "data": picking}),
          "code_node_IyJHrBst": wrap({"allData": {"id": "G1", "delivery_no": "GD-T"}})}
    new = run(script("GOODS_DELIVERY", "PROD", "code_node_UiubQSk5"), {}, fx)
    statuses = [l["line_status"] for l in new["pickingData"][0]["table_picking_items"]]
    check(statuses == ["Cancelled", "Completed"], f"{statuses}")
    return f"BASE rewrote {touched}; PROD lookup filters Cancelled; Cancelled lines kept"


@test
def bug011_second_completed_save_keeps_first_hus():
    """PACK-20261002-0228: two devices completed their own HUs 26 s apart."""
    p1, _ = trace(2105921110972436482)
    params, nodes = trace(2105921218866712578)
    stored = dict(p1["entry"], packing_status="Completed",
                  table_hu=[dict(r, id=f"row{i}") for i, r in enumerate(p1["entry"]["table_hu"])])
    nodes["get_node_PkStored"] = wrap({"count": 1, "data": stored})
    old, new = both("PACKING_SAVE", "code_node_7u6VSG8X", params, nodes)
    names = sorted(r["handling_no"] for r in new["table_hu"])
    check(len(old["table_hu"]) == 2, "BASE writes only the second device's 2 HUs")
    check(len(new["table_hu"]) == 7 and names[0] == "HU/0450" and names[-1] == "HU/0456", f"{names}")
    nodes["get_node_PkStored"] = wrap({"count": 1, "data": dict(stored, packing_status="Created")})
    still = run(script("PACKING_SAVE", "PROD", "code_node_7u6VSG8X"), params, nodes)
    check(len(still["table_hu"]) == 2, "a not-yet-completed Packing must keep today's replace")
    return "2 -> 7 HUs (HU/0450..HU/0456); replace kept when stored is not Completed"


@test
def bug014_partial_pick_migrates_reservation():
    """DO-FG2610-012 run 1: 1019 of 1019.33 picked to the loading bay."""
    params, nodes = trace(2106280164823535617)
    old, new = both("GD_UNUSED_FN_NEW", "code_node_b71wypDJ", params, nodes)
    check(same_as_recorded(old, nodes["code_node_b71wypDJ"]["data"]), "BASE replay != recorded")
    kinds = lambda o: sorted(m["movement_type"] for m in o["inventoryMovements"])
    check("RESERVED_TO_UNRESTRICTED" in kinds(old), f"BASE {kinds(old)}")
    check(kinds(new) == ["RESERVED_ADD_CROSS_BIN", "RESERVED_SUBTRACT_CROSS_BIN"], f"PROD {kinds(new)}")
    check(all(m["quantity"] == 1019 for m in new["inventoryMovements"]), "moves the picked 1019")
    return f"BASE {kinds(old)} -> PROD cross-bin 1019"


@test
def bug014_ghost_residual_migrates_reservation():
    """DO-FG2610-012 run 2: 4.09e-14 left at the source bin."""
    params, nodes = trace(2106280195945271298)
    old, new = both("GD_UNUSED_FN_NEW", "code_node_b71wypDJ", params, nodes)
    check(same_as_recorded(old, nodes["code_node_b71wypDJ"]["data"]), "BASE replay != recorded")
    kinds = lambda o: sorted(m["movement_type"] for m in o["inventoryMovements"])
    check(kinds(new) == ["RESERVED_ADD_CROSS_BIN", "RESERVED_SUBTRACT_CROSS_BIN"], f"PROD {kinds(new)}")
    check(new["recordsToUpdate"][0]["status"] == "Cancelled", "old reservation fully migrated")
    return f"BASE {kinds(old)} -> PROD cross-bin 1019.33"


@test
def bug014_picking_leaves_no_ghost():
    """PICKING run 2: the source entry must not survive as 4.09e-14."""
    params, nodes = trace(2106280182749990913)
    old, new = both("PICKING", "code_node_iES7iMKA", params, nodes)

    def tiny(o):
        out = []
        for line in o["updatedGdLines"]:
            for e in json.loads(line.get("temp_qty_data") or "[]"):
                if 0 < float(e.get("gd_quantity") or 0) < 1e-6:
                    out.append(e["gd_quantity"])
        return out
    check(tiny(old), "BASE should reproduce the ghost entry")
    check(not tiny(new), f"PROD ghost {tiny(new)}")
    return f"BASE ghost {tiny(old)} -> PROD none"


@test
def bug016_force_complete_blocked_while_picking_open():
    """CA-3759 force-completed while PK-03780 was open (PICKING_PLAN run by NORA)."""
    params, nodes = trace(2105856994664648706)
    old, new = both("PICKING_PLAN", "code_node_pp_gate", params, nodes)
    check(old["blockEdit"] == 0, "BASE let it through")
    check(new["blockEdit"] == 1 and "PK-03780" in new["blockMessage"], f"{new}")
    return new["blockMessage"]


@test
def bug016_picking_does_not_reopen_completed_plan():
    """PK-03780 completion re-saved the Completed CA-3759 as Created."""
    params, nodes = trace(2105858520145596418)
    old, new = both("PICKING", "code_node_Qxtc1i6K", params, nodes)
    o = [t.get("to_no") for t in old["updatedToDatas"]]
    n = [t.get("to_no") for t in new["updatedToDatas"]]
    check("CA-3759" in o and "CA-3759" not in n, f"BASE {o} / PROD {n}")
    return f"BASE re-saves {o} -> PROD {n or 'none'}"


@test
def bug016_gd_from_released_plan_fails_at_creation():
    """TA188810 created as Created against CA-3759's released reservation."""
    params, nodes = trace(2105860343464071169)
    old, new = both("GOODS_DELIVERY", "code_node_QtyCheckBatch", params, nodes)
    check(old["validationMessage"] is None, f"BASE {old['validationMessage']}")
    check(new["validationMessage"] and "reserved" in new["validationMessage"], f"PROD {new['validationMessage']}")
    return new["validationMessage"]


@test
def bug010_unload_to_empty_frees_hu():
    params = {"process_type": "unload", "hu_status": "Packed",
              "table_hu_items": [{"material_id": "M1", "balance_id": "B1", "batch_id": "", "quantity": 5}]}
    nodes = {"get_node_qfiXFdKt": wrap({"data": {"id": "HU1", "handling_no": "HU/T", "hu_status": "Packed",
             "table_hu_items": [{"id": "L1", "material_id": "M1", "balance_id": "B1", "batch_id": "", "quantity": 5}]}})}
    code = script("HANDLING_UNIT", "PROD", "code_node_Li3O7y4d")
    base = script("HANDLING_UNIT", "BASE", "code_node_Li3O7y4d")
    # The node reads its HU from an earlier get-node; reuse whichever name it references.
    refs = set(m.group(2).split(".")[0] for m in PLACEHOLDER.finditer(code) if m.group(1) == "node")
    for r in refs:
        nodes.setdefault(r, nodes["get_node_qfiXFdKt"])
    old, new = run(base, params, nodes), run(code, params, nodes)
    check(old["hu_status"] == "Packed", f"BASE should keep Packed, got {old['hu_status']}")
    check(new["hu_status"] == "Created" and new["item_count"] == 0, f"PROD {new['hu_status']} / {new['item_count']}")
    params2 = dict(params, table_hu_items=[{"material_id": "M1", "balance_id": "B1", "batch_id": "", "quantity": 2}])
    partial = run(code, params2, nodes)
    check(partial["hu_status"] == "Packed", "a partial unload keeps the sent status")
    return "empty -> Created, partial -> Packed"


# ---------------------------------------------------------------- main

if __name__ == "__main__":
    wanted = set(sys.argv[1:])
    failed = 0
    for fn in TESTS:
        if wanted and fn.__name__ not in wanted:
            continue
        try:
            print(f"PASS {fn.__name__}: {fn()}")
        except Exception as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
    print(f"\n{len(TESTS) - failed if not wanted else '-'} passed, {failed} failed")
    sys.exit(1 if failed else 0)
