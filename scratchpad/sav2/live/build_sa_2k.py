"""Build (read-only) a ~2,000-entry Stock Adjustment FORM request for SA V2 live tests, from today's real dev balances of one
tenant + plant: the SA form's Completed payload (adjustment_type "Stock Count": In and Out entries; FIFO + WA items; the
batch-managed items' batch balances), exactly in the shape the form sends (header + stock_adjustment lines whose
balance_index is the JSON of the chosen balance rows + balance_id, category, movement_type, sa_quantity).

Writes to --out (outside the repo, default the session scratchpad):
  sa2k_classic.json        STOCK_ADJUSTMENT request {allData, saveAs "Completed", pageStatus "Add"} (the guarded classic
                           refuses > 500 entries: SA_CLASSIC_TOO_BIG)
  sa2k_v2_submit.json      SA_V2_SUBMIT request (CONTRACT §7, source FORM, DIRECT): form = allData, a fresh idempotency key
  sa2k_engine_input.json   the rows INVENTORY_BULK_APPLY would read + the doc, for live/plan_check.js
and prints the payload's shape and the engine planner's verdict on it (every movement planned against today's rows).
Nothing is written to any database.

usage: python3 build_sa_2k.py [--tenant 496474] [--org 1901545950162329602] [--plant 1942795438353035266] [--entries 2000]
                              [--per-line 4] [--out-share 0.5] [--out-qty 1] [--in-qty 1] [--seed 20261016] [--out DIR]
"""
import datetime, hashlib, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, HERE)
import stock_reads as S  # noqa: E402

DEFAULT_OUT = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/b63ef53a-d07d-46f1-9737-73cc10430822/scratchpad/sav2-live"


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def cost_for(item, mat, fifo, wa):
    """the review build's costFor: newest WA price / newest FIFO layer price at the plant, else the purchase price"""
    if item["material_costing_method"] == S.WA:
        rows = sorted([r for r in wa if r["material_id"] == mat and r["batch_id"] in ("0", "")], key=lambda r: r["created_at"] or "", reverse=True)
        if rows and S.num(rows[0]["wa_cost_price"]) > 0:
            return S.clean(rows[0]["wa_cost_price"])
    else:
        rows = sorted([r for r in fifo if r["material_id"] == mat], key=lambda r: int(S.num(r["fifo_sequence"])), reverse=True)
        if rows and S.num(rows[0]["fifo_cost_price"]) > 0:
            return S.clean(rows[0]["fifo_cost_price"])
    return S.clean(item["purchase_unit_price"])


