"""live_test.py: INVENTORY_BULK_APPLY v13 (costing migration) on DEV 000000 after the publish (user's yes 10-30). Engine calls go
through scratchpad/gdc/tools/runwf.mjs (the CLI session, tenant 000000); item method flips through .dbtools/dbw.
- T1 FIFO_TO_WA: ABC-TEA (FIFO, 2 layers, 11 in A1-B1) set to Weighted Average; one APPLY with an OUT 1 / IN 1 pair (isMovingInv 0,
  the IN at the OUT's price): the layers retired, one WA row (11 at their weighted cost, at the tenant rule), 2 movements.
- T2 WA_TO_FIFO: ABC-TEA set back to FIFO; one APPLY with an unpriced category pair (isMovingInv 1): the probe adds COST|item|plant,
  the WA row retired, one FIFO layer (seq 1, 11 at the WA cost), 2 movements, the COST key given back.
- T3 size: one APPLY with 30+ net-zero category pairs (Unrestricted -> Unrestricted, same bin) over 30+ items: probe finds nothing,
  > 25 keys taken and given back, balances unchanged, one movement per key.
- T4 replay: T3 again with the same operation key: the stored answer, no second movement.
usage: python3 live_test.py [T1 T2 T3 T4]"""
import json
import os
import subprocess
import sys
import time

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
HERE = os.path.dirname(os.path.abspath(__file__))
IBA = "2109916822821744641"
TENANT, ORG, PLANT = "000000", "1123598813738675201", "1123598813738675202"
ITEM, BIN = "2064994465761263617", "2018912822846582786"
STAMP = time.strftime("%m%d%H%M%S")


