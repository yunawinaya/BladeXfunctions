"""Build (read-only) a ~2,000-line Stock Count REVIEW request for SC Review V2 live tests, from today's real dev balances of
one tenant + plant: approved variance lines (review_status / line_status Approved, adjusted_qty = variance), mixed In / Out,
FIFO + WA items, the batch-managed items' batch rows. Nothing is written to any database; the files go to --out (outside
the repo, default the session scratchpad).

A Review needs a STORED Stock Count whose line ids it carries, so the build has two steps:
  issue                     pick the 2,000 lines -> plan.json + sc_issue.json (STOCK_COUNT saveAs "Issued", pageStatus "Add":
                            creates the SC with Pending lines - a WRITE the controller runs after the user's yes) +
                            sc_review.preview.json (the review payload with null ids: sizes / offline chain tests)
  review --sc-id <id>       read that SC + its lines (read-only) -> sc_count.json (saveAs "Stock Count", Edit: counts entered,
                            is_counted 1 -> Completed / To Be Reviewed), sc_review.json (saveAs "Review", Edit: the classic
                            Review request; the guarded classic refuses > 500 approved variance lines), sa_v2_submit_review.json
                            (SA_V2_SUBMIT REVIEW request, CONTRACT §7), review_engine_input.json; then re-checks every Out
                            against today's unrestricted stock and plans the SA the review would build with the real engine
                            planner (live/plan_check.js). sc_review / the V2 request assume sc_count.json ran first (V2 STALE
                            compares the payload's stock_count_status / review_status with the stored ones).

usage: python3 build_review_2k.py issue [--tenant 496474] [--org 1901545950162329602] [--plant 1942795438353035266] [--lines 2000]
                                        [--out-share 0.45] [--out-qty 1] [--in-qty 2] [--seed 20261016] [--out DIR]
       python3 build_review_2k.py review --sc-id ID [--tenant ...] [--org ...] [--plant ...] [--plan DIR/plan.json] [--out DIR]
       python3 build_review_2k.py review --preview [--plan DIR/plan.json] [--out DIR]    (no SC yet: the plan's lines, ids null)
"""
import datetime, hashlib, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, HERE)
import stock_reads as S  # noqa: E402

DEFAULT_OUT = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/b63ef53a-d07d-46f1-9737-73cc10430822/scratchpad/sav2-live"


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def key(m, loc, batch):
    return f"{m}|{loc}|{batch or ''}"


def distribution(bal, variance=None):
    """the SC form's balance_distribution text (dialog add; count handler appends the variance)"""
    total = S.clean(bal.get("balance_quantity")) if bal else 0
    v = "" if variance is None else (f" (+{S.clean(variance)})" if variance >= 0 else f" ({S.clean(variance)})")
    details = []
    for col, label in (("unrestricted_qty", "Unrestricted"), ("reserved_qty", "Reserved"), ("block_qty", "Blocked"), ("qualityinsp_qty", "Quality Inspection"), ("intransit_qty", "In Transit")):
        x = S.num((bal or {}).get(col))
        if x > 0 or (col == "unrestricted_qty" and variance not in (None, 0)):
            details.append(f"  • {label}: {S.clean(x)}" + (v if col == "unrestricted_qty" else ""))
    return f"TOTAL: {total}{v}" + ("\n\nBreakdown:\n" + "\n".join(details) if details else "")


def pct(variance, system):
    return f"{abs(variance / system) * 100:.2f}%" if system else "0%"