def main():
    tenant, org, plant = arg("--tenant", "496474"), arg("--org", "1901545950162329602"), arg("--plant", "1942795438353035266")
    n_target, per_line = int(arg("--entries", "2000")), int(arg("--per-line", "4"))
    out_share, q_out, q_in = float(arg("--out-share", "0.5")), float(arg("--out-qty", "1")), float(arg("--in-qty", "1"))
    rnd = random.Random(int(arg("--seed", "20261016")))
    out = S.out_dir(arg("--out", DEFAULT_OUT))
    st = S.Stock(tenant, org, plant)
    items = st.items()
    bins = {b["id"]: b["bin_location_combine"] for b in st.bins()}
    nb = [r for r in st.balances() if r["material_id"] in items and int(items[r["material_id"]]["item_batch_management"] or 0) == 0 and r["location_id"] in bins]
    bb = [r for r in st.balances(batch=True) if r["material_id"] in items and int(items[r["material_id"]]["item_batch_management"] or 0) == 1 and r["location_id"] in bins]
    mats = sorted({r["material_id"] for r in nb + bb})
    fifo, wa = st.cost_rows(mats)
    wa_mats = {r["material_id"] for r in wa if r["batch_id"] in ("0", "")}
    uoms, batches = st.names({items[m]["based_uom"] for m in mats}, {r["batch_id"] for r in bb})

    # entry slots: the balance rows in a seeded shuffle, cycled until the target (a row may carry several entries, as two lines
    # of one item can); same-material entries are grouped into lines of <= per_line in that order
    rows = [(r, False) for r in nb] + [(r, True) for r in bb]
    rnd.shuffle(rows)
    taken_out = {}
    picks = []
    k = 0
    while len(picks) < n_target and rows:
        r, is_batch = rows[k % len(rows)]
        k += 1
        it = items[r["material_id"]]
        # Out only while the row can still give q_out (every Out of the doc on that row counted) and, for WA, a WA row exists
        can_out = taken_out.get(r["id"], 0) + q_out <= S.num(r["unrestricted_qty"]) and (it["material_costing_method"] != S.WA or r["material_id"] in wa_mats)
        mt = "Out" if can_out and rnd.random() < out_share else "In"
        if mt == "Out":
            taken_out[r["id"]] = taken_out.get(r["id"], 0) + q_out
        picks.append((r, is_batch, mt))
    by_mat = {}
    for p in picks:
        by_mat.setdefault(p[0]["material_id"], []).append(p)
    lines = []
    for mat in sorted(by_mat, key=lambda m: items[m]["material_code"] or m):
        it = items[mat]
        group = by_mat[mat]
        for i in range(0, len(group), per_line):
            chunk = group[i:i + per_line]
            entries = [S.entry_of(r, mt, q_out if mt == "Out" else q_in, batch=is_batch) for r, is_batch, mt in chunk]
            total = sum(e["sa_quantity"] for e in entries)
            uom = uoms.get(it["based_uom"], "")
            details = []
            for j, e in enumerate(entries):
                d = f"{j + 1}. {bins.get(e['location_id'], e['location_id'])}: {S.clean(e['sa_quantity'])} {uom} (UNR) - {'IN' if e['movement_type'] == 'In' else 'OUT'}"
                if e.get("batch_id"):
                    d += f"\n[{batches.get(e['batch_id'], '')}]"
                details.append(d)
            has_in = any(e["movement_type"] == "In" for e in entries)
            lines.append({
                "material_id": mat, "material_name": it["material_name"] or "", "material_desc": it["material_desc"] or "", "adjustment_reason": "",
                "total_quantity": S.clean(total), "uom_id": it["based_uom"], "unit_price": cost_for(it, mat, fifo, wa) if has_in else 0,
                "adj_summary": f"Total: {S.clean(total)} {uom}\nDETAILS:\n" + "\n".join(details), "adjustment_remarks": "", "plant_id": "",
                "item_category": it["item_category"] or "", "line_index": "", "is_serialized_item": 0, "is_single_serial": 0, "item_remark": "",
                "item_remark2": "", "item_remark3": "", "project_id": "", "fm_key": hashlib.md5(f"{mat}{i}".encode()).hexdigest()[:8],
                "balance_index": json.dumps(entries, ensure_ascii=False, separators=(",", ":")),
            })
    today = datetime.date.today().isoformat()
    all_data = {
        "stock_adjustment_status": "", "page_status": "Add", "posted_status": "", "plant_id": st.plant, "adjustment_no": "",
        "adjustment_no_type": st.default_rule("Stock Adjustment"), "adjustment_date": today, "adjustment_type": "Stock Count", "stock_count_id": "",
        "adjusted_by": "admin", "organization_id": st.org, "acc_integration_type": st.acc_integration(), "previous_status": "", "project_id": "",
        "reference_documents": [], "adjustment_remarks": f"SA V2 2k test ({len(picks)} entries)", "adjustment_remarks2": "", "adjustment_remarks3": "",
        "error_message": "", "stock_adjustment": lines,
    }
    classic = {"allData": all_data, "saveAs": "Completed", "pageStatus": "Add"}
    canon = json.dumps({"saveAs": "Completed", "pageStatus": "Add", "record": all_data}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    token = hashlib.sha256((canon + today).encode()).hexdigest()[:12]
    v2 = {"operation": "SUBMIT", "source": "FORM", "saveAs": "Completed", "pageStatus": "Add", "sa_id": "", "sc_id": "",
          "idempotency_key": f"SA:{st.org}:new-{token}:{hashlib.sha256(canon.encode()).hexdigest()[:16]}:1", "form": all_data,
          "organization_id": st.org, "nickname": "", "adjustment_date": "", "create_adjustment": ""}
    # the engine's view: the doc's §5 movements over every row it would read (fifo / wa of the materials at the plant)
    used = {l["material_id"] for l in lines}
    hdr = {"plant_id": st.plant, "organization_id": st.org, "adjustment_no": "SA/2K-TEST", "adjustment_date": today + " 00:00:00"}
    eng = {"saDoc": {"stock_adjustment": lines}, "hdr": hdr, "items": [items[m] for m in sorted(used)],
           "itemBalances": [r for r in nb if r["material_id"] in used], "batchBalances": [r for r in bb if r["material_id"] in used],
           "fifoLayers": [r for r in fifo if r["material_id"] in used], "waRows": [r for r in wa if r["material_id"] in used], "precision": st.precision()}
    sizes = {
        "sa2k_classic.json": S.write_json(os.path.join(out, "sa2k_classic.json"), classic),
        "sa2k_v2_submit.json": S.write_json(os.path.join(out, "sa2k_v2_submit.json"), v2),
        "sa2k_engine_input.json": S.write_json(os.path.join(out, "sa2k_engine_input.json"), eng),
    }
    ent = [e for l in lines for e in json.loads(l["balance_index"])]
    big = max(len(l["balance_index"].encode()) for l in lines)
    meth = {}
    for l in lines:
        mm = items[l["material_id"]]["material_costing_method"]
        meth[mm] = meth.get(mm, 0) + len(json.loads(l["balance_index"]))
    print(f"SA 2k payload: tenant {st.t}, org {st.org}, plant {st.plant}; {len(lines)} lines, {len(ent)} entries "
          f"(Out {sum(e['movement_type'] == 'Out' for e in ent)}, In {sum(e['movement_type'] == 'In' for e in ent)}, batch {sum(1 for e in ent if e.get('batch_id'))}); "
          f"by method {meth}; {len(used)} materials, {len({(e['material_id'], e['location_id']) for e in ent})} bins x materials")
    print(f"  largest balance_index {big} bytes (limit 60,000); per-line entries <= {per_line}; adjustment_type Stock Count; header rule {all_data['adjustment_no_type']}")
    for f, b in sizes.items():
        print(f"  {os.path.join(out, f)}  {b / 1e6:.2f} MB")
    print("  engine plan (live/plan_check.js, today's rows): " + S.plan_check(os.path.join(out, "sa2k_engine_input.json")).replace("\n", "\n  "))


if __name__ == "__main__":
    main()
