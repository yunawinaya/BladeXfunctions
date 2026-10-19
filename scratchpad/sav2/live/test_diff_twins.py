"""Unit tests of diff_twins.py on synthetic snap.py-shaped snapshots (no database): a mini simulator applies the SAME designed
moves as twin A (classic: no job, NULL operation keys) and then twin B (V2: job + steps + keyed movements) on one world; then
faults are injected into B's after-snapshot and each must be reported by the right table / check.
  python3 scratchpad/sav2/live/test_diff_twins.py"""
import copy, json, os, sys
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import diff_twins as D  # noqa: E402

ORG, PLANT = "1901545950162329602", "1942795438353035266"
M_FIFO, M_WA, M_FB = "9100000000000000001", "9100000000000000002", "9100000000000000003"
B1, B2, BATCH, PCS = "2098295393555369986", "2105148434974937089", "9300000000000000001", "2021056571405717507"
SEQ = [9000000000000000000]


def nid():
    SEQ[0] += 1
    return str(SEQ[0])


def q4(x):
    return Decimal(x).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def world():
    w = {"meta": {}, "ib": [], "ibb": [], "fifo": [], "wa": [], "batch": [], "mv": [], "item": [], "sa": [], "sal": [], "sc": [], "scl": [], "job": [], "step": [],
         "lock": []}
    for m in (M_FIFO, M_WA, M_FB):
        for b in (B1, B2):
            w["ib"].append({"id": nid(), "material_id": m, "location_id": b, "plant_id": PLANT, "organization_id": ORG, "balance_quantity": "100.00000000",
                            "unrestricted_qty": "100.00000000", "reserved_qty": "0.00000000", "block_qty": "0.00000000", "qualityinsp_qty": "0.00000000",
                            "intransit_qty": "0.00000000", "update_time": "2026-10-16 21:00:00", "is_deleted": 0})
            w["lock"].append({"id": nid(), "lock_key": f"ITEM|{m}|{b}", "free_token": 1, "owner_operation_id": None})
    for b in (B1, B2):
        w["ibb"].append({"id": nid(), "material_id": M_FB, "location_id": b, "batch_id": BATCH, "plant_id": PLANT, "organization_id": ORG,
                         "balance_quantity": "100.00000000", "unrestricted_qty": "100.00000000", "remark": None, "is_deleted": 0})
    for m, b, prices in ((M_FIFO, None, (1, 2)), (M_FB, BATCH, (3, 4))):
        for s, p in enumerate(prices, 1):
            w["fifo"].append({"id": nid(), "material_id": m, "batch_id": b, "plant_id": PLANT, "fifo_sequence": str(s), "fifo_cost_price": f"{p}.00000000",
                              "fifo_initial_quantity": "100.00000000", "fifo_available_quantity": "100.00000000", "is_deleted": 0})
    w["wa"].append({"id": nid(), "material_id": M_WA, "batch_id": None, "plant_id": PLANT, "wa_quantity": "200.00000000", "wa_cost_price": "15.00000000",
                    "created_at": "2026-10-16 21:00:00", "is_deleted": 0})
    w["batch"].append({"id": BATCH, "material_id": M_FB, "batch_number": "SAV2T-B1", "initial_quantity": "100.00000000"})
    for m, c in ((M_FIFO, "SAV2T-FIFO"), (M_WA, "SAV2T-WA"), (M_FB, "SAV2T-FIFOB")):
        w["item"].append({"id": m, "material_code": c, "last_transaction_date": None, "update_time": "2026-10-16 21:00:00"})
    return w


# (material, bin, batch, movement, qty, price for In)
MOVES = [(M_FIFO, B1, None, "IN", 10, 7), (M_FIFO, B1, None, "OUT", 5, None), (M_WA, B1, None, "OUT", 5, None), (M_WA, B2, None, "IN", 10, 12),
         (M_WA, B2, None, "IN", 10, 18), (M_FB, B1, BATCH, "IN", 6, 8), (M_FB, B2, BATCH, "OUT", 4, None)]


