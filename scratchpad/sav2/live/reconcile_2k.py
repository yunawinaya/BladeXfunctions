"""RUNBOOK step K - reconcile a 2k SC Review V2 run, read-only (SELECTs through .dbtools/db --dev only).

  python3 reconcile_2k.py snapshot --sc ID --out FILE      BEFORE the SUBMIT: the SC + lines; item_balance / item_batch_balance /
                                                            FIFO / WA rows of the SC's materials at the plant; the tenant's max
                                                            inventory_movement id; the clock
  python3 reconcile_2k.py check --sc ID --before FILE [--job ID] [--json OUT]
      job       the REVIEW job (key SCR:<org>:<sc>:...): COMPLETED, no error; steps A0 A1 A2 A3 A4 DONE; S / P parts; engine rows under
                SAC|<job> (IBA|DONE, no IBA|REVIEW); no lock held on the SC's materials
      SA        the job's SA: Completed, stock_count_id = the SC, sa_v2_job_id = the job, an issued number; lines <= 50 entries each,
                line_index 1..n, total_quantity = the entries' sum, plant filled; its entries (material, bin, batch, direction, qty)
                = the SC's approved variance lines (adjusted_qty when it differs from variance_qty, as the build reads them)
      SC        every approved line Adjusted; header Completed / Completed / Fully Adjusted
      moves     inventory_movement keyed SAC|<job>|M<n>: one per entry, same (material, bin, batch, direction, base qty) multiset,
                trx_no = the SA number, doc_date = its adjustment_date
      stock     every touched item_balance / item_batch_balance key: balance_quantity after - before = the sum of ALL movements on that
                key in the window (ours + other sessions'); FIFO per (material, batch): available delta = window IN - OUT (unless the
                OUTs exceeded what the layers held), new layers = IN movements; WA per material: quantity delta = IN - OUT (clamped at 0)
      node data su_code_workflow_inst of the SA_V2_SUBMIT / WORKER / PREPARE / COMMIT / INVENTORY_BULK_APPLY runs of the job: status, duration, nodes_data / request / response sizes vs CONTRACT §14 (SUBMIT / PREPARE <= 25 MB, COMMIT <= 20 MB)
Exit 1 on any failed check."""
import datetime, json, os, sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import twinlib as L  # noqa: E402

D = lambda v: Decimal(str(v)) if v not in (None, "") else Decimal(0)  # noqa: E731
EPOCH = 1288834974657
DB_TZ = datetime.timezone(datetime.timedelta(hours=8))


def chunks(xs, n=400):
    xs = list(xs)
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def sc_rows(cfg, sc):
    t = L.digits(cfg["tenant_id"], "tenant")
    h = L.q(f"SELECT CAST(id AS CHAR) id, stock_count_no, stock_count_status, review_status, adjustment_status, CAST(plant_id AS CHAR) plant_id, organization_id "
            f"FROM stock_count WHERE tenant_id = '{t}' AND id = {sc}")
    if not h:
        raise SystemExit(f"no Stock Count {sc}")
    lines = L.q("SELECT CAST(id AS CHAR) id, line_index, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(batch_id AS CHAR) batch_id, "
                "line_status, review_status, is_counted, CAST(system_qty AS CHAR) system_qty, CAST(count_qty AS CHAR) count_qty, CAST(variance_qty AS CHAR) variance_qty, "
                f"CAST(adjusted_qty AS CHAR) adjusted_qty FROM stock_count_h4c9e1cl_sub WHERE tenant_id = '{t}' AND is_deleted = 0 AND stock_count_id = {sc} ORDER BY id")
    return h[0], lines