def q(sql):
    out = subprocess.run([R + ".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True, cwd=R)
    if out.returncode:
        raise SystemExit("db: " + out.stderr.strip()[-300:])
    return json.loads(out.stdout[out.stdout.find("["):])


def dbw(sql):
    out = subprocess.run([R + ".dbtools/dbw", sql, "--execute"], capture_output=True, text=True, cwd=R)
    print("  dbw:", (out.stdout.strip().splitlines() or ["?"])[-1])


def apply(name, op, movements):
    req, res = os.path.join(HERE, name + ".req.json"), os.path.join(HERE, name + ".out.json")
    json.dump({"operation_key": op, "mode": "APPLY", "organization_id": ORG, "movements": movements}, open(req, "w"))
    t0 = time.time()
    subprocess.run(["node", R + "scratchpad/gdc/tools/runwf.mjs", IBA, req, res], capture_output=True, text=True, cwd=R)
    d = (json.load(open(res)).get("data") or {})
    print(f"  {name}: {time.time() - t0:.1f} s, code {d.get('code')} {d.get('result_code')} | {str(d.get('message'))[:140]}")
    return d


def mv(key, direction, qty, mat, moving, extra=None):
    m = {"movement_key": key, "direction": direction, "material_id": mat, "plant_id": PLANT, "organization_id": ORG, "location_id": BIN,
         "quantity": qty, "inventory_category": "Unrestricted", "transaction_type": "LOT", "trx_no": "IBATEST-" + STAMP,
         "doc_date": time.strftime("%Y-%m-%d"), "isMovingInv": moving}
    m.update(extra or {})
    return m


def costing(mat):
    return {
        "fifo": q(f"SELECT CAST(id AS CHAR) id, fifo_sequence seq, fifo_available_quantity avail, fifo_initial_quantity init, fifo_cost_price cost, is_deleted del FROM fifo_costing_history WHERE material_id = {mat} AND tenant_id = '{TENANT}' ORDER BY id"),
        "wa": q(f"SELECT CAST(id AS CHAR) id, wa_quantity qty, wa_cost_price cost, is_deleted del FROM wa_costing_method WHERE material_id = {mat} AND tenant_id = '{TENANT}' ORDER BY id"),
    }


def after_op(op, want_moves):
    mvn = q(f"SELECT COUNT(*) n FROM inventory_movement WHERE tenant_id = '{TENANT}' AND operation_effect_key LIKE '{op}|%' AND is_deleted = 0")[0]["n"]
    held = q(f"SELECT COUNT(*) n FROM inventory_balance_lock WHERE tenant_id = '{TENANT}' AND owner_operation_id = '{op}'")[0]["n"]
    steps = [r["step_name"] for r in q(f"SELECT step_name FROM gd_publish_step WHERE tenant_id = '{TENANT}' AND job_id = '{op}' AND is_deleted = 0 ORDER BY id")]
    ok = int(mvn) == want_moves and int(held) == 0 and "IBA|DONE" in steps
    print(f"  movements {mvn} (want {want_moves}), locks still held {held}, steps {steps} -> {'OK' if ok else 'CHECK'}")
    return ok


def T1():
    print("T1 FIFO_TO_WA: before", costing(ITEM))
    dbw(f"UPDATE item SET material_costing_method = 'Weighted Average' WHERE id = {ITEM} AND tenant_id = '{TENANT}' AND material_costing_method = 'First In First Out'")
    op = "IBATEST|T1|" + STAMP
    d = apply("t1", op, [mv("O1", "SUBTRACT", 1, ITEM, 0), mv("I1", "ADD", 1, ITEM, 0, {"unit_price_from": "O1"})])
    print("  results:", d.get("results"))
    c = costing(ITEM)
    print("  after:", c)
    live_wa = [w for w in c["wa"] if int(w["del"]) == 0]
    ok = after_op(op, 2) and all(int(f["del"]) == 1 for f in c["fifo"]) and len(live_wa) == 1 and float(live_wa[0]["qty"]) == 11
    print("T1", "PASS" if ok and (d.get("results") or [{}])[0].get("costing_migrated") == "FIFO_TO_WA" else "FAIL")


def T2():
    print("T2 WA_TO_FIFO: before", costing(ITEM))
    dbw(f"UPDATE item SET material_costing_method = 'First In First Out' WHERE id = {ITEM} AND tenant_id = '{TENANT}' AND material_costing_method = 'Weighted Average'")
    op = "IBATEST|T2|" + STAMP
    d = apply("t2", op, [mv("O1", "SUBTRACT", 1, ITEM, 1), mv("I1", "ADD", 1, ITEM, 1, {"unit_price_from": "O1"})])
    print("  results:", d.get("results"))
    c = costing(ITEM)
    print("  after:", c)
    live_f = [f for f in c["fifo"] if int(f["del"]) == 0]
    lock = q(f"SELECT owner_operation_id own, last_owner_operation_id last FROM inventory_balance_lock WHERE tenant_id = '{TENANT}' AND lock_key = 'COST|{ITEM}|{PLANT}'")
    print("  COST lock row:", lock)
    ok = after_op(op, 2) and all(int(w["del"]) == 1 for w in c["wa"]) and len(live_f) == 1 and float(live_f[0]["avail"]) == 11 and lock and lock[0]["last"] == op
    print("T2", "PASS" if ok and (d.get("results") or [{}])[0].get("costing_migrated") == "WA_TO_FIFO" else "FAIL")


def pairs():
    # one balance row per item at the bin (dev has items with two, which the engine refuses as DUPLICATE_BALANCE)
    rows = q(f"SELECT CAST(b.material_id AS CHAR) m FROM item_balance b JOIN item i ON i.id = b.material_id AND i.is_deleted = 0 AND i.stock_control = 1 AND i.item_batch_management = 0 "
             f"WHERE b.tenant_id = '{TENANT}' AND b.plant_id = {PLANT} AND b.location_id = {BIN} AND b.is_deleted = 0 AND b.material_id <> {ITEM} "
             "GROUP BY b.material_id HAVING COUNT(*) = 1 AND MIN(b.unrestricted_qty) >= 1 ORDER BY b.material_id LIMIT 32")
    out = []
    for i, r in enumerate(rows):
        out += [mv("O%d" % i, "SUBTRACT", 1, r["m"], 1), mv("I%d" % i, "ADD", 1, r["m"], 1, {"unit_price_from": "O%d" % i})]
    return [r["m"] for r in rows], out


def balances(mats):
    return {r["m"]: r["u"] for r in q(f"SELECT CAST(material_id AS CHAR) m, CAST(unrestricted_qty AS CHAR) u FROM item_balance WHERE tenant_id = '{TENANT}' AND location_id = {BIN} AND is_deleted = 0 AND material_id IN ({','.join(mats)})")}


def T3T4():
    mats, moves = pairs()
    before = balances(mats)
    op = "IBATEST|T3|" + STAMP
    print(f"T3 size: {len(mats)} items, {len(moves)} movements")
    d = apply("t3", op, moves)
    ok3 = after_op(op, len(moves)) and balances(mats) == before and d.get("code") == "200"
    print("T3", "PASS" if ok3 else "FAIL")
    d4 = apply("t4", op, moves)
    ok4 = after_op(op, len(moves)) and d4.get("code") == "200" and balances(mats) == before
    print("T4 replay", "PASS" if ok4 else "FAIL")


if __name__ == "__main__":
    todo = sys.argv[1:] or ["T1", "T2", "T3"]
    for t in todo:
        {"T1": T1, "T2": T2, "T3": T3T4}[t]()