def apply(w, twin, clock):
    w = copy.deepcopy(w)
    sa_id, job = nid(), nid() if twin == "B" else None
    lines = []
    for n, (m, b, bt, mv, qty, price) in enumerate(MOVES, 1):
        sign = 1 if mv == "IN" else -1
        bal = next(r for r in w["ib"] if r["material_id"] == m and r["location_id"] == b)
        snapshot_unr = bal["unrestricted_qty"]
        for c in ("balance_quantity", "unrestricted_qty"):
            bal[c] = str(Decimal(bal[c]) + sign * qty)
        bal["update_time"] = clock
        if bt:
            bb = next(r for r in w["ibb"] if r["material_id"] == m and r["location_id"] == b and r["batch_id"] == bt)
            for c in ("balance_quantity", "unrestricted_qty"):
                bb[c] = str(Decimal(bb[c]) + sign * qty)
            if mv == "IN" and twin == "B":
                bb["remark"] = ""  # the engine's remark gap (NULL -> '')
        if m in (M_FIFO, M_FB):
            layers = sorted([r for r in w["fifo"] if r["material_id"] == m and r["batch_id"] == bt], key=lambda r: int(r["fifo_sequence"]))
            if mv == "IN":
                w["fifo"].append({"id": nid(), "material_id": m, "batch_id": bt, "plant_id": PLANT, "fifo_sequence": str(int(layers[-1]["fifo_sequence"]) + 1),
                                  "fifo_cost_price": f"{price}.00000000", "fifo_initial_quantity": f"{qty}.00000000", "fifo_available_quantity": f"{qty}.00000000",
                                  "is_deleted": 0})
                unit = price
            else:
                left, unit = Decimal(qty), layers[0]["fifo_cost_price"]
                for l in layers:
                    take = min(left, Decimal(l["fifo_available_quantity"]))
                    if take > 0:
                        l["fifo_available_quantity"] = str(Decimal(l["fifo_available_quantity"]) - take)
                        left -= take
        else:
            wa = w["wa"][0]
            q0, p0 = Decimal(wa["wa_quantity"]), Decimal(wa["wa_cost_price"])
            if mv == "IN":
                wa["wa_cost_price"] = str(q4((q0 * p0 + qty * Decimal(price)) / (q0 + qty)))
                unit = price
            else:
                unit = p0
            wa["wa_quantity"] = str(q0 + sign * qty)
        w["mv"].append({"id": nid(), "transaction_type": "SA", "trx_no": f"SA/{twin}", "movement": mv, "item_id": m, "bin_location_id": b, "batch_number_id": bt,
                        "quantity": f"{qty}.000", "base_qty": f"{qty}.000", "uom_id": PCS, "unit_price": str(unit), "total_price": str(Decimal(str(unit)) * qty),
                        "inventory_category": "Unrestricted", "doc_date": "2026-10-16 00:00:00", "create_time": clock,
                        "operation_effect_key": f"SAC|{job}|M{n}" if twin == "B" else None})
        lines.append({"id": nid(), "stock_adjustment_id": sa_id, "line_index": str(n), "material_id": m, "uom_id": PCS, "total_quantity": str(qty),
                      "unit_price": f"{price or 0}.00000000", "is_deleted": 0, "adj_summary": f"Total: {qty} PCS",
                      "balance_index": json.dumps([{"balance_id": bal["id"], "material_id": m, "location_id": b, "batch_id": bt, "plant_id": PLANT,
                                                    "unrestricted_qty": float(snapshot_unr), "category": "Unrestricted", "movement_type": "In" if mv == "IN" else "Out",
                                                    "sa_quantity": qty}])})
    for it in w["item"]:
        it["last_transaction_date"], it["update_time"] = "2026-10-16 00:00:00", clock
    w["sa"].append({"id": sa_id, "adjustment_no": f"SA/20261016/{twin}", "stock_adjustment_status": "Completed", "adjustment_date": "2026-10-16 00:00:00",
                    "adjustment_type": "Stock Count", "plant_id": PLANT, "organization_id": ORG, "posted_status": "Unposted", "adjustment_no_type": "2028017875276812289",
                    "sa_v2_job_id": job, "sa_idem_key": f"SA:{ORG}:new-x:abc:1" if job else None, "is_deleted": 0, "create_time": clock})
    w["sal"] += lines
    if job:
        w["job"].append({"id": job, "command": "COMPLETE_SA", "job_status": "COMPLETED", "correlation_id": f"SA|{sa_id}", "error_code": None, "error_message": None,
                         "request_payload": json.dumps({"action": "DIRECT", "edited": 0, "scId": ""})})
        for s in ("W0_CLAIM_0", "A0_REVALIDATE", "A2_INVENTORY", "A4_REORDER", "A4_FINISH"):
            w["step"].append({"id": nid(), "job_id": job, "step_name": s, "step_status": "DONE"})
        w["step"].append({"id": nid(), "job_id": f"SAC|{sa_id}", "step_name": "LOCK|1", "step_status": "LOCK"})
        for s in ("IBA|I|001", "IBA|DONE"):
            w["step"].append({"id": nid(), "job_id": f"SAC|{job}", "step_name": s, "step_status": "DONE"})
    return w