def issue(st, out):
    n_lines = int(arg("--lines", "2000"))
    out_share, q_out, q_in = float(arg("--out-share", "0.45")), float(arg("--out-qty", "1")), float(arg("--in-qty", "2"))
    rnd = random.Random(int(arg("--seed", "20261016")))
    items = st.items()
    bins = {b["id"]: b["bin_location_combine"] for b in st.bins()}
    nb = [r for r in st.balances() if r["material_id"] in items and int(items[r["material_id"]]["item_batch_management"] or 0) == 0 and r["location_id"] in bins]
    bb = [r for r in st.balances(batch=True) if r["material_id"] in items and int(items[r["material_id"]]["item_batch_management"] or 0) == 1 and r["location_id"] in bins]
    _, wa = st.cost_rows(sorted({r["material_id"] for r in nb + bb} | {m for m, it in items.items() if it["material_costing_method"] == S.WA}))
    wa_mats = {r["material_id"] for r in wa if r["batch_id"] in ("0", "")}
    rows = [(r, r.get("batch_id")) for r in nb] + [(r, r["batch_id"]) for r in bb]
    rnd.shuffle(rows)
    plan, seen = [], set()
    for r, batch in rows:
        if len(plan) >= n_lines:
            break
        it = items[r["material_id"]]
        k = key(r["material_id"], r["location_id"], batch)
        if k in seen:
            continue
        seen.add(k)
        can_out = S.num(r["unrestricted_qty"]) >= q_out and (it["material_costing_method"] != S.WA or r["material_id"] in wa_mats)
        d = -q_out if can_out and rnd.random() < out_share / max(1e-9, min(1.0, len(rows) / n_lines)) else q_in
        plan.append({"material_id": r["material_id"], "location_id": r["location_id"], "batch_id": batch or None, "system_qty": S.clean(r["balance_quantity"]),
                     "variance": d, "count_qty": S.clean(S.num(r["balance_quantity"]) + d), "method": it["material_costing_method"], "found": False, "balance": r})
    # "found stock": In lines on (non-batch item, bin) pairs without a balance row, until the line count is reached
    pairs = [(m, b) for m, it in sorted(items.items()) if int(it["item_batch_management"] or 0) == 0 for b in sorted(bins)]
    rnd.shuffle(pairs)
    for m, b in pairs:
        if len(plan) >= n_lines:
            break
        if key(m, b, None) in seen:
            continue
        seen.add(key(m, b, None))
        plan.append({"material_id": m, "location_id": b, "batch_id": None, "system_qty": 0, "variance": q_in, "count_qty": q_in, "method": items[m]["material_costing_method"],
                     "found": True, "balance": None})
    lines = []
    for p in plan:
        it = items[p["material_id"]]
        lines.append({"material_id": p["material_id"], "material_name": it["material_name"] or "", "material_desc": it["material_desc"] or "", "item_category": it["item_category"] or "",
                      "uom_id": it["based_uom"], "base_uom_id": it["based_uom"], "balance_distribution": distribution(p["balance"]), "system_qty": p["system_qty"],
                      "location_id": p["location_id"], "batch_id": p["batch_id"], "line_status": "Pending", "plant_id": st.plant})
    header = {"plant_id": st.plant, "organization_id": st.org, "count_type": "Location", "count_method": "Ad Hoc Count", "assignees": "User", "user_assignees": [],
              "work_group_assignees": [], "blind_count": 0, "stock_count_no": "", "stock_count_no_type": st.default_rule("Stock Count"), "stock_count_status": "",
              "review_status": "", "page_status": "Add", "previous_status": "", "storage_location_id": [], "location": "{}", "batch_balance": "{}", "item_list": [],
              "stock_count_remark": f"SC Review V2 2k test ({len(lines)} lines)", "stock_count_remark2": "", "stock_count_remark3": ""}
    sc_issue = {"allData": dict(header, table_stock_count=lines), "saveAs": "Issued", "pageStatus": "Add", "organizationId": st.org, "nickname": "admin"}
    for p in plan:
        p.pop("balance")
    sizes = {"plan.json": S.write_json(os.path.join(out, "plan.json"), {"tenant": st.t, "org": st.org, "plant": st.plant, "lines": plan}),
             "sc_issue.json": S.write_json(os.path.join(out, "sc_issue.json"), sc_issue)}
    preview = review_payloads(st, dict(header, id=None, stock_count_no="<issued>", stock_count_status="Issued", review_status=""),
                              [dict(l, id=None, line_index=str(i + 1)) for i, l in enumerate(lines)], plan, "<sc id>")[1]
    sizes["sc_review.preview.json"] = S.write_json(os.path.join(out, "sc_review.preview.json"), preview)
    n_out = sum(p["variance"] < 0 for p in plan)
    print(f"SC review 2k plan: tenant {st.t}, org {st.org}, plant {st.plant}; {len(plan)} lines (Out {n_out}, In {len(plan) - n_out}, batch {sum(1 for p in plan if p['batch_id'])}, "
          f"found stock (no balance row) {sum(1 for p in plan if p['found'])}); by method " + json.dumps({m: sum(p['method'] == m for p in plan) for m in (S.FIFO, S.WA)}))
    for f, b in sizes.items():
        print(f"  {os.path.join(out, f)}  {b / 1e6:.2f} MB")
    print("  next (WRITE, user's yes): run sc_issue.json through STOCK_COUNT 2066808904123076610 as a real user of the tenant, e.g.")
    print(f"    node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id{st.t}.json 2066808904123076610 {out}/sc_issue.json {out}/sc_issue.out.json")
    print(f"  then (read-only): python3 scratchpad/sav2/live/build_review_2k.py review --sc-id <the new SC id> --plan {out}/plan.json")