def stock_rows(cfg, mats, plant):
    t = L.digits(cfg["tenant_id"], "tenant")
    out = {"ib": [], "ibb": [], "fifo": [], "wa": []}
    for part in chunks(sorted(mats)):
        ids = ",".join(L.digits(m, "material") for m in part)
        W = f"tenant_id = '{t}' AND is_deleted = 0 AND plant_id = {plant} AND material_id IN ({ids})"
        out["ib"] += L.q("SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(balance_quantity AS CHAR) bal, "
                         f"CAST(unrestricted_qty AS CHAR) unr FROM item_balance WHERE {W}")
        out["ibb"] += L.q("SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(batch_id AS CHAR) batch_id, "
                          f"CAST(balance_quantity AS CHAR) bal FROM item_batch_balance WHERE {W}")
        out["fifo"] += L.q("SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(COALESCE(batch_id, 0) AS CHAR) batch_id, fifo_sequence, "
                           "CAST(fifo_available_quantity AS CHAR) avail, CAST(fifo_initial_quantity AS CHAR) init, CAST(fifo_cost_price AS CHAR) price "
                           f"FROM fifo_costing_history WHERE {W}")
        out["wa"] += L.q("SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(COALESCE(batch_id, 0) AS CHAR) batch_id, "
                         "CAST(wa_quantity AS CHAR) qty, CAST(wa_cost_price AS CHAR) price FROM wa_costing_method WHERE tenant_id = "
                         f"'{t}' AND is_deleted = 0 AND plant_id = '{plant}' AND material_id IN ({ids})")
    return out


def snapshot(cfg, sc, out):
    hdr, lines = sc_rows(cfg, sc)
    mats = {l["material_id"] for l in lines}
    snap = {"sc": hdr, "scl": lines, "taken_at": L.q("SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s.%f') t")[0]["t"],
            "max_mv_id": str(L.q(f"SELECT CAST(MAX(id) AS CHAR) m FROM inventory_movement WHERE tenant_id = '{L.digits(cfg['tenant_id'], 'tenant')}'")[0]["m"] or "0")}
    snap.update(stock_rows(cfg, mats, hdr["plant_id"]))
    if os.path.abspath(out).startswith(L.REPO + os.sep):
        raise SystemExit("refusing: --out inside the repo")
    with open(out, "w") as fh:
        json.dump(snap, fh)
    print(f"{snap['taken_at']}: SC {hdr['stock_count_no']} ({hdr['stock_count_status']} / {hdr['review_status']}), {len(lines)} lines, {len(mats)} materials; "
          f"ib {len(snap['ib'])}, ibb {len(snap['ibb'])}, fifo {len(snap['fifo'])}, wa {len(snap['wa'])}; max movement id {snap['max_mv_id']} -> {out}")


def to_id(text):
    dt = datetime.datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=DB_TZ)
    return (int(dt.timestamp() * 1000) - EPOCH) << 22