def expected():
    exp = {"ib": {}, "ibb": {}, "mv": [], "fifo_new": {}, "wa_qty": {}}
    for m, b, bt, mv, qty, price in MOVES:
        s = 1 if mv == "IN" else -1
        exp["ib"][f"{m}|{b}"] = str(Decimal(exp["ib"].get(f"{m}|{b}", "0")) + s * qty)
        if bt:
            exp["ibb"][f"{m}|{b}|{bt}"] = str(Decimal(exp["ibb"].get(f"{m}|{b}|{bt}", "0")) + s * qty)
        exp["mv"].append({"item_id": m, "bin": b, "batch": bt or "", "movement": mv, "quantity": str(qty), "base_qty": str(qty), "uom_id": PCS,
                          "unit_price_in": str(price) if mv == "IN" else None})
        if mv == "IN" and m != M_WA:
            exp["fifo_new"].setdefault(f"{m}|{bt or ''}", []).append([str(qty), str(price)])
        if m == M_WA:
            exp["wa_qty"][m] = str(Decimal(exp["wa_qty"].get(m, "0")) + s * qty)
    return exp


RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append(cond)
    print(("ok    " if cond else "FAIL  ") + name + ("" if cond else "  " + str(detail)[:400]))


def run(A0, A1, B0, B1):
    report, bad, infos = D.compare(A0, A1, B0, B1)
    tables = {r["table"]: r for r in report}
    return tables, bad, infos


def differ(tables):
    return sorted(t for t, r in tables.items() if not r["same"])