def review_payloads(st, hdr, stored_lines, plan, sc_id):
    """(sc_count request, sc_review request, the review's allData) from the stored SC lines and the plan's counts"""
    by = {key(p["material_id"], p["location_id"], p.get("batch_id")): p for p in plan}
    counted, approved = [], []
    for i, ln in enumerate(stored_lines):
        p = by.get(key(ln["material_id"], ln["location_id"], ln.get("batch_id")))
        system = S.num(ln.get("system_qty"))
        v = p["variance"] if p else (2 if i % 2 else -1 if system >= 1 else 2)
        c = dict(ln, count_qty=S.clean(system + v), variance_qty=S.clean(v), adjusted_qty=S.clean(v), variance_percentage=pct(v, system), is_counted=1,
                 line_status="Counted", balance_distribution=distribution({"balance_quantity": system, "unrestricted_qty": system}, v))
        counted.append(c)
        approved.append(dict(c, line_status="Approved", review_status="Approved"))
    today = datetime.date.today().isoformat()
    count_req = {"allData": dict(hdr, page_status="Edit", table_stock_count=counted), "saveAs": "Stock Count", "pageStatus": "Edit", "organizationId": st.org}
    rv = dict(hdr, page_status="Edit", stock_count_status="Completed", review_status="To Be Reviewed", previous_status="Completed", table_stock_count=approved)
    review_req = {"allData": rv, "saveAs": "Review", "pageStatus": "Edit", "organizationId": st.org, "nickname": "admin", "adjustmentDate": today,
                  "proceedReview": "", "createAdjustment": "Yes"}
    return count_req, review_req


def review(st, out):
    preview = "--preview" in sys.argv
    sc_id = "0" if preview else S.digits(arg("--sc-id", ""), "--sc-id")
    plan_path = arg("--plan", os.path.join(out, "plan.json"))
    plan = json.load(open(plan_path))["lines"] if os.path.exists(plan_path) else []
    if preview:
        # no stored SC yet: the planned lines stand in for the stored ones (ids null) - feasibility + engine plan only
        items0 = st.items()
        hdr = {"id": None, "stock_count_no": "<issued>", "stock_count_status": "Issued", "review_status": "", "plant_id": st.plant, "organization_id": st.org,
               "count_type": "Location", "count_method": "Ad Hoc Count", "user_assignees": [], "work_group_assignees": [], "storage_location_id": [],
               "location": "{}", "batch_balance": "{}", "item_list": []}
        lines = [{"id": None, "material_id": p["material_id"], "material_name": items0.get(p["material_id"], {}).get("material_name") or "", "material_desc": "",
                  "item_category": "", "uom_id": items0.get(p["material_id"], {}).get("based_uom"), "base_uom_id": items0.get(p["material_id"], {}).get("based_uom"),
                  "balance_distribution": "", "system_qty": p["system_qty"], "location_id": p["location_id"], "batch_id": p.get("batch_id"),
                  "line_status": "Pending", "review_status": "", "plant_id": st.plant, "line_index": str(i + 1), "is_serialized": 0, "is_single": 0}
                 for i, p in enumerate(plan)]
        return review_rest(st, out, sc_id, hdr, lines, plan, ".preview")
    hdr = S.q("--dev", "SELECT CAST(id AS CHAR) id, stock_count_no, CAST(stock_count_no_type AS CHAR) stock_count_no_type, stock_count_status, review_status, adjustment_status, "
                       "CAST(plant_id AS CHAR) plant_id, organization_id, count_type, count_method, assignees, blind_count, stock_count_remark, stock_count_remark2, "
                       f"stock_count_remark3, total_counted, total_variance FROM stock_count WHERE tenant_id='{st.t}' AND is_deleted=0 AND id={sc_id}")
    if not hdr:
        raise SystemExit(f"no Stock Count {sc_id} in tenant {st.t}")
    hdr = {k: v for k, v in hdr[0].items() if v is not None}
    hdr.update({"user_assignees": [], "work_group_assignees": [], "storage_location_id": [], "location": "{}", "batch_balance": "{}", "item_list": []})
    lines = S.q("--dev", "SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, material_name, material_desc, item_category, CAST(uom_id AS CHAR) uom_id, "
                         "CAST(base_uom_id AS CHAR) base_uom_id, balance_distribution, CAST(system_qty AS CHAR) system_qty, CAST(location_id AS CHAR) location_id, "
                         "CAST(batch_id AS CHAR) batch_id, line_status, review_status, CAST(plant_id AS CHAR) plant_id, line_index, is_serialized, is_single "
                         f"FROM stock_count_h4c9e1cl_sub WHERE tenant_id='{st.t}' AND is_deleted=0 AND stock_count_id={sc_id} ORDER BY CAST(line_index AS UNSIGNED), id")
    for ln in lines:
        ln["system_qty"] = S.clean(ln["system_qty"])
        for k in [k for k, v in ln.items() if v is None]:
            ln[k] = "" if k not in ("batch_id",) else None
    return review_rest(st, out, sc_id, hdr, lines, plan, "")


