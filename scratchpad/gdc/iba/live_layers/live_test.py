"""live_test.py: INVENTORY_BULK_APPLY v14 (report_layers, A1) on DEV 000000 after the publish (user's yes). Engine calls go through
scratchpad/gdc/tools/runwf.mjs (the CLI session, tenant 000000).
- P PLAN (writes nothing): a FIFO issue of P-00001 spanning 4 layers, with report_layers: fifo_layers equals the open layers in
  sequence order (id, sequence, quantity, cost) and adds up to the quantity and the total price; no step row, no movement.
- A APPLY on ABC-TEA (one layer): an issue of 2 with report_layers + a receipt of 2 back at its price: fifo_layers names the
  layer; the layer is 2 lower and the receipt made the next layer; 2 movements; the DONE row keeps the layers; locks back.
- R REPLAY of A: the same answer, fifo_layers included; no new movement.
- S size: 32 items x an unpriced category pair (isMovingInv 1) with report_layers on every issue: 200, no fifo_layers (a
  category move draws no layer), balances unchanged, one movement per key, locks back.
usage: python3 live_test.py [P A S]"""
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
CANDIDATES = ["2047235050834157570", "2066341864143695874", "2070758892513914881", "2094626841323700251"]
STAMP = time.strftime("%m%d%H%M%S")


def q(sql):
    out = subprocess.run([R + ".dbtools/db", "--dev", "--json", sql], capture_output=True, text=True, cwd=R)
    if out.returncode:
        raise SystemExit("db: " + out.stderr.strip()[-300:])
    return json.loads(out.stdout[out.stdout.find("["):])


def apply(name, op, movements, mode="APPLY"):
    req, res = os.path.join(HERE, name + ".req.json"), os.path.join(HERE, name + ".out.json")
    json.dump({"operation_key": op, "mode": mode, "organization_id": ORG, "movements": movements}, open(req, "w"))
    t0 = time.time()
    subprocess.run(["node", R + "scratchpad/gdc/tools/runwf.mjs", IBA, req, res], capture_output=True, text=True, cwd=R)
    d = json.load(open(res)).get("data") or {}
    print(f"  {name}: {time.time() - t0:.1f} s, code {d.get('code')} {d.get('result_code')} | {str(d.get('message'))[:140]}")
    return d


def mv(key, direction, qty, mat, moving, extra=None):
    m = {"movement_key": key, "direction": direction, "material_id": mat, "plant_id": PLANT, "organization_id": ORG, "location_id": BIN,
         "quantity": qty, "inventory_category": "Unrestricted", "transaction_type": "LOT", "trx_no": "IBATEST-" + STAMP,
         "doc_date": time.strftime("%Y-%m-%d"), "isMovingInv": moving}
    m.update(extra or {})
    return m


def layers(mat):
    rows = q(f"SELECT CAST(id AS CHAR) id, fifo_sequence seq, CAST(fifo_available_quantity AS CHAR) av, CAST(fifo_cost_price AS CHAR) c FROM fifo_costing_history "
             f"WHERE tenant_id = '{TENANT}' AND organization_id = '{ORG}' AND plant_id = {PLANT} AND material_id = {mat} AND is_deleted = 0 AND (batch_id IS NULL OR batch_id = 0)")
    return sorted(rows, key=lambda r: int(float(r["seq"])))


def close(a, b):
    return abs(float(a) - float(b)) < 1e-8


def same_layers(got, want):
    if not isinstance(got, list) or len(got) != len(want):
        return False
    return all(g.get("id") == w["id"] and g.get("sequence") == w["sequence"] and close(g.get("quantity"), w["quantity"]) and close(g.get("cost"), w["cost"]) for g, w in zip(got, want))


def written(op):
    mvn = q(f"SELECT COUNT(*) n FROM inventory_movement WHERE tenant_id = '{TENANT}' AND operation_effect_key LIKE '{op}|%' AND is_deleted = 0")[0]["n"]
    held = q(f"SELECT COUNT(*) n FROM inventory_balance_lock WHERE tenant_id = '{TENANT}' AND owner_operation_id = '{op}'")[0]["n"]
    steps = q(f"SELECT step_name, result_ref FROM gd_publish_step WHERE tenant_id = '{TENANT}' AND job_id = '{op}' AND is_deleted = 0 ORDER BY id")
    return int(mvn), int(held), steps


