"""SA V2 cost-row race (CONTRACT §15) - the reconciler. Read-only: SELECTs through .dbtools/db only.

Per (material, plant[, batch]) it compares the COST-ROW delta of a race run with the MOVEMENT delta of the run's two
operations (inventory_movement rows whose operation_effect_key starts with SACRACE|<run>|):
  FIFO  sum of fifo_available_quantity (old layers + new ones) after - before   vs   IN - OUT base_qty;
        new layers vs IN movements (count, initial quantity); a fifo_sequence used twice that was not before
  WA    sum of wa_quantity after - before vs IN - OUT; sum of wa_quantity x wa_cost_price after - before vs
        IN - OUT total_price (a re-average lost leaves the quantity right only when both ops were ADDs of equal size)
  bins  (control, guarded by the engine's ITEM| / BATCH| locks) balance_quantity per item_balance / item_batch_balance
        row after - before vs that bin's IN - OUT
Verdicts: CONSISTENT | LOST UPDATE | DUPLICATE SEQUENCE | SHORTFALL (inconclusive: OUT beyond what the rows held) |
BALANCE MISMATCH (a lock failure - never expected). Exit 1 when any key is not CONSISTENT.

usage:
  python3 reconcile.py snapshot [--config C] --out FILE              the test materials' cost + balance rows at the plant
  python3 reconcile.py check --run R1-03 --before FILE [--after FILE] [--config C]
                                                                     verdict per key (after = a fresh snapshot by default)
  python3 reconcile.py timeline --run R0-07 [--fire FILE] [--config C]
                                                                     the two INVENTORY_BULK_APPLY runs' node times: did A
                                                                     land inside B's read -> write window?
  python3 reconcile.py classify FIXTURE.json                          offline: {before, after, movements, materials}
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.join(HERE, "..", "parity"))
EPOCH = 1288834974657
DIG = set("0123456789")
QTY = ("unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity")
FIFO, WA = "First In First Out", "Weighted Average"


def num(v):
    try:
        return float(v) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def bid(v):
    v = "" if v is None else str(v)
    return "" if v in ("", "0", "None") else v


# --------------------------------------------------------------------------------------------------- classification
def classify(before, after, movements, materials, qty_tol=1e-6, price_dp=4):
    """before / after: {fifo: [...], wa: [...], item_balance: [...], item_batch_balance: [...]} rows (ids as text);
    movements: inventory_movement rows of the run; materials: {material_id: costing method}. Returns [verdict dict]."""
    out = []
    mv_in, mv_out, mv_val, mv_n_in, mv_bin = {}, {}, {}, {}, {}

    def add(d, k, v):
        d[k] = d.get(k, 0.0) + v

    for m in movements:
        mat, plant, batch = str(m["item_id"]), str(m["plant_id"]), bid(m.get("batch_number_id"))
        q = num(m["base_qty"])
        k = (mat, plant, batch)
        sign = 1 if m["movement"] == "IN" else -1
        if sign > 0:
            add(mv_in, k, q)
            add(mv_n_in, k, 1)
        else:
            add(mv_out, k, q)
        add(mv_val, k, sign * num(m.get("total_price")))
        add(mv_bin, ("ib", mat, str(m["bin_location_id"]), plant), sign * q)
        if batch:
            add(mv_bin, ("bb", mat, str(m["bin_location_id"]), batch, plant), sign * q)

    keys = sorted({k for k in list(mv_in) + list(mv_out)})
    for k in keys:
        mat, plant, batch = k
        method = materials.get(mat, "")
        dmv = mv_in.get(k, 0.0) - mv_out.get(k, 0.0)
        v = {"key": "/".join(x or "-" for x in k), "material": mat, "plant": plant, "batch": batch or None, "method": method,
             "movement_delta": round(dmv, 8), "tags": [], "notes": []}
        if method == FIFO:
            sel = lambda rows: [r for r in rows if str(r["material_id"]) == mat and str(r["plant_id"]) == plant and bid(r.get("batch_id")) == batch]  # noqa: E731
            b, a = {str(r["id"]): r for r in sel(before["fifo"])}, {str(r["id"]): r for r in sel(after["fifo"])}
            d_rows = sum(num(r["fifo_available_quantity"]) for r in a.values()) - sum(num(r["fifo_available_quantity"]) for r in b.values())
            new = [a[i] for i in a if i not in b]
            v["rows_delta"] = round(d_rows, 8)
            v["new_layers"] = len(new)
            held = sum(num(r["fifo_available_quantity"]) for r in b.values()) + mv_in.get(k, 0.0)
            if mv_out.get(k, 0.0) > held + qty_tol:
                v["tags"].append("SHORTFALL")
                v["notes"].append(f"OUT {mv_out.get(k, 0.0):g} > available {held:g}: the engine consumes what exists (inconclusive)")
            elif abs(d_rows - dmv) > qty_tol * (1 + len(a)):
                v["tags"].append("LOST UPDATE")
                v["notes"].append(f"cost rows moved {d_rows:g}, movements {dmv:g}: {dmv - d_rows:g} lost")
            if len(new) != int(mv_n_in.get(k, 0)):
                v["tags"].append("LOST UPDATE" if len(new) < mv_n_in.get(k, 0) else "NEW LAYER MISMATCH")
                v["notes"].append(f"{len(new)} new layers for {int(mv_n_in.get(k, 0))} IN movements")
            elif abs(sum(num(r["fifo_initial_quantity"]) for r in new) - mv_in.get(k, 0.0)) > qty_tol * (1 + len(new)):
                v["tags"].append("NEW LAYER MISMATCH")
                v["notes"].append("new layers' initial quantity differs from the IN movements")
            seq_b, seq_a = {}, {}
            for r in b.values():
                seq_b[int(num(r["fifo_sequence"]))] = seq_b.get(int(num(r["fifo_sequence"])), 0) + 1
            for r in a.values():
                seq_a[int(num(r["fifo_sequence"]))] = seq_a.get(int(num(r["fifo_sequence"])), 0) + 1
            dup = sorted(s for s, n in seq_a.items() if n > 1 and n > seq_b.get(s, 0))
            if dup:
                v["tags"].append("DUPLICATE SEQUENCE")
                v["notes"].append("fifo_sequence used twice: " + ", ".join(f"{s} x{seq_a[s]}" for s in dup))
        elif method == WA:
            sel = lambda rows: [r for r in rows if str(r["material_id"]) == mat and str(r["plant_id"]) == plant and bid(r.get("batch_id")) == batch]  # noqa: E731
            b, a = sel(before["wa"]), sel(after["wa"])
            dq = sum(num(r["wa_quantity"]) for r in a) - sum(num(r["wa_quantity"]) for r in b)
            dv = sum(num(r["wa_quantity"]) * num(r["wa_cost_price"]) for r in a) - sum(num(r["wa_quantity"]) * num(r["wa_cost_price"]) for r in b)
            v["rows_delta"] = round(dq, 8)
            v["value_delta"] = round(dv, 6)
            v["movement_value_delta"] = round(mv_val.get(k, 0.0), 6)
            vtol = (sum(num(r["wa_quantity"]) for r in a) + mv_in.get(k, 0.0) + mv_out.get(k, 0.0)) * 10 ** -price_dp + 1e-6
            held = sum(num(r["wa_quantity"]) for r in b) + mv_in.get(k, 0.0)
            if mv_out.get(k, 0.0) > held + qty_tol:
                v["tags"].append("SHORTFALL")
                v["notes"].append(f"OUT {mv_out.get(k, 0.0):g} > WA quantity {held:g}: the engine clamps at 0 (inconclusive)")
            else:
                if abs(dq - dmv) > qty_tol * (1 + len(a)):
                    v["tags"].append("LOST UPDATE")
                    v["notes"].append(f"WA quantity moved {dq:g}, movements {dmv:g}: {dmv - dq:g} lost")
                if abs(dv - mv_val.get(k, 0.0)) > vtol:
                    if "LOST UPDATE" not in v["tags"]:
                        v["tags"].append("LOST UPDATE")
                    v["notes"].append(f"WA value moved {dv:.4f}, movements {mv_val.get(k, 0.0):.4f} (tolerance {vtol:.4f}): a re-average was overwritten")
        else:
            v["notes"].append("no cost row (" + (method or "unknown method") + "): bins only")
        v["tags"] = list(dict.fromkeys(v["tags"])) or ["CONSISTENT"]
        out.append(v)

    # control: every touched bin row moved exactly by its movements (the engine's ITEM| / BATCH| locks guard these)
    for kind, table in (("ib", "item_balance"), ("bb", "item_batch_balance")):
        def nk(r):
            return ("ib", str(r["material_id"]), str(r["location_id"]), str(r["plant_id"])) if kind == "ib" else \
                   ("bb", str(r["material_id"]), str(r["location_id"]), bid(r.get("batch_id")), str(r["plant_id"]))
        bsum, asum = {}, {}
        for r in before[table]:
            bsum[nk(r)] = bsum.get(nk(r), 0.0) + num(r["balance_quantity"])
        for r in after[table]:
            asum[nk(r)] = asum.get(nk(r), 0.0) + num(r["balance_quantity"])
        for k, dmv in sorted(((k, d) for k, d in mv_bin.items() if k[0] == kind)):
            d = asum.get(k, 0.0) - bsum.get(k, 0.0)
            ok = abs(d - dmv) <= qty_tol * 2
            out.append({"key": table + " " + "/".join(x or "-" for x in k[1:]), "material": k[1], "method": "bin", "movement_delta": round(dmv, 8),
                        "rows_delta": round(d, 8), "tags": ["CONSISTENT" if ok else "BALANCE MISMATCH"], "notes": [] if ok else [f"{table} moved {d:g}, movements {dmv:g}"]})
    return out


def overall(verdicts):
    bad = sorted({t for v in verdicts for t in v["tags"] if t != "CONSISTENT"})
    return "CONSISTENT" if not bad else " + ".join(bad)


def show(verdicts, head=""):
    if head:
        print(head)
    for v in verdicts:
        extra = ""
        if "value_delta" in v:
            extra = f"  value rows {v['value_delta']:.4f} / movements {v['movement_value_delta']:.4f}"
        if "new_layers" in v:
            extra += f"  new layers {v['new_layers']}"
        print(f"  {v['key']:70s} {v.get('method', ''):18s} rows {v.get('rows_delta', 0):>12g}  movements {v['movement_delta']:>12g}{extra}  -> {' + '.join(v['tags'])}")
        for n in v["notes"]:
            print("        " + n)
    print("VERDICT", overall(verdicts))


# --------------------------------------------------------------------------------------------------- read-only SQL
def load_config():
    path = sys.argv[sys.argv.index("--config") + 1] if "--config" in sys.argv else os.path.join(HERE, "config.json")
    if not os.path.exists(path):
        path = os.path.join(HERE, "config.example.json")
    with open(path) as fh:
        return json.load(fh)


def digits(v, what):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise SystemExit(f"{what} is not an id ({v!r})")
    return v


def materials_of(cfg):
    return {digits(m["id"], "materials." + k + ".id"): m["method"] for k, m in cfg["materials"].items() if not k.startswith("_") and m.get("id")}


def snapshot(cfg):
    from dbq import q
    t = digits(cfg["tenant_id"], "tenant_id")
    plant = digits(cfg["plant_id"], "plant_id")
    mats = ",".join(materials_of(cfg)) or "0"
    w = f"tenant_id='{t}' AND is_deleted=0 AND plant_id={plant} AND material_id IN ({mats})"
    snap = {"tenant": t, "plant": plant, "taken_at": q("--dev", "SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s.%f') t")[0]["t"]}
    snap["fifo"] = q("--dev", "SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(plant_id AS CHAR) plant_id, CAST(COALESCE(batch_id, 0) AS CHAR) batch_id, "
                              "fifo_sequence, CAST(fifo_cost_price AS CHAR) fifo_cost_price, CAST(fifo_initial_quantity AS CHAR) fifo_initial_quantity, "
                              f"CAST(fifo_available_quantity AS CHAR) fifo_available_quantity FROM fifo_costing_history WHERE {w} ORDER BY id")
    snap["wa"] = q("--dev", "SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(plant_id AS CHAR) plant_id, CAST(COALESCE(batch_id, 0) AS CHAR) batch_id, "
                            f"CAST(wa_quantity AS CHAR) wa_quantity, CAST(wa_cost_price AS CHAR) wa_cost_price, CAST(created_at AS CHAR) created_at FROM wa_costing_method WHERE {w} ORDER BY id")
    qty = ", ".join(f"CAST({c} AS CHAR) {c}" for c in QTY)
    snap["item_balance"] = q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(plant_id AS CHAR) plant_id, {qty} FROM item_balance WHERE {w} ORDER BY id")
    snap["item_batch_balance"] = q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(batch_id AS CHAR) batch_id, "
                                            f"CAST(plant_id AS CHAR) plant_id, {qty} FROM item_batch_balance WHERE {w} ORDER BY id")
    return snap


def run_rows(cfg, run):
    from dbq import q
    if not (len(run) <= 20 and all(c.isalnum() or c == "-" for c in run)):
        raise SystemExit("bad --run " + run)
    t = digits(cfg["tenant_id"], "tenant_id")
    mv = q("--dev", "SELECT operation_effect_key, movement, CAST(item_id AS CHAR) item_id, CAST(plant_id AS CHAR) plant_id, CAST(bin_location_id AS CHAR) bin_location_id, "
                    "CAST(batch_number_id AS CHAR) batch_number_id, CAST(base_qty AS CHAR) base_qty, CAST(unit_price AS CHAR) unit_price, CAST(total_price AS CHAR) total_price "
                    f"FROM inventory_movement WHERE tenant_id='{t}' AND is_deleted=0 AND operation_effect_key LIKE 'SACRACE|{run}|%' ORDER BY id")
    steps = q("--dev", f"SELECT job_id, step_name, step_status, error_message FROM gd_publish_step WHERE tenant_id='{t}' AND is_deleted=0 "
                       f"AND job_id IN ('SACRACE|{run}|A', 'SACRACE|{run}|B') AND step_name IN ('IBA|DONE', 'IBA|REVIEW') ORDER BY id")
    return mv, steps


TL_READ = ("sql_node_IBfifo", "sql_node_IBwa")
TL_BACK = ("sql_node_IBfifoB", "sql_node_IBwaB")


def timeline(cfg, run, fire, like=None):
    from dbq import q
    lo, hi = (digits(x, "idWindow") for x in fire["idWindow"])
    wf = digits(cfg["workflows"]["INVENTORY_BULK_APPLY"], "workflow id")
    like = like or f"SACRACE|{run}|"
    if not all(c.isalnum() or c in "|-" for c in like):
        raise SystemExit("bad operation key pattern " + like)
    rows = q("--dev", f"SELECT CAST(id AS CHAR) id, status, current_node_id, start_date, end_date, request_json_data, nodes_data FROM su_code_workflow_inst "
                      f"WHERE workflow_id={wf} AND id BETWEEN {lo} AND {hi} AND request_json_data LIKE '%{like}%'")
    ops = {}
    for r in rows:
        wp = json.loads(r["request_json_data"]).get("workflowparams") or {}
        nodes = {n.get("node_id"): n for n in json.loads(r["nodes_data"] or "[]") if n.get("node_id")}
        st = lambda ids: min([int(nodes[i]["start_time_millis"]) for i in ids if i in nodes and nodes[i].get("start_time_millis")] or [0])  # noqa: E731
        en = lambda ids: max([int(nodes[i]["end_time_millis"]) for i in ids if i in nodes and nodes[i].get("end_time_millis")] or [0])  # noqa: E731
        ops[str(wp.get("operation_key"))[-1:]] = {"instance": r["id"], "status": r["status"], "exit": r["current_node_id"], "start": int(r["start_date"] or 0),
                                                 "end": int(r["end_date"] or 0), "read0": st(TL_READ), "read1": en(TL_READ), "plan1": en(("code_node_IBplan",)),
                                                 "back0": st(TL_BACK)}
    return ops


def interleaving(ops):
    a, b = ops.get("A"), ops.get("B")
    if not a or not b:
        return "INCOMPLETE (an operation's run was not found)"
    if not all(x[k] for x in (a, b) for k in ("read0", "read1", "plan1", "back0")):
        return "INCOMPLETE (a node time is missing: an op answered before writing - e.g. REPLAY / BUSY / FAIL)"
    if b["read1"] <= a["read0"] and a["back0"] <= b["plan1"]:
        return "A INSIDE B's READ -> WRITE WINDOW (eb's silent interleaving: A read after B's read and finished writing before B wrote)"
    if a["read1"] <= b["plan1"] and b["read1"] <= a["plan1"]:
        return "OVERLAP (each read its cost rows before the other could start writing)"
    if a["read0"] >= b["back0"] or b["read0"] >= a["back0"]:
        return "SERIAL (one read after the other had finished writing)"
    return "PARTIAL OVERLAP (a read inside the other's write phase: outcome depends on the write order)"


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "classify":
        fx = json.load(open(sys.argv[2]))
        show(classify(fx["before"], fx["after"], fx["movements"], fx["materials"]), fx.get("about", ""))
        return
    cfg = load_config()
    if cmd == "snapshot":
        out = sys.argv[sys.argv.index("--out") + 1]
        snap = snapshot(cfg)
        json.dump(snap, open(out, "w"), indent=1)
        print(f"snapshot {snap['taken_at']}: fifo {len(snap['fifo'])}, wa {len(snap['wa'])}, item_balance {len(snap['item_balance'])}, item_batch_balance {len(snap['item_batch_balance'])} -> {out}")
    elif cmd == "check":
        run = sys.argv[sys.argv.index("--run") + 1]
        before = json.load(open(sys.argv[sys.argv.index("--before") + 1]))
        after = json.load(open(sys.argv[sys.argv.index("--after") + 1])) if "--after" in sys.argv else snapshot(cfg)
        mv, steps = run_rows(cfg, run)
        print(f"run {run}: {len(mv)} movements; engine answers stored: " + (", ".join(f"{s['job_id'][-1]} {s['step_name']}" for s in steps) or "none"))
        if not mv:
            raise SystemExit("no SACRACE|" + run + "| movement: nothing to reconcile")
        v = classify(before, after, mv, materials_of(cfg))
        show(v)
        sys.exit(0 if overall(v) == "CONSISTENT" else 1)
    elif cmd == "timeline":
        run = sys.argv[sys.argv.index("--run") + 1]
        ff = sys.argv[sys.argv.index("--fire") + 1] if "--fire" in sys.argv else os.path.join(cfg["out_dir"], run + ".fire.json")
        fire = json.load(open(ff))
        ops = timeline(cfg, run, fire)
        t0 = (ops.get("B") or ops.get("A") or {}).get("start") or 0
        for side in ("B", "A"):
            o = ops.get(side)
            if o:
                print(f"  {side} {o['instance']} {o['status']} {o['exit']}: start {o['start'] - t0:>6} ms, cost read {o['read0'] - t0}..{o['read1'] - t0}, plan done {o['plan1'] - t0}, "
                      f"writes done (read-back) {o['back0'] - t0}, end {o['end'] - t0}")
        print("INTERLEAVING", interleaving(ops))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