def review_rest(st, out, sc_id, hdr, lines, plan, sfx):
    count_req, review_req = review_payloads(st, hdr, lines, plan, sc_id)
    rv = review_req["allData"]
    canon = json.dumps({"createAdjustment": "Yes", "record": rv}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    v2 = {"operation": "SUBMIT", "source": "REVIEW", "saveAs": "Completed", "pageStatus": "Edit", "sa_id": "", "sc_id": sc_id,
          "idempotency_key": f"SCR:{st.org}:{sc_id}:{hashlib.sha256(canon.encode()).hexdigest()[:16]}:1", "form": rv, "organization_id": st.org,
          "nickname": "admin", "adjustment_date": review_req["adjustmentDate"], "create_adjustment": "Yes"}
    # today's rows: every Out within the bin's unrestricted stock (the review build's own check), batch lines carry a batch
    items = st.items()
    nb = {key(r["material_id"], r["location_id"], None): r for r in st.balances()}
    bb = {key(r["material_id"], r["location_id"], r["batch_id"]): r for r in st.balances(batch=True)}
    problems = []
    entries_by_group, order = {}, []
    fifo, wa = st.cost_rows({l["material_id"] for l in lines})
    for ln in rv["table_stock_count"]:
        v = S.num(ln["adjusted_qty"])
        if v == 0:
            continue
        it = items.get(ln["material_id"])
        if not it:
            problems.append(f"line {ln['line_index']}: item {ln['material_id']} not FIFO / WA / stock-controlled")
            continue
        batch = ln.get("batch_id") or None
        if int(it["item_batch_management"] or 0) == 1 and not batch:
            problems.append(f"line {ln['line_index']}: batch-managed item without batch")
            continue
        bal = (bb if batch else nb).get(key(ln["material_id"], ln["location_id"], batch))
        if v < 0 and (not bal or S.num(bal["unrestricted_qty"]) < -v):
            problems.append(f"line {ln['line_index']}: Out {-v} > unrestricted {S.num((bal or {}).get('unrestricted_qty'))}")
            continue
        mt = "In" if v > 0 else "Out"
        price = 0
        if mt == "In":
            if it["material_costing_method"] == S.WA:
                w = sorted([r for r in wa if r["material_id"] == ln["material_id"] and r["batch_id"] in ("0", "")], key=lambda r: r["created_at"] or "", reverse=True)
                price = S.clean(w[0]["wa_cost_price"]) if w and S.num(w[0]["wa_cost_price"]) > 0 else S.clean(it["purchase_unit_price"])
            else:
                f = sorted([r for r in fifo if r["material_id"] == ln["material_id"]], key=lambda r: int(S.num(r["fifo_sequence"])), reverse=True)
                price = S.clean(f[0]["fifo_cost_price"]) if f and S.num(f[0]["fifo_cost_price"]) > 0 else S.clean(it["purchase_unit_price"])
        e = S.entry_of(bal, mt, abs(v), batch=bool(batch)) if bal else {"balance_id": None, "material_id": ln["material_id"], "plant_id": st.plant, "location_id": ln["location_id"],
                                                                         "batch_id": batch, "balance_quantity": 0, "unrestricted_qty": 0, "block_qty": 0, "qualityinsp_qty": 0,
                                                                         "reserved_qty": 0, "intransit_qty": 0, "organization_id": st.org, "is_deleted": 0,
                                                                         "category": "Unrestricted", "movement_type": mt, "sa_quantity": abs(v)}
        g = f"{ln['material_id']}|{st.plant}|{mt}|{price if mt == 'In' else ''}"
        if g not in entries_by_group:
            entries_by_group[g] = {"material_id": ln["material_id"], "uom_id": ln["base_uom_id"], "unit_price": price, "entries": []}
            order.append(g)
        entries_by_group[g]["entries"].append(e)
    # the review build's SA lines (grouped by material | plant | movement | price), split at <= 50 entries for V2
    sa_lines = []
    for g in order:
        grp = entries_by_group[g]
        for i in range(0, len(grp["entries"]), 50):
            sa_lines.append({"material_id": grp["material_id"], "uom_id": grp["uom_id"], "unit_price": grp["unit_price"],
                             "balance_index": json.dumps(grp["entries"][i:i + 50], separators=(",", ":"))})
    used = {l["material_id"] for l in sa_lines}
    eng = {"saDoc": {"stock_adjustment": sa_lines}, "hdr": {"plant_id": st.plant, "organization_id": st.org, "adjustment_no": "SA/REVIEW-2K-TEST",
                                                            "adjustment_date": review_req["adjustmentDate"] + " 00:00:00"},
           "items": [items[m] for m in sorted(used) if m in items], "itemBalances": [r for r in nb.values() if r["material_id"] in used],
           "batchBalances": [r for r in bb.values() if r["material_id"] in used], "fifoLayers": [r for r in fifo if r["material_id"] in used],
           "waRows": [r for r in wa if r["material_id"] in used], "precision": st.precision()}
    names = [n.replace(".json", sfx + ".json") for n in ("sc_count.json", "sc_review.json", "sa_v2_submit_review.json", "review_engine_input.json")]
    sizes = {n: S.write_json(os.path.join(out, n), o) for n, o in zip(names, (count_req, review_req, v2, eng))}
    n_out = sum(S.num(l["adjusted_qty"]) < 0 for l in rv["table_stock_count"])
    print(f"SC {sc_id} ({hdr.get('stock_count_no')}, stored {hdr.get('stock_count_status')} / {hdr.get('review_status')}): {len(lines)} stored lines, "
          f"{len(plan)} planned; review: Out {n_out}, In {len(lines) - n_out}; the build would make {len(sa_lines)} SA lines (<= 50 entries each), "
          f"{sum(len(json.loads(l['balance_index'])) for l in sa_lines)} entries")
    print(f"  feasibility today: {len(problems)} problem(s)" + (": " + "; ".join(problems[:5]) if problems else ""))
    for f, b in sizes.items():
        print(f"  {os.path.join(out, f)}  {b / 1e6:.2f} MB")
    print("  engine plan of the review's SA (live/plan_check.js, today's rows): " + S.plan_check(os.path.join(out, names[3])).replace("\n", "\n  "))
    print("  order (WRITES, user's yes): sc_count.json via STOCK_COUNT (Stock Count / Edit), then sc_review.json (classic; <= 500 lines) or sa_v2_submit_review.json (V2)")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("issue", "review"):
        raise SystemExit(__doc__)
    st = S.Stock(arg("--tenant", "496474"), arg("--org", "1901545950162329602"), arg("--plant", "1942795438353035266"))
    out = S.out_dir(arg("--out", DEFAULT_OUT))
    (issue if sys.argv[1] == "issue" else review)(st, out)


if __name__ == "__main__":
    main()