def main():
    w0 = world()
    A0 = w0
    A1 = apply(A0, "A", "2026-10-16 22:00:00")
    B0 = copy.deepcopy(A1)
    B1 = apply(B0, "B", "2026-10-16 22:05:00")
    exp = expected()

    tables, bad, infos = run(A0, A1, B0, B1)
    check("identical twins: every table SAME", bad == 0, differ(tables))
    check("deltas counted (ib 5 changed, mv 7 new, fifo 2 new + 2 changed, sa 1 new, sal 7 new)",
          (tables["ib"]["A"], tables["mv"]["A"], tables["fifo"]["A"], tables["sa"]["A"], tables["sal"]["A"]) == (5, 7, 4, 1, 7),
          (tables["ib"]["A"], tables["mv"]["A"], tables["fifo"]["A"], tables["sa"]["A"], tables["sal"]["A"]))
    check("WA price back to 15.0000 in both twins (12 / 18 design)", Decimal(A1["wa"][0]["wa_cost_price"]) == 15 and Decimal(B1["wa"][0]["wa_cost_price"]) == 15,
          (A1["wa"][0]["wa_cost_price"], B1["wa"][0]["wa_cost_price"]))
    check("masked: operation_effect_key / sa_v2_job_id / sa_idem_key / numbers / ids not reported", tables["mv"]["same"] and tables["sa"]["same"])
    check("remark NULL -> '' (engine remark gap) is INFO, not a difference", tables["ibb"]["same"] and any("remark None -> ''" in i for i in infos), infos)
    check("designed moves PASS for A", D.check_expect("A", A0, A1, exp) == [], D.check_expect("A", A0, A1, exp))
    check("designed moves PASS for B", D.check_expect("B", B0, B1, exp) == [], D.check_expect("B", B0, B1, exp))
    v2a = D.v2_checks("A", A0, A1, False)
    v2b = D.v2_checks("B", B0, B1, True)
    check("V2 checks PASS (A no job, B COMPLETED + steps + keyed movements + no lock held)", all(ok for ok, _ in v2a + v2b), [t for ok, t in v2a + v2b if not ok])

    def inject(fn):
        b1 = copy.deepcopy(B1)
        fn(b1)
        return run(A0, A1, B0, b1), b1

    (t, bad, _), _ = inject(lambda b: b["wa"][0].update(wa_cost_price="15.00010000"))
    check("B WA price off by 0.0001 -> wa DIFFER", differ(t) == ["wa"], differ(t))
    (t, bad, _), b1 = inject(lambda b: b["mv"].append(dict(b["mv"][-1], id=nid(), quantity="1.000", base_qty="1.000")))
    check("B extra movement -> mv DIFFER", differ(t) == ["mv"], differ(t))
    check("B extra movement -> designed moves FAIL for B", D.check_expect("B", B0, b1, exp) != [])

    def other_layer(b):
        # B consumed FIFO seq 2 instead of seq 1 (same quantities)
        l1 = next(r for r in b["fifo"] if r["material_id"] == M_FIFO and r["fifo_sequence"] == "1")
        l2 = next(r for r in b["fifo"] if r["material_id"] == M_FIFO and r["fifo_sequence"] == "2")
        l1["fifo_available_quantity"] = str(Decimal(l1["fifo_available_quantity"]) + 5)
        l2["fifo_available_quantity"] = str(Decimal(l2["fifo_available_quantity"]) - 5)
    (t, bad, _), _ = inject(other_layer)
    check("B consumed another FIFO layer -> fifo DIFFER", differ(t) == ["fifo"], differ(t))
    (t, bad, _), _ = inject(lambda b: b.update(item=copy.deepcopy(B0["item"])))
    check("B left Item last_transaction_date untouched -> item DIFFER", differ(t) == ["item"], differ(t))
    (t, bad, _), _ = inject(lambda b: b["sa"][-1].update(adjustment_no="SA/20261016/9999"))
    check("a different SA number is masked -> SAME", differ(t) == [], differ(t))
    (t, bad, _), _ = inject(lambda b: b["sa"][-1].update(adjustment_date="2026-10-15 00:00:00"))
    check("a different adjustment_date -> sa DIFFER", differ(t) == ["sa"], differ(t))
    (t, bad, _), _ = inject(lambda b: b["sa"][-1].update(posted_status=None))
    check("posted_status Unposted vs NULL -> sa DIFFER", differ(t) == ["sa"], differ(t))

    def snap_fields(b):
        l = b["sal"][-1]
        e = json.loads(l["balance_index"])
        e[0]["unrestricted_qty"] = 12345
        l["balance_index"] = json.dumps(e)
    (t, bad, _), _ = inject(snap_fields)
    check("balance_index snapshot quantities differ -> SAME (state, not effect)", differ(t) == [], differ(t))

    def entry_qty(b):
        l = b["sal"][-1]
        e = json.loads(l["balance_index"])
        e[0]["sa_quantity"] = 5
        l["balance_index"] = json.dumps(e)
    (t, bad, _), _ = inject(entry_qty)
    check("balance_index sa_quantity differs -> sal DIFFER", differ(t) == ["sal"], differ(t))

    def soft_reinsert(b):
        # the subform rewritten: old line rows soft-deleted, the same lines inserted again under new ids
        sa_id = b["sa"][-1]["id"]
        mine = [l for l in b["sal"] if l["stock_adjustment_id"] == sa_id]
        for l in mine:
            b["sal"].append(dict(l, id=nid()))
            l["is_deleted"] = 1
    (t, bad, infos), _ = inject(soft_reinsert)
    check("lines re-inserted + old ones soft-deleted -> live lines SAME + INFO", differ(t) == [] and any("soft-deleted" in i for i in infos), (differ(t), infos[-2:]))
    (t, bad, _), b1 = inject(lambda b: b["job"][-1].update(job_status="FAILED", error_code="SA_INVENTORY_INSUFFICIENT"))
    check("B job FAILED -> V2 check FAIL", not all(ok for ok, _ in D.v2_checks("B", B0, b1, True)))
    (t, bad, _), b1 = inject(lambda b: b["lock"][0].update(free_token=0, owner_operation_id="SAC|x"))
    check("a lock left held -> V2 check FAIL", not all(ok for ok, _ in D.v2_checks("B", B0, b1, True)))
    (t, bad, _), b1 = inject(lambda b: b["mv"][-1].update(operation_effect_key=None))
    check("a V2 movement without its SAC| key -> V2 check FAIL (and mv still SAME: the key is V2-only)",
          not all(ok for ok, _ in D.v2_checks("B", B0, b1, True)) and differ(t) == [], differ(t))
    (t, bad, _), b1 = inject(lambda b: [s.update(step_status="REVIEW") for s in b["step"] if s["step_name"] == "A4_FINISH"])
    check("a missing A4_FINISH DONE -> V2 check FAIL", not all(ok for ok, _ in D.v2_checks("B", B0, b1, True)))

    def wrong_delta(b):
        r = next(x for x in b["ib"] if x["material_id"] == M_WA and x["location_id"] == B2)
        r["balance_quantity"] = str(Decimal(r["balance_quantity"]) + 1)
    (t, bad, _), b1 = inject(wrong_delta)
    check("a balance off by 1 -> ib DIFFER + designed moves FAIL", differ(t) == ["ib"] and D.check_expect("B", B0, b1, exp) != [], differ(t))
    # A2-style edit twins: both change an existing Draft (chg), the number re-issued in both (masked)
    d0 = world()
    d0["sa"] += [{"id": "1", "adjustment_no": "Draft-SA-0001", "stock_adjustment_status": "Draft", "adjustment_date": "2026-10-16 00:00:00", "is_deleted": 0},
                 {"id": "2", "adjustment_no": "Draft-SA-0002", "stock_adjustment_status": "Draft", "adjustment_date": "2026-10-16 00:00:00", "is_deleted": 0}]
    d1 = copy.deepcopy(d0)
    d1["sa"][0].update(adjustment_no="SA/1", stock_adjustment_status="Completed", adjustment_date="2026-10-15 00:00:00")
    e0 = copy.deepcopy(d1)
    e1 = copy.deepcopy(e0)
    e1["sa"][1].update(adjustment_no="SA/2", stock_adjustment_status="Completed", adjustment_date="2026-10-15 00:00:00", sa_v2_job_id="77", sa_idem_key="k")
    t, bad, _ = run(d0, d1, e0, e1)
    check("edit twins (Draft -> Completed, new number, new date) -> sa SAME", differ(t) == [], differ(t))
    e1["sa"][1]["adjustment_date"] = "2026-10-16 00:00:00"
    t, bad, _ = run(d0, d1, e0, e1)
    check("edit twins, B kept the old date -> sa DIFFER", differ(t) == ["sa"], differ(t))
    # F1: a failed job that must have moved nothing
    f0 = world()
    f1 = copy.deepcopy(f0)
    f1["sa"].append({"id": "5", "adjustment_no": "SA/5", "stock_adjustment_status": "Draft", "is_deleted": 0})
    f1["job"].append({"id": "6", "job_status": "FAILED", "error_code": "SA_INVENTORY_INSUFFICIENT", "error_message": "Insufficient quantity", "correlation_id": "SA|5"})
    check("F1: failed job, SA Draft, nothing moved -> NOTHING MOVED", D.nothing_moved(f0, f1, "SA_INVENTORY_INSUFFICIENT") == 0)
    f2 = copy.deepcopy(f1)
    f2["mv"].append({"id": nid(), "movement": "IN", "item_id": M_WA, "bin_location_id": B1, "quantity": "1.000"})
    check("F1: a movement written -> FAIL", D.nothing_moved(f0, f2, "SA_INVENTORY_INSUFFICIENT") > 0)
    f3 = copy.deepcopy(f1)
    f3["sa"][-1]["stock_adjustment_status"] = "Processing"
    check("F1: SA left Processing (no unlock) -> FAIL", D.nothing_moved(f0, f3, "SA_INVENTORY_INSUFFICIENT") > 0)
    print(f"{sum(RESULTS)}/{len(RESULTS)} passed")
    sys.exit(0 if all(RESULTS) else 1)


if __name__ == "__main__":
    main()
