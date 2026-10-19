"""SA V2 cost-row race (CONTRACT §15): PRINT what seeding the dedicated test stock takes - the exact calls, their request
bodies and every row each one writes. Nothing is run and nothing is written to any database: the controller runs the
printed commands after the user's yes.

usage:
  python3 seed_plan.py [--config race/config.json] [--out DIR]   print the plan; --out also saves the request bodies there
  python3 seed_plan.py --check [--config race/config.json]       read-only SELECTs on dev: the config against the data,
                                                                 the test items' current stock / cost rows / locks
  python3 seed_plan.py --fill-ids [--config ...]                 read-only SELECT by material_code (+ the batch by number);
                                                                 writes the local race/config.json with the ids
Steps: 0 (user, dev UI) create the four test items -> ids into the config; 1 (controller) ONE classic ADD_INVENTORY that
creates batch SACRACE-B1 of the FIFO batch item (INVENTORY_BULK_APPLY refuses new batches: UNSUPPORTED_NEW_BATCH) -> its
id into the config; 2 (controller) ONE INVENTORY_BULK_APPLY APPLY SACRACE|SEED|1 that seeds every other row; 3 (read-only)
reconcile.py snapshot.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.join(HERE, "..", "parity"))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DIG = set("0123456789")


def load_config():
    path = sys.argv[sys.argv.index("--config") + 1] if "--config" in sys.argv else os.path.join(HERE, "config.json")
    if not os.path.exists(path):
        path = os.path.join(HERE, "config.example.json")
    with open(path) as fh:
        return json.load(fh), path


def digits(v, what):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise SystemExit(f"config: {what} is not an id ({v!r})")
    return v


def movement(cfg, key, direction, mat, bin_key, qty, price=None, batch_id=None, trx=None, doc_date=None):
    m = {
        "movement_key": key, "direction": direction, "plant_id": cfg["plant_id"], "organization_id": cfg["organization_id"],
        "material_id": mat["id"] or "<" + mat["code"] + " id>", "quantity": qty, "material_uom": cfg["uom_id"], "transaction_type": "SA",
        "trx_no": trx or cfg["seed"]["trx_no"], "inventory_category": "Unrestricted", "location_id": cfg["bins"][bin_key], "batch_id": batch_id,
        "manufacturing_date": None, "expired_date": None, "doc_date": doc_date or cfg["seed"]["doc_date"], "isMovingInv": 0,
        "unit_price": price if price is not None else 0,
    }
    if direction == "ADD":
        m.update({"remark": None, "remark2": None, "remark3": None})
    return m


def plan(cfg):
    sd = cfg["seed"]
    M = cfg["materials"]
    q = sd["qty_per_bin"]
    fb = M["fifo_batch"]
    step1 = {
        "plant_id": cfg["plant_id"], "organization_id": cfg["organization_id"], "material_id": fb["id"] or "<SACRACE-FIFOB id>", "quantity": q,
        "material_uom": cfg["uom_id"], "transaction_type": "SA", "trx_no": sd["trx_no"], "inventory_category": "Unrestricted",
        "location_id": cfg["bins"]["bin1"], "batch_number": fb["batch_number"], "manufacturing_date": None, "expired_date": None,
        "doc_date": sd["doc_date"], "isMovingInv": 0, "unit_price": sd["fifo_batch_prices"][0], "remark": None, "remark2": None, "remark3": None,
    }
    mv = [
        movement(cfg, "S1", "ADD", M["fifo"], "bin1", q, sd["fifo_prices"][0]),
        movement(cfg, "S2", "ADD", M["fifo"], "bin2", q, sd["fifo_prices"][1]),
        movement(cfg, "S3", "ADD", M["wa"], "bin1", q, sd["wa_prices"][0]),
        movement(cfg, "S4", "ADD", M["wa"], "bin2", q, sd["wa_prices"][1]),
    ]
    if fb.get("batch_id"):
        mv.append(movement(cfg, "S5", "ADD", fb, "bin2", q, sd["fifo_batch_prices"][1], batch_id=fb["batch_id"]))
    mv += [movement(cfg, "S6", "ADD", M["filler"], "bin1", sd["filler_qty"]), movement(cfg, "S7", "ADD", M["filler"], "bin2", sd["filler_qty"])]
    step2 = {"operation_key": "SACRACE|SEED|1", "mode": "APPLY", "organization_id": cfg["organization_id"], "movements": mv}
    return step1, step2


def show(cfg, cfg_path, out_dir):
    s1, s2 = plan(cfg)
    sd = cfg["seed"]
    M = cfg["materials"]
    q = sd["qty_per_bin"]
    ident = cfg["identity"]
    eng = cfg["workflows"]["INVENTORY_BULK_APPLY"]
    add = cfg["workflows"]["ADD_INVENTORY"]
    d = out_dir or "<DIR>"
    wa_value = q * sd["wa_prices"][0] + q * sd["wa_prices"][1]
    print(f"# SA V2 cost-row race - seed plan (config {os.path.relpath(cfg_path, REPO)}); DEV tenant {cfg['tenant_id']}, org {cfg['organization_id']}, plant {cfg['plant_id']}")
    print("# Nothing below has run. Each WRITE step needs the user's yes; announce the tenant to the other sessions first.\n")
    print("STEP 0 - WRITE (ITEM_SAVE, one call per item; requests from python3 scratchpad/sav2/race/make_item_requests.py) or the dev UI as admin@"
          + cfg["tenant_id"] + ": four items, stock control ON, base UOM = " + cfg["uom_id"] + " (PCS), no other UOM conversion:")
    for k in ("fifo", "wa", "fifo_batch", "filler"):
        m = M[k]
        print(f"  {m['code']:14s} '{m['name']}'  costing {m['method']}, batch management {m['batch_managed']}" + (f"   -> config materials.{k}.id = {m['id']}" if m["id"] else f"   -> put its id in config materials.{k}.id"))
    print("  then: python3 scratchpad/sav2/race/seed_plan.py --fill-ids   (read-only SELECT by material_code -> writes race/config.json), --check\n")
    print(f"STEP 1 - WRITE (classic ADD_INVENTORY {add}, ONE call): batch {M['fifo_batch']['batch_number']} of {M['fifo_batch']['code']}, {q} in bin1 @ {sd['fifo_batch_prices'][0]}")
    print(f"  node scratchpad/gdc/tools/runas.mjs {ident} {add} {d}/seed1_add_batch.json {d}/seed1.out.json")
    print("  writes: batch 1 (batch_number " + M["fifo_batch"]["batch_number"] + ", initial_quantity " + str(q) + "); item_batch_balance 1 (bin1, unrestricted " + str(q) + "); item_balance 1 (bin1);")
    print("          fifo_costing_history 1 (batch layer, sequence 1, cost " + str(sd["fifo_batch_prices"][0]) + "); inventory_movement 1 (IN, trx_no " + sd["trx_no"] + ")")
    print("  request:", json.dumps(s1, ensure_ascii=False))
    print("  then: seed_plan.py --check prints the batch id -> config materials.fifo_batch.batch_id\n")
    print(f"STEP 2 - WRITE (INVENTORY_BULK_APPLY {eng} APPLY, ONE call, operation_key {s2['operation_key']}): {len(s2['movements'])} ADD movements")
    print(f"  node scratchpad/gdc/tools/runas.mjs {ident} {eng} {d}/seed2_apply.json {d}/seed2.out.json")
    if not M["fifo_batch"].get("batch_id"):
        print("  !! materials.fifo_batch.batch_id is empty: S5 (the batch item's bin2 stock) is left out until step 1 has run")
    for m in s2["movements"]:
        print(f"    {m['movement_key']}  ADD {m['quantity']:>6}  material {m['material_id']}  bin {m['location_id']}  batch {m['batch_id'] or '-'}  unit_price {m['unit_price']}")
    print("  writes (expected): item_balance creates: fifo bin1+bin2, wa bin1+bin2, filler bin1+bin2" + (", fifo_batch bin2 (its bin1 row is step 1's)" if M["fifo_batch"].get("batch_id") else ""))
    print("          item_batch_balance: " + ("1 create (fifo_batch bin2)" if M["fifo_batch"].get("batch_id") else "none"))
    print(f"          fifo_costing_history: fifo seq 1 ({q} @ {sd['fifo_prices'][0]}), seq 2 ({q} @ {sd['fifo_prices'][1]})" + (f"; fifo_batch seq 2 ({q} @ {sd['fifo_batch_prices'][1]})" if M["fifo_batch"].get("batch_id") else ""))
    print(f"          wa_costing_method: 1 row for wa (qty {2 * q} @ {wa_value / (2 * q):g}; S3 creates it, S4 re-averages it in the same plan)")
    print(f"          inventory_movement: {len(s2['movements'])} rows, operation_effect_key SACRACE|SEED|1|S<n>; Fixed Cost filler: no cost row")
    print("          inventory_balance_lock: one ITEM|<material>|<bin> row per new key (+ BATCH| for S5), seeded free; gd_publish_step: IBA|I|001 + IBA|DONE under job_id SACRACE|SEED|1")
    print("  request:", json.dumps(s2, ensure_ascii=False)[:1500] + (" ..." if len(json.dumps(s2)) > 1500 else ""))
    print("\nSTEP 3 - read-only: python3 scratchpad/sav2/race/reconcile.py snapshot --config <config> --out " + d + "/seeded.json   (expect the rows above)")
    print("\nEach race run then writes (fire.mjs --live, after the user's yes): R0 = 1 + b_movements inventory_movement rows, 1 FIFO layer update (consumption)")
    print("  per op, the filler's item_balance (B) and the shared item's item_balance in bin1 (A) / bin2 (B); R1 = 2 movements + FIFO layer updates; R2 = 2 movements +")
    print("  WA row updates + item_balance bin1/bin2; R3 = 2 movements + 2 new FIFO layers; every op adds its IBA|I|nnn + IBA|DONE step rows and touches its lock rows.")
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        if os.path.realpath(out_dir).startswith(os.path.realpath(REPO) + os.sep):
            raise SystemExit("refusing: --out is inside the repo (request bodies carry tenant ids)")
        with open(os.path.join(out_dir, "seed1_add_batch.json"), "w") as fh:
            json.dump(s1, fh, indent=1)
        with open(os.path.join(out_dir, "seed2_apply.json"), "w") as fh:
            json.dump(s2, fh, indent=1)
        print(f"\nrequest bodies saved: {out_dir}/seed1_add_batch.json, {out_dir}/seed2_apply.json")


def check(cfg):
    from dbq import q
    t = digits(cfg["tenant_id"], "tenant_id")
    org = digits(cfg["organization_id"], "organization_id")
    plant = digits(cfg["plant_id"], "plant_id")
    bad = 0

    def say(ok, text):
        nonlocal bad
        bad += 0 if ok else 1
        print(("ok    " if ok else "FAIL  ") + text)

    bins = {k: digits(v, "bins." + k) for k, v in cfg["bins"].items() if not k.startswith("_")}
    rows = q("--dev", f"SELECT CAST(id AS CHAR) id, bin_location_combine, bin_status, CAST(plant_id AS CHAR) plant_id, organization_id FROM bin_location WHERE tenant_id='{t}' AND is_deleted=0 AND id IN ({','.join(bins.values())})")
    by = {r["id"]: r for r in rows}
    for k, b in bins.items():
        r = by.get(b)
        say(bool(r) and r["plant_id"] == plant and r["organization_id"] == org and str(r["bin_status"]) == "1", f"bin {k} {b}: {r['bin_location_combine'] + ' plant ' + r['plant_id'] if r else 'missing'}")
    uom = digits(cfg["uom_id"], "uom_id")
    for k, m in cfg["materials"].items():
        if k.startswith("_"):
            continue
        if not m.get("id"):
            say(False, f"materials.{k}.id empty - STEP 0 ({m['code']})")
            continue
        mid = digits(m["id"], f"materials.{k}.id")
        it = q("--dev", f"SELECT CAST(id AS CHAR) id, material_code, material_costing_method, item_batch_management, stock_control, CAST(based_uom AS CHAR) based_uom, organization_id, is_active FROM item WHERE tenant_id='{t}' AND is_deleted=0 AND id={mid}")
        if not it:
            say(False, f"materials.{k} {mid}: no such item in tenant {t}")
            continue
        it = it[0]
        say(it["material_costing_method"] == m["method"] and int(it["item_batch_management"] or 0) == int(m["batch_managed"]) and int(it["stock_control"] or 0) == 1
            and it["based_uom"] == uom and it["organization_id"] == org,
            f"materials.{k} {mid} {it['material_code']}: {it['material_costing_method']}, batch {it['item_batch_management']}, stock_control {it['stock_control']}, base uom {it['based_uom']}")
        ib = q("--dev", f"SELECT CAST(location_id AS CHAR) loc, CAST(unrestricted_qty AS CHAR) unr, CAST(balance_quantity AS CHAR) bal FROM item_balance WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND plant_id={plant}")
        fifo = q("--dev", f"SELECT CAST(COALESCE(batch_id,0) AS CHAR) b, fifo_sequence s, CAST(fifo_available_quantity AS CHAR) a, CAST(fifo_cost_price AS CHAR) p FROM fifo_costing_history WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND plant_id={plant} ORDER BY id")
        wa = q("--dev", f"SELECT CAST(COALESCE(batch_id,0) AS CHAR) b, CAST(wa_quantity AS CHAR) q, CAST(wa_cost_price AS CHAR) p FROM wa_costing_method WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND plant_id={plant} ORDER BY id")
        print(f"      stock: item_balance {[(r['loc'], r['unr'], r['bal']) for r in ib]}; fifo {[(r['b'], r['s'], r['a'], r['p']) for r in fifo][:8]}{' ...' if len(fifo) > 8 else ''}; wa {[(r['b'], r['q'], r['p']) for r in wa]}")
        if k == "fifo_batch":
            b = q("--dev", f"SELECT CAST(id AS CHAR) id, batch_number FROM batch WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={mid} AND batch_number='{m['batch_number'].replace(chr(39), '')}'")
            if b:
                say(not m.get("batch_id") or m["batch_id"] == b[0]["id"], f"batch {m['batch_number']} = {b[0]['id']}" + ("" if m.get("batch_id") else "  -> put it in materials.fifo_batch.batch_id"))
            else:
                say(not m.get("batch_id"), f"batch {m['batch_number']} does not exist yet - STEP 1")
        locks = q("--dev", f"SELECT lock_key, free_token, owner_operation_id FROM inventory_balance_lock WHERE tenant_id='{t}' AND organization_id='{org}' AND lock_key LIKE '%|{mid}|%' AND is_deleted=0")
        held = [r for r in locks if str(r["free_token"]) != "1"]
        say(not held, f"      lock rows {len(locks)}, held {[(r['lock_key'][-30:], r['owner_operation_id']) for r in held]}")
    ops = q("--dev", f"SELECT job_id, step_name, step_status FROM gd_publish_step WHERE tenant_id='{t}' AND job_id LIKE 'SACRACE|%' AND is_deleted=0 ORDER BY id")
    mvn = q("--dev", f"SELECT COUNT(*) n FROM inventory_movement WHERE tenant_id='{t}' AND operation_effect_key LIKE 'SACRACE|%'")
    print(f"namespace: {len(ops)} SACRACE step rows ({sorted({r['job_id'] for r in ops})[:12]}), {mvn[0]['n']} SACRACE movements")
    review = [r for r in ops if r["step_name"] == "IBA|REVIEW"]
    say(not review, f"no SACRACE operation under IBA|REVIEW ({[r['job_id'] for r in review]})")
    print(("ALL CHECKS PASSED" if not bad else f"{bad} CHECK(S) FAILED"))
    return 1 if bad else 0


def fill_ids(cfg):
    """read-only SELECT by material_code (+ the FIFO batch item's batch by batch_number); writes the LOCAL race/config.json"""
    from dbq import q
    t = digits(cfg["tenant_id"], "tenant_id")
    org = digits(cfg["organization_id"], "organization_id")
    mats = {k: m for k, m in cfg["materials"].items() if not k.startswith("_")}
    codes = ",".join("'" + m["code"].replace("'", "") + "'" for m in mats.values())
    rows = q("--dev", f"SELECT CAST(id AS CHAR) id, material_code FROM item WHERE tenant_id='{t}' AND organization_id='{org}' AND is_deleted=0 AND material_code IN ({codes})")
    found = {}
    for r in rows:
        found.setdefault(r["material_code"], []).append(r["id"])
    bad = 0
    for k, m in mats.items():
        ids = found.get(m["code"], [])
        if len(ids) != 1:
            print(f"{m['code']}: {len(ids)} live item(s) - not filled")
            bad += 1
            continue
        m["id"] = ids[0]
        print(f"materials.{k}.id = {ids[0]} ({m['code']})")
    fb = mats.get("fifo_batch")
    if fb and fb.get("id"):
        b = q("--dev", f"SELECT CAST(id AS CHAR) id FROM batch WHERE tenant_id='{t}' AND is_deleted=0 AND material_id={digits(fb['id'], 'fifo_batch id')} "
                       f"AND batch_number='{fb['batch_number'].replace(chr(39), '')}'")
        if len(b) == 1:
            fb["batch_id"] = b[0]["id"]
            print(f"materials.fifo_batch.batch_id = {b[0]['id']} ({fb['batch_number']})")
        else:
            print(f"batch {fb['batch_number']}: {len(b)} row(s) - batch_id left as is (seed STEP 1 creates it)")
    if bad == len(mats):
        print("no test item exists yet (STEP 0): race/config.json not written")
        return 1
    out = os.path.join(HERE, "config.json")
    with open(out, "w") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=1)
    print(f"wrote {os.path.relpath(out, REPO)}" + (f" ({bad} item(s) missing)" if bad else ""))
    return 1 if bad else 0


def main():
    cfg, path = load_config()
    if "--fill-ids" in sys.argv:
        sys.exit(fill_ids(cfg))
    if "--check" in sys.argv:
        sys.exit(check(cfg))
    show(cfg, path, sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None)


if __name__ == "__main__":
    main()