def check(cfg, sc, before, job_arg=None):
    t, org = L.digits(cfg["tenant_id"], "tenant"), L.digits(cfg["organization_id"], "org")
    fails = []

    def ok(cond, text):
        print(("ok    " if cond else "FAIL  ") + text)
        if not cond:
            fails.append(text)

    # ---- job
    if job_arg:
        jobs = L.q(f"SELECT CAST(id AS CHAR) id, job_status, progress_percent, error_code, error_message, attempt_count, correlation_id, line_count, request_payload, "
                   f"LENGTH(prepared_payload) prep_len, queued_at, started_at, finished_at FROM gd_async_job WHERE tenant_id = '{t}' AND id = {L.digits(job_arg, '--job')}")
    else:
        jobs = L.q(f"SELECT CAST(id AS CHAR) id, job_status, progress_percent, error_code, error_message, attempt_count, correlation_id, line_count, request_payload, "
                   f"LENGTH(prepared_payload) prep_len, queued_at, started_at, finished_at FROM gd_async_job WHERE tenant_id = '{t}' AND command = 'COMPLETE_SA' "
                   f"AND idempotency_key LIKE 'SCR:{org}:{sc}:%' ORDER BY id DESC")
    if not jobs:
        raise SystemExit(f"no COMPLETE_SA job for SC {sc}")
    j = jobs[0]
    jid = j["id"]
    req = json.loads(j["request_payload"] or "{}")
    print(f"job {jid}: {j['job_status']} {j['progress_percent']}% attempts {j['attempt_count']} queued {j['queued_at']} started {j['started_at']} finished {j['finished_at']}"
          f"; request entries {req.get('entryCount')} lines {req.get('lineCount')}; prepared_payload {j['prep_len']} chars")
    ok(j["job_status"] == "COMPLETED" and not j["error_code"], f"job COMPLETED without error ({j['job_status']} {j['error_code'] or ''} {(j['error_message'] or '')[:200]})")
    steps = L.q(f"SELECT job_id, step_name, step_status, LENGTH(result_ref) n FROM gd_publish_step WHERE tenant_id = '{t}' AND is_deleted = 0 AND job_id IN "
                f"('{jid}', 'SAC|{jid}', 'SCR|{sc}') ORDER BY id")
    names = {(s["job_id"], s["step_name"]): s for s in steps}
    for st_ in ("A0_REVALIDATE", "A1_SA_LINES", "A2_INVENTORY", "A3_STOCK_COUNT", "A4_REORDER", "A4_FINISH"):
        ok(names.get((jid, st_), {}).get("step_status") == "DONE", f"step {st_} DONE")
    sp = [s for s in steps if s["job_id"] == jid and s["step_name"].startswith("S|")]
    pp = [s for s in steps if s["job_id"] == jid and s["step_name"].startswith("P|")]
    claims = [s for s in steps if s["job_id"] == jid and s["step_name"].startswith("W0_CLAIM_")]
    eng = [s for s in steps if s["job_id"] == "SAC|" + jid]
    print(f"      parts: S {len(sp)} ({sum(int(s['n'] or 0) for s in sp) / 1e6:.2f} MB), P {len(pp)} ({sum(int(s['n'] or 0) for s in pp) / 1e6:.2f} MB); worker claims {len(claims)}; "
          f"engine rows {sorted(s['step_name'] for s in eng)[:3]}... ({len(eng)})")
    ok(any(s["step_name"] == "IBA|DONE" for s in eng) and not any(s["step_name"] == "IBA|REVIEW" for s in eng), "engine IBA|DONE, no IBA|REVIEW")
    # ---- SA
    corr = j["correlation_id"] or ""
    sa_id = corr[3:] if corr.startswith("SA|") else ""
    sa = L.q(f"SELECT CAST(id AS CHAR) id, adjustment_no, stock_adjustment_status, CAST(stock_count_id AS CHAR) sc, sa_v2_job_id, CAST(plant_id AS CHAR) plant_id, "
             f"DATE_FORMAT(adjustment_date, '%Y-%m-%d %H:%i:%s') adate, adjustment_type, posted_status FROM stock_adjustment WHERE tenant_id = '{t}' AND id = {L.digits(sa_id or '0', 'sa')}")
    ok(bool(sa), f"the job's SA {sa_id or '(not linked)'} exists")
    if not sa:
        return fails
    sa = sa[0]
    ok(sa["stock_adjustment_status"] == "Completed" and sa["sc"] == str(sc) and str(sa["sa_v2_job_id"]) == jid and sa["adjustment_no"] not in ("", "issued", "draft"),
       f"SA {sa['adjustment_no']} {sa['stock_adjustment_status']}, stock_count_id {sa['sc']}, sa_v2_job_id {sa['sa_v2_job_id']}, type {sa['adjustment_type']}, posted {sa['posted_status']}")
    sal = L.q("SELECT CAST(id AS CHAR) id, line_index, material_id, CAST(uom_id AS CHAR) uom_id, total_quantity, CAST(unit_price AS CHAR) unit_price, "
              f"CAST(plant_id AS CHAR) plant_id, balance_index FROM stock_adjustment_1dknywqh_sub WHERE tenant_id = '{t}' AND is_deleted = 0 AND stock_adjustment_id = {sa['id']} "
              "ORDER BY CAST(line_index AS UNSIGNED), id")
    ents, over50, badtot, badidx = [], 0, 0, 0
    for i, l in enumerate(sal):
        e = json.loads(l["balance_index"] or "[]")
        mv = [x for x in e if D(x.get("sa_quantity")) > 0]
        over50 += len(mv) > 50
        badtot += D(l["total_quantity"]) != sum(D(x["sa_quantity"]) for x in mv)
        badidx += str(l["line_index"]) != str(i + 1) or l["plant_id"] != sa["plant_id"]
        for x in mv:
            ents.append((str(l["material_id"]), str(x["location_id"]), str(x.get("batch_id") or ""), "IN" if str(x["movement_type"]).lower() == "in" else "OUT",
                         str(D(x["sa_quantity"]).normalize())))
    ok(not over50 and not badtot and not badidx, f"SA lines {len(sal)}, entries {len(ents)}: > 50 entries {over50}, total_quantity off {badtot}, line_index / plant off {badidx}")
    # ---- SC (after) vs the approved variances
    hdr, lines = sc_rows(cfg, sc)
    want = []
    for l in lines:
        if l["review_status"] != "Approved":
            continue
        v, a = D(l["variance_qty"]), (D(l["adjusted_qty"]) if l["adjusted_qty"] is not None else None)
        use = a if a is not None and a != v else v
        if use != 0:
            want.append((l["material_id"], l["location_id"], l["batch_id"] or "", "IN" if use > 0 else "OUT", str(abs(use).normalize())))
    ok(sorted(ents) == sorted(want), f"SA entries = the SC's approved variances ({len(ents)} vs {len(want)}; extra {sorted(set(ents) - set(want))[:3]}, missing {sorted(set(want) - set(ents))[:3]})")
    appr = [l for l in lines if l["review_status"] == "Approved"]
    ok(all(l["line_status"] == "Adjusted" for l in appr), f"SC lines Adjusted: {sum(l['line_status'] == 'Adjusted' for l in appr)} / {len(appr)} approved")
    ok((hdr["stock_count_status"], hdr["review_status"], hdr["adjustment_status"]) == ("Completed", "Completed", "Fully Adjusted"),
       f"SC header {hdr['stock_count_status']} / {hdr['review_status']} / {hdr['adjustment_status']}")
    # ---- movements: ours (keyed) and the window's (all writers)
    mats = {l["material_id"] for l in lines}
    win = []
    for part in chunks(sorted(mats)):
        win += L.q("SELECT CAST(id AS CHAR) id, operation_effect_key k, trx_no, movement, CAST(item_id AS CHAR) item_id, CAST(bin_location_id AS CHAR) bin, "
                   "CAST(batch_number_id AS CHAR) batch, CAST(base_qty AS CHAR) base_qty, CAST(quantity AS CHAR) qty, CAST(unit_price AS CHAR) unit_price, "
                   f"DATE_FORMAT(doc_date, '%Y-%m-%d %H:%i:%s') doc_date, transaction_type FROM inventory_movement WHERE tenant_id = '{t}' AND is_deleted = 0 "
                   f"AND id > {L.digits(before['max_mv_id'], 'max_mv_id')} AND plant_id = {hdr['plant_id']} AND item_id IN ({','.join(part)})")
    ours = [m for m in win if str(m["k"] or "").startswith(f"SAC|{jid}|M")]
    foreign = [m for m in win if m not in ours]
    got = sorted((m["item_id"], m["bin"], m["batch"] or "", m["movement"], str(D(m["base_qty"]).normalize())) for m in ours)
    ok(got == sorted(ents), f"movements keyed SAC|{jid}|M<n>: {len(ours)} = the SA entries ({len(ents)})")
    ok(all(m["trx_no"] == sa["adjustment_no"] and m["transaction_type"] == "SA" and m["doc_date"] == sa["adate"] for m in ours),
       f"movements carry trx_no {sa['adjustment_no']}, type SA, doc_date {sa['adate']}")
    print(f"      window: {len(win)} movements on the SC's materials since the snapshot, {len(foreign)} by other writers"
          + (f" (e.g. {sorted({m['trx_no'] for m in foreign})[:4]})" if foreign else ""))
    # ---- stock vs ALL window movements
    after = stock_rows(cfg, mats, hdr["plant_id"])
    sgn = lambda m: 1 if m["movement"] == "IN" else -1  # noqa: E731
    exp_ib, exp_bb = {}, {}
    for m in win:
        k = (m["item_id"], m["bin"])
        exp_ib[k] = exp_ib.get(k, Decimal(0)) + sgn(m) * D(m["base_qty"])
        if m["batch"]:
            kb = (m["item_id"], m["bin"], m["batch"])
            exp_bb[kb] = exp_bb.get(kb, Decimal(0)) + sgn(m) * D(m["base_qty"])
    for name, rows_b, rows_a, exp, keyf in (("item_balance", before["ib"], after["ib"], exp_ib, lambda r: (r["material_id"], r["location_id"])),
                                            ("item_batch_balance", before["ibb"], after["ibb"], exp_bb, lambda r: (r["material_id"], r["location_id"], r["batch_id"]))):
        b = {}
        for r in rows_b:
            b[keyf(r)] = b.get(keyf(r), Decimal(0)) + D(r["bal"])
        a = {}
        for r in rows_a:
            a[keyf(r)] = a.get(keyf(r), Decimal(0)) + D(r["bal"])
        bad = [(k, a.get(k, Decimal(0)) - b.get(k, Decimal(0)), d) for k, d in exp.items() if a.get(k, Decimal(0)) - b.get(k, Decimal(0)) != d]
        moved_without = [k for k in set(a) | set(b) if a.get(k, Decimal(0)) != b.get(k, Decimal(0)) and k not in exp]
        ok(not bad and not moved_without, f"{name}: {len(exp)} touched keys moved exactly by their movements ({len(bad)} off, {len(moved_without)} moved without one)"
           + (f" e.g. {bad[:2]} {moved_without[:2]}" if bad or moved_without else ""))
    # FIFO / WA per cost key over the window
    fifo_b, fifo_a = {r["id"]: r for r in before["fifo"]}, {r["id"]: r for r in after["fifo"]}
    items = {}
    for part in chunks(sorted(mats)):
        for r in L.q(f"SELECT CAST(id AS CHAR) id, material_costing_method m FROM item WHERE tenant_id = '{t}' AND id IN ({','.join(part)})"):
            items[r["id"]] = r["m"]
    io = {}
    for m in win:
        k = (m["item_id"], m["batch"] or "0")
        x = io.setdefault(k, {"in": Decimal(0), "out": Decimal(0), "n_in": 0})
        if m["movement"] == "IN":
            x["in"] += D(m["base_qty"])
            x["n_in"] += 1
        else:
            x["out"] += D(m["base_qty"])
    fifo_bad, wa_bad = [], []
    for (mat, batch), x in io.items():
        if items.get(mat) == L.FIFO:
            held = sum(D(r["avail"]) for r in fifo_b.values() if r["material_id"] == mat and r["batch_id"] == batch)
            d = sum(D(r["avail"]) for r in fifo_a.values() if r["material_id"] == mat and r["batch_id"] == batch) - held
            new = [r for i, r in fifo_a.items() if i not in fifo_b and r["material_id"] == mat and r["batch_id"] == batch]
            if x["out"] > held + x["in"]:
                continue  # shortfall: the engine consumes what exists - inconclusive by design
            if d != x["in"] - x["out"] or len(new) != x["n_in"]:
                fifo_bad.append((mat, batch, str(d), str(x["in"] - x["out"]), len(new), x["n_in"]))
        elif items.get(mat) == L.WA:
            qb = sum(D(r["qty"]) for r in before["wa"] if r["material_id"] == mat and r["batch_id"] == batch)
            qa = sum(D(r["qty"]) for r in after["wa"] if r["material_id"] == mat and r["batch_id"] == batch)
            if qa - qb != max(Decimal(0), qb + x["in"] - x["out"]) - qb:
                wa_bad.append((mat, batch, str(qa - qb), str(x["in"] - x["out"])))
    ok(not fifo_bad, f"FIFO: {sum(1 for k in io if items.get(k[0]) == L.FIFO)} cost keys - available delta = IN - OUT, new layers = IN movements"
       + (f"; off: {fifo_bad[:3]}" if fifo_bad else ""))
    ok(not wa_bad, f"WA: {sum(1 for k in io if items.get(k[0]) == L.WA)} cost keys - quantity delta = IN - OUT" + (f"; off: {wa_bad[:3]}" if wa_bad else ""))
    held = []
    for part in chunks(sorted(mats), 200):
        like = " OR ".join(f"lock_key LIKE '%|{m}|%'" for m in part)
        held += L.q(f"SELECT lock_key, owner_operation_id FROM inventory_balance_lock WHERE tenant_id = '{t}' AND organization_id = '{org}' AND is_deleted = 0 "
                    f"AND (free_token IS NULL OR free_token <> 1) AND ({like})")
    ok(not held, f"no engine lock held on the SC's materials ({len(held)})" + (f" e.g. {[h['lock_key'] for h in held[:3]]}" if held else ""))
    # ---- node data per run
    wf = cfg["workflows"]
    lo = to_id(before["taken_at"]) - (60000 << 22)
    # sub-workflow calls get their own rows (as the GD / GR / Putaway V2 engine calls do); REORDER_SET_REDIS's request names no job
    # (its A4_REORDER marker step is checked above)
    names_by = {wf[k]: k for k in ("SA_V2_SUBMIT", "SA_V2_WORKER", "SA_V2_PREPARE", "SA_V2_COMMIT", "INVENTORY_BULK_APPLY")}
    runs = []
    for wid, name in names_by.items():
        pat = f"%{sc}%" if name == "SA_V2_SUBMIT" else f"%{jid}%"
        runs += L.q(f"SELECT CAST(id AS CHAR) id, '{name}' wf, status, current_node_id, start_date, end_date, LENGTH(nodes_data) nd, LENGTH(request_json_data) rq, "
                    f"LENGTH(response_json_data) rs, LEFT(response_json_data, 400) head FROM su_code_workflow_inst WHERE workflow_id = {wid} AND id > {lo} "
                    f"AND tenant_id = '{t}' AND request_json_data LIKE '{pat}' ORDER BY id")
    budget = {"SA_V2_SUBMIT": 25e6, "SA_V2_PREPARE": 25e6, "SA_V2_COMMIT": 20e6}
    print("      node data per run (MB: nodes_data / request / response; seconds):")
    over = []
    for r in sorted(runs, key=lambda r: int(r["id"])):
        try:
            secs = (int(r["end_date"]) - int(r["start_date"])) / 1000
        except (TypeError, ValueError):
            secs = -1
        path = ""
        if r["wf"] == "SA_V2_COMMIT" and r["head"]:
            for p in ("PARK", "SPLIT", "DONE", "WAIT"):
                if f'"path":"{p}' in r["head"].replace(" ", ""):
                    path = p
        print(f"        {r['wf']:21s} {r['id']} {r['status']:8s} exit {str(r['current_node_id'])[:28]:28s} {int(r['nd'] or 0) / 1e6:7.2f} / {int(r['rq'] or 0) / 1e6:6.2f} / "
              f"{int(r['rs'] or 0) / 1e6:6.2f}  {secs:7.1f}s {path}")
        if r["wf"] in budget and int(r["nd"] or 0) > budget[r["wf"]]:
            over.append((r["wf"], r["id"], int(r["nd"]) / 1e6))
    ok(not over, "node data within CONTRACT §14 budgets (SUBMIT / PREPARE <= 25 MB, COMMIT <= 20 MB)" + (f": over {over}" if over else ""))
    ok(not [r for r in runs if r["status"] not in ("Complete",) and r["wf"] != "INVENTORY_BULK_APPLY"], "every V2 run Complete (a failed platform run = a crash)")
    return fails


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("snapshot", "check"):
        raise SystemExit(__doc__)
    cfg = L.load_config()
    sc = L.digits(L.arg("--sc"), "--sc")
    if sys.argv[1] == "snapshot":
        snapshot(cfg, sc, L.arg("--out") or os.path.join(L.out_dir(cfg, "k2"), f"before_{sc}.json"))
        return
    bf = L.arg("--before") or os.path.join(L.out_dir(cfg, "k2"), f"before_{sc}.json")
    with open(bf) as fh:
        before = json.load(fh)
    fails = check(cfg, sc, before, L.arg("--job"))
    print("RECONCILED" if not fails else f"{len(fails)} CHECK(S) FAILED")
    if L.arg("--json"):
        L.write_json(L.arg("--json"), {"fails": fails})
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
