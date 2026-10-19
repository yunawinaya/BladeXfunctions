"""RUNBOOK steps 0b-0d - the SAV2T test items' ids and stock (copy of race/seed_plan.py's approach). Nothing here writes to a
database: --fill-ids writes only the local live/config.json; the request bodies go to <out_dir>/seed/.

  python3 seed.py --fill-ids        read-only SELECT by material_code (+ the batch by number) -> live/config.json ids
  python3 seed.py --plan            print + save the two seed requests (step 0c: classic ADD_INVENTORY creating batch SAV2T-B1;
                                    step 0d: ONE INVENTORY_BULK_APPLY APPLY SAV2T|SEED|1 seeding every other row)
  python3 seed.py --check [--seeded]  read-only: bins, items (method / batch / stock control / base UOM / BOX row), current stock,
                                    cost rows, locks, SAV2T step rows; --seeded also asserts the exact post-seed state
Seed (qty 100 per bin, prices per bin [b1, b2]): FIFO 1 / 2 -> layers seq 1 @1, seq 2 @2; WA 10 / 20 -> ONE row 200 @ 15;
FIFOB batch SAV2T-B1: classic ADD 100 @ 3 in b1 (creates the batch; the engine refuses new batches), APPLY 100 @ 4 in b2 ->
batch layers 1 @3, 2 @4; ALT 5 / 6 (PCS) -> layers 1 @5, 2 @6."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import twinlib as L  # noqa: E402


def movement(cfg, key, mat, bin_key, price, batch_id=None):
    sd = cfg["seed"]
    return {"movement_key": key, "direction": "ADD", "plant_id": cfg["plant_id"], "organization_id": cfg["organization_id"], "material_id": mat,
            "quantity": sd["qty"], "material_uom": cfg["uom"]["PCS"], "transaction_type": "SA", "trx_no": sd["trx_no"], "inventory_category": "Unrestricted",
            "location_id": cfg["bins"][bin_key], "batch_id": batch_id, "manufacturing_date": None, "expired_date": None, "doc_date": sd["doc_date"],
            "isMovingInv": 0, "unit_price": price, "remark": None, "remark2": None, "remark3": None}


def requests(cfg):
    it, sd, P = cfg["items"], cfg["seed"], cfg["seed"]["prices"]
    fb = it["fifob"]
    step1 = {"plant_id": cfg["plant_id"], "organization_id": cfg["organization_id"], "material_id": fb["id"] or "<SAV2T-FIFOB id>", "quantity": sd["qty"],
             "material_uom": cfg["uom"]["PCS"], "transaction_type": "SA", "trx_no": sd["trx_no"], "inventory_category": "Unrestricted",
             "location_id": cfg["bins"]["b1"], "batch_number": fb["batch_number"], "manufacturing_date": None, "expired_date": None,
             "doc_date": sd["doc_date"], "isMovingInv": 0, "unit_price": P["fifob"][0], "remark": None, "remark2": None, "remark3": None}
    mv = [movement(cfg, "S1", it["fifo"]["id"], "b1", P["fifo"][0]), movement(cfg, "S2", it["fifo"]["id"], "b2", P["fifo"][1]),
          movement(cfg, "S3", it["wa"]["id"], "b1", P["wa"][0]), movement(cfg, "S4", it["wa"]["id"], "b2", P["wa"][1]),
          movement(cfg, "S5", fb["id"], "b2", P["fifob"][1], batch_id=fb.get("batch_id") or None),
          movement(cfg, "S6", it["alt"]["id"], "b1", P["alt"][0]), movement(cfg, "S7", it["alt"]["id"], "b2", P["alt"][1])]
    step2 = {"operation_key": sd["op_key"], "mode": "APPLY", "organization_id": cfg["organization_id"], "movements": mv}
    return step1, step2


def plan(cfg):
    s1, s2 = requests(cfg)
    out = L.out_dir(cfg, "seed")
    ident, wf = cfg["identity"], cfg["workflows"]
    sd = cfg["seed"]
    fb = cfg["items"]["fifob"]
    missing = [k for k, m in L.items_of(cfg, need_ids=False).items() if not m.get("id")]
    if missing:
        print("!! item ids missing (" + ", ".join(missing) + "): run step 0a, then seed.py --fill-ids; the requests below carry placeholders")
    p1 = L.write_json(os.path.join(out, "seed1_add_batch.json"), s1)
    print(f"STEP 0c - WRITE classic ADD_INVENTORY {wf['ADD_INVENTORY']} (ONE call): batch {fb['batch_number']} of {fb['code']}, {sd['qty']} in b1 @ {sd['prices']['fifob'][0]}")
    print(f"  node scratchpad/gdc/tools/runas.mjs {ident} {wf['ADD_INVENTORY']} {p1} {p1[:-5]}.out.json")
    print("  writes: batch 1 (SAV2T-B1, initial 100); item_batch_balance 1 (b1); item_balance 1 (b1); fifo_costing_history 1 (batch, seq 1, 100 @ 3);"
          f" inventory_movement 1 (IN, trx_no {sd['trx_no']}, operation_effect_key NULL)")
    print("  then: python3 scratchpad/sav2/live/seed.py --fill-ids   (fills items.fifob.batch_id), then re-run --plan for step 0d")
    if not fb.get("batch_id"):
        print("\n!! items.fifob.batch_id is empty: step 0d's S5 has batch_id null - do NOT run 0d before --fill-ids found the batch")
    p2 = L.write_json(os.path.join(out, "seed2_apply.json"), s2)
    print(f"\nSTEP 0d - WRITE INVENTORY_BULK_APPLY {wf['INVENTORY_BULK_APPLY']} APPLY (ONE call, operation_key {sd['op_key']}): {len(s2['movements'])} ADD movements")
    print(f"  node scratchpad/gdc/tools/runas.mjs {ident} {wf['INVENTORY_BULK_APPLY']} {p2} {p2[:-5]}.out.json")
    for m in s2["movements"]:
        print(f"    {m['movement_key']}  ADD {m['quantity']}  material {m['material_id']}  bin {m['location_id']}  batch {m['batch_id'] or '-'}  @ {m['unit_price']}")
    print("  writes: item_balance 7 new (FIFO b1 b2, WA b1 b2, FIFOB b2, ALT b1 b2); item_batch_balance 1 new (FIFOB b2); fifo_costing_history 5 new"
          " (FIFO 1 @1 / 2 @2, FIFOB batch 2 @4, ALT 1 @5 / 2 @6); wa_costing_method 1 new (WA 200 @ 15: S3 creates, S4 re-averages in the plan);"
          f" inventory_movement 7 (operation_effect_key {sd['op_key']}|S1..S7); inventory_balance_lock rows ITEM| x7 + BATCH| x1 + COST| x4 (seeded, released);"
          f" gd_publish_step IBA|I|001 + IBA|DONE under job_id {sd['op_key']}")
    print("  expected answer: code 200, result_code OK, 'Applied 7 movements', summary item_balance 7 / item_batch_balance 1 / fifo 5 / wa 1")
    print("\nSTEP 0e - read-only: python3 scratchpad/sav2/live/seed.py --check --seeded   (asserts the exact post-seed rows)")


def fill_ids(cfg):
    t, org = L.digits(cfg["tenant_id"], "tenant"), L.digits(cfg["organization_id"], "org")
    items = L.items_of(cfg, need_ids=False)
    codes = ",".join("'" + m["code"].replace("'", "") + "'" for m in items.values())
    rows = L.q(f"SELECT CAST(id AS CHAR) id, material_code FROM item WHERE tenant_id='{t}' AND organization_id='{org}' AND is_deleted=0 AND material_code IN ({codes})")
    found = {}
    for r in rows:
        found.setdefault(r["material_code"], []).append(r["id"])
    bad = 0
    for k, m in items.items():
        ids = found.get(m["code"], [])
        if len(ids) != 1:
            print(f"{m['code']}: {len(ids)} live item(s) - not filled")
            bad += 1
            continue
        m["id"] = ids[0]
        print(f"items.{k}.id = {ids[0]} ({m['code']})")
    fb = items["fifob"]
    if fb.get("id"):
        b = L.q(f"SELECT CAST(id AS CHAR) id FROM batch WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={L.digits(fb['id'], 'fifob id')} "
                f"AND batch_number='{fb['batch_number'].replace(chr(39), '')}'")
        if len(b) == 1:
            fb["batch_id"] = b[0]["id"]
            print(f"items.fifob.batch_id = {b[0]['id']} ({fb['batch_number']})")
        else:
            print(f"batch {fb['batch_number']}: {len(b)} row(s) - batch_id left as is (step 0c creates it)")
    if bad == len(items):
        print("no test item exists yet (step 0a): live/config.json not written")
        return 1
    path = cfg.pop("_path")
    with open(path, "w") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"wrote {os.path.relpath(path, L.REPO)}" + (f" ({bad} item(s) missing)" if bad else ""))
    return 1 if bad else 0


def check(cfg, seeded=False):
    t, org, plant = L.digits(cfg["tenant_id"], "tenant"), L.digits(cfg["organization_id"], "org"), L.digits(cfg["plant_id"], "plant")
    bad = 0

    def say(ok, text):
        nonlocal bad
        bad += 0 if ok else 1
        print(("ok    " if ok else "FAIL  ") + text)

    bins = {k: L.digits(v, "bins." + k) for k, v in cfg["bins"].items() if not k.startswith("_")}
    rows = {r["id"]: r for r in L.q(f"SELECT CAST(id AS CHAR) id, bin_location_combine, bin_status, CAST(plant_id AS CHAR) plant_id, organization_id FROM bin_location "
                                     f"WHERE tenant_id='{t}' AND is_deleted=0 AND id IN ({','.join(bins.values())})")}
    for k, b in bins.items():
        r = rows.get(b)
        say(bool(r) and r["plant_id"] == plant and r["organization_id"] == org and str(r["bin_status"]) == "1", f"bin {k} {b}: " + (r["bin_location_combine"] if r else "missing"))
        others = L.q(f"SELECT COUNT(*) n, MAX(create_time) t FROM inventory_movement WHERE tenant_id='{t}' AND bin_location_id={b} AND create_time > NOW() - INTERVAL 6 HOUR "
                     f"AND COALESCE(trx_no, '') NOT LIKE 'SAV2T%' AND (operation_effect_key IS NULL OR operation_effect_key NOT LIKE 'SAV2T|%')")
        mats = ",".join(m["id"] for m in L.items_of(cfg, need_ids=False).values() if m.get("id")) or "0"
        foreign = L.q(f"SELECT COUNT(*) n FROM inventory_movement WHERE tenant_id='{t}' AND bin_location_id={b} AND create_time > NOW() - INTERVAL 6 HOUR AND item_id NOT IN ({mats})")
        print(f"      movements on {k} in the last 6 h: {others[0]['n']} not ours by number, {foreign[0]['n']} of other materials"
              + (f" (latest {others[0]['t']})" if others[0]["n"] else ""))
    pcs = cfg["uom"]["PCS"]
    expect = {"fifo": {}, "wa": {}, "fifob": {}, "alt": {}}
    P, qty = cfg["seed"]["prices"], cfg["seed"]["qty"]
    for k, m in L.items_of(cfg, need_ids=False).items():
        if not m.get("id"):
            say(False, f"items.{k}.id empty - step 0a + --fill-ids ({m['code']})")
            continue
        mid = L.digits(m["id"], f"items.{k}.id")
        it = L.q(f"SELECT CAST(id AS CHAR) id, material_code, material_costing_method, item_batch_management, stock_control, CAST(based_uom AS CHAR) based_uom, "
                 f"organization_id, serial_number_management FROM item WHERE tenant_id='{t}' AND is_deleted=0 AND id={mid}")
        if not it:
            say(False, f"items.{k} {mid}: no such item")
            continue
        it = it[0]
        conv = L.q(f"SELECT CAST(alt_uom_id AS CHAR) alt, CAST(base_uom_id AS CHAR) base, CAST(base_qty AS CHAR) bq, purchase_default_uom pd, sales_default_uom sd "
                   f"FROM item_mji552rc_sub WHERE tenant_id='{t}' AND is_deleted=0 AND item_id={mid}")
        want_conv = 2 if m.get("alt") else 1
        alt_ok = True
        if m.get("alt"):
            alt_ok = any(c["alt"] == cfg["uom"][m["alt"]["uom"]] and c["base"] == pcs and float(c["bq"]) == m["alt"]["base_qty"] for c in conv)
        say(it["material_costing_method"] == m["method"] and int(it["item_batch_management"] or 0) == int(m["batch"]) and int(it["stock_control"] or 0) == 1
            and int(it["serial_number_management"] or 0) == 0 and it["based_uom"] == pcs and it["organization_id"] == org and len(conv) == want_conv and alt_ok,
            f"item {k} {mid} {it['material_code']}: {it['material_costing_method']}, batch {it['item_batch_management']}, base uom {it['based_uom']}, UOM rows {len(conv)}")
        ib = L.q(f"SELECT CAST(location_id AS CHAR) loc, CAST(unrestricted_qty AS DECIMAL(20,3)) unr, CAST(balance_quantity AS DECIMAL(20,3)) bal FROM item_balance "
                 f"WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND plant_id={plant} ORDER BY id")
        ibb = L.q(f"SELECT CAST(location_id AS CHAR) loc, CAST(batch_id AS CHAR) b, CAST(balance_quantity AS DECIMAL(20,3)) bal FROM item_batch_balance "
                  f"WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND plant_id={plant} ORDER BY id")
        fifo = L.q(f"SELECT CAST(COALESCE(batch_id,0) AS CHAR) b, fifo_sequence s, CAST(fifo_available_quantity AS DECIMAL(20,3)) a, CAST(fifo_cost_price AS DECIMAL(20,4)) p "
                   f"FROM fifo_costing_history WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND plant_id={plant} ORDER BY id")
        wa = L.q(f"SELECT CAST(COALESCE(batch_id,0) AS CHAR) b, CAST(wa_quantity AS DECIMAL(20,3)) q, CAST(wa_cost_price AS DECIMAL(20,4)) p FROM wa_costing_method "
                 f"WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND plant_id='{plant}' ORDER BY id")
        print(f"      item_balance {[(r['loc'][-4:], str(r['unr']), str(r['bal'])) for r in ib]}; batch {[(r['loc'][-4:], r['b'][-4:], str(r['bal'])) for r in ibb]}")
        print(f"      fifo {[(r['b'][-4:], r['s'], str(r['a']), str(r['p'])) for r in fifo]}; wa {[(r['b'], str(r['q']), str(r['p'])) for r in wa]}")
        if k == "fifob":
            b = L.q(f"SELECT CAST(id AS CHAR) id FROM batch WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND batch_number='{m['batch_number']}'")
            say(bool(b) and (not m.get("batch_id") or m["batch_id"] == b[0]["id"]), f"batch {m['batch_number']} = {b[0]['id'] if b else 'missing (step 0c)'}"
                + ("" if not b or m.get("batch_id") else "  -> run --fill-ids"))
        locks = L.q(f"SELECT lock_key, free_token, owner_operation_id FROM inventory_balance_lock WHERE tenant_id='{t}' AND organization_id='{org}' "
                    f"AND lock_key LIKE '%|{mid}|%' AND is_deleted=0")
        held = [r for r in locks if str(r["free_token"]) != "1"]
        say(not held, f"      lock rows {len(locks)}, held {[(r['lock_key'], r['owner_operation_id']) for r in held]}")
        if seeded:
            b1, b2 = cfg["bins"]["b1"], cfg["bins"]["b2"]
            pr = P[k]
            got_ib = sorted((r["loc"], float(r["bal"])) for r in ib)
            say(got_ib == sorted([(b1, float(qty)), (b2, float(qty))]), f"      seeded item_balance {k}: {got_ib}")
            got_f = sorted((r["s"], float(r["a"]), float(r["p"])) for r in fifo)
            if m["method"] == L.FIFO:
                say(got_f == [("1", float(qty), float(pr[0])), ("2", float(qty), float(pr[1]))], f"      seeded FIFO layers {k}: {got_f}")
                say(not wa, f"      no WA row for FIFO item {k}")
            else:
                say(len(wa) == 1 and float(wa[0]["q"]) == 2 * qty and float(wa[0]["p"]) == (pr[0] + pr[1]) / 2, f"      seeded WA row: {[(r['q'], r['p']) for r in wa]}")
                say(not fifo, "      no FIFO layer for the WA item")
            if k == "fifob":
                say(sorted((r["loc"], float(r["bal"])) for r in ibb) == sorted([(b1, float(qty)), (b2, float(qty))]), "      seeded batch balances b1 / b2")
    steps = L.q(f"SELECT job_id, step_name, step_status FROM gd_publish_step WHERE tenant_id='{t}' AND job_id LIKE 'SAV2T|%' AND is_deleted=0 ORDER BY id")
    mvn = L.q(f"SELECT COUNT(*) n FROM inventory_movement WHERE tenant_id='{t}' AND (trx_no = '{cfg['seed']['trx_no']}' OR operation_effect_key LIKE 'SAV2T|%')")
    print(f"seed namespace: {len(steps)} SAV2T step rows {sorted({(r['job_id'], r['step_name']) for r in steps})}, {mvn[0]['n']} seed movements")
    if seeded:
        say(mvn[0]["n"] == 8, f"seed movements = 8 (1 classic + 7 engine): {mvn[0]['n']}")
        say(any(r["step_name"] == "IBA|DONE" for r in steps) and not any(r["step_name"] == "IBA|REVIEW" for r in steps), "engine IBA|DONE, no IBA|REVIEW")
    print("ALL CHECKS PASSED" if not bad else f"{bad} CHECK(S) FAILED")
    return 1 if bad else 0


def main():
    cfg = L.load_config()
    if "--fill-ids" in sys.argv:
        sys.exit(fill_ids(cfg))
    if "--check" in sys.argv:
        sys.exit(check(cfg, "--seeded" in sys.argv))
    if "--plan" in sys.argv:
        plan(cfg)
        return
    raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