def P():
    for mat in CANDIDATES:
        open_ = [r for r in layers(mat) if float(r["av"]) > 0]
        seqs = [int(float(r["seq"])) for r in open_[:4]]
        bal = q(f"SELECT COUNT(*) n, CAST(MAX(unrestricted_qty) AS CHAR) u FROM item_balance WHERE tenant_id = '{TENANT}' AND material_id = {mat} AND location_id = {BIN} AND plant_id = {PLANT} AND is_deleted = 0")[0]
        if len(open_) < 4 or len(set(seqs)) < 4 or len(set(int(float(r["seq"])) for r in open_)) != len(open_) or int(bal["n"]) != 1:
            continue
        part = min(1.0, float(open_[3]["av"]))
        qty = round(sum(float(r["av"]) for r in open_[:3]) + part, 8)
        if float(bal["u"]) < qty:
            continue
        want = [{"id": r["id"], "sequence": int(float(r["seq"])), "quantity": float(r["av"]), "cost": float(r["c"])} for r in open_[:3]]
        want.append({"id": open_[3]["id"], "sequence": int(float(open_[3]["seq"])), "quantity": part, "cost": float(open_[3]["c"])})
        break
    else:
        raise SystemExit("P: no candidate item with 4 open layers and one balance row at the bin")
    print(f"P PLAN: item {mat}, issue {qty} over layers {[w['sequence'] for w in want]}")
    op = "IBATEST|L1|" + STAMP
    d = apply("p", op, [mv("O1", "SUBTRACT", qty, mat, 0, {"report_layers": True})], mode="PLAN")
    r0 = (d.get("results") or [{}])[0]
    got = r0.get("fifo_layers")
    print("  fifo_layers:", got)
    value = sum(x["quantity"] * x["cost"] for x in got or [])
    mvn, held, steps = written(op)
    ok = (d.get("code") == "200" and same_layers(got, want) and close(sum(x["quantity"] for x in got), qty)
          and abs(value - float(r0.get("total_price"))) < 1e-6 and mvn == 0 and held == 0 and not steps)
    print(f"  value {value} vs total_price {r0.get('total_price')}; written: movements {mvn}, locks {held}, steps {len(steps)}")
    print("P", "PASS" if ok else "FAIL")


def A_and_R():
    before = [r for r in layers(ITEM) if float(r["av"]) > 0]
    print("A APPLY: ABC-TEA layers before", before)
    first = before[0]
    op = "IBATEST|L2|" + STAMP
    moves = [mv("O1", "SUBTRACT", 2, ITEM, 0, {"report_layers": True}), mv("I1", "ADD", 2, ITEM, 0, {"unit_price_from": "O1"})]
    d = apply("a", op, moves)
    res = d.get("results") or [{}, {}]
    want = [{"id": first["id"], "sequence": int(float(first["seq"])), "quantity": 2, "cost": float(first["c"])}]
    print("  results:", res)
    after = layers(ITEM)
    mvn, held, steps = written(op)
    done = [s for s in steps if s["step_name"] == "IBA|DONE"]
    stored = json.loads(done[0]["result_ref"])["results"] if done else []
    new = [r for r in after if r["id"] not in {b["id"] for b in before}]
    old = next((r for r in after if r["id"] == first["id"]), None)
    ok = (d.get("code") == "200" and same_layers(res[0].get("fifo_layers"), want) and "fifo_layers" not in res[1]
          and old and close(old["av"], float(first["av"]) - 2) and len(new) == 1 and close(new[0]["av"], 2) and close(new[0]["c"], first["c"])
          and mvn == 2 and held == 0 and stored and same_layers(stored[0].get("fifo_layers"), want))
    print(f"  after: layer {first['id']} {old and old['av']}, new layer {new}; movements {mvn}, locks {held}, DONE keeps layers {bool(stored and stored[0].get('fifo_layers'))}")
    print("A", "PASS" if ok else "FAIL")
    d2 = apply("r", op, moves)
    mvn2, held2, _ = written(op)
    ok2 = d2.get("code") == "200" and d2.get("results") == res and mvn2 == 2 and held2 == 0
    print(f"  replay: same answer {d2.get('results') == res}, movements {mvn2}")
    print("R", "PASS" if ok2 else "FAIL")


def S():
    rows = q(f"SELECT CAST(b.material_id AS CHAR) m FROM item_balance b JOIN item i ON i.id = b.material_id AND i.is_deleted = 0 AND i.stock_control = 1 AND i.item_batch_management = 0 "
             f"WHERE b.tenant_id = '{TENANT}' AND b.plant_id = {PLANT} AND b.location_id = {BIN} AND b.is_deleted = 0 AND b.material_id <> {ITEM} "
             "GROUP BY b.material_id HAVING COUNT(*) = 1 AND MIN(b.unrestricted_qty) >= 1 ORDER BY b.material_id LIMIT 32")
    mats = [r["m"] for r in rows]
    moves = []
    for i, m in enumerate(mats):
        moves += [mv("O%d" % i, "SUBTRACT", 1, m, 1, {"report_layers": True}), mv("I%d" % i, "ADD", 1, m, 1, {"unit_price_from": "O%d" % i})]
    bal = lambda: {r["m"]: r["u"] for r in q(f"SELECT CAST(material_id AS CHAR) m, CAST(unrestricted_qty AS CHAR) u FROM item_balance WHERE tenant_id = '{TENANT}' AND location_id = {BIN} AND is_deleted = 0 AND material_id IN ({','.join(mats)})")}
    before = bal()
    op = "IBATEST|L3|" + STAMP
    print(f"S size: {len(mats)} items, {len(moves)} movements")
    d = apply("s", op, moves)
    mvn, held, steps = written(op)
    ok = (d.get("code") == "200" and not any("fifo_layers" in r for r in d.get("results") or []) and bal() == before
          and mvn == len(moves) and held == 0 and any(s["step_name"] == "IBA|DONE" for s in steps))
    print(f"  movements {mvn} (want {len(moves)}), locks {held}, balances unchanged {bal() == before}")
    print("S", "PASS" if ok else "FAIL")


if __name__ == "__main__":
    for t in sys.argv[1:] or ["P", "A", "S"]:
        {"P": P, "A": A_and_R, "S": S}[t]()
