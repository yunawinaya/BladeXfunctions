"""gen_repair.py <out_dir>: read-only on PROD. Every Revert Completed movement (GDL-R) put its stock back as a FIFO layer at
cost 0 (GD_PROCESS_REVERT v12 passed no unit_price). Prices each one the way v13 does - its GD's OUT Reserved deliveries
since the GD's previous revert, per base unit, by item + batch + bin + handling unit, then batch, then item - and pairs it
with the cost-0 layer it created (same tenant, material, batch, quantity; closest in time, within 15 s; one-to-one).
Writes repair_fifo_cost.sql (UPDATEs for layers that still hold stock, guarded on cost 0), rollback_fifo_cost.sql, and
reverts_at_cost0.csv (every revert movement: value, still in stock, already consumed) for finance."""
import csv
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from decimal import Decimal as D

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)


def q(sql):
    t = subprocess.run([".dbtools/db", "--prod", "--json", "--limit", "200000", sql], capture_output=True, text=True,
                       cwd="/Users/yunawinaya/Developer/BladeXfunctions")
    if "[" not in t.stdout:
        raise SystemExit(t.stderr[-800:])
    return json.loads(t.stdout[t.stdout.index("["):])


def part(v):
    return "0" if v in (None, "", "None") else str(v)


plain = lambda v: format(v.normalize(), "f")
ts = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M:%S.%f")
R = q("SELECT CAST(m.id AS CHAR) id, m.tenant_id t, m.trx_no gd, CAST(m.item_id AS CHAR) item, i.material_code code, i.material_costing_method cm, "
      "CAST(m.batch_number_id AS CHAR) b, CAST(m.bin_location_id AS CHAR) bin, CAST(m.handling_unit_id AS CHAR) hu, CAST(COALESCE(m.base_qty, m.quantity) AS CHAR) q, "
      "DATE_FORMAT(m.create_time, '%Y-%m-%d %H:%i:%s.%f') ct, m.organization_id org "
      "FROM inventory_movement m LEFT JOIN item i ON i.id = m.item_id WHERE m.transaction_type = 'GDL-R' AND m.is_deleted = 0")
gds = sorted(set((r["org"], r["gd"]) for r in R))
M = q("SELECT CAST(id AS CHAR) id, organization_id org, trx_no gd, transaction_type tt, movement mv, inventory_category cat, CAST(item_id AS CHAR) item, "
      "CAST(batch_number_id AS CHAR) b, CAST(bin_location_id AS CHAR) bin, CAST(handling_unit_id AS CHAR) hu, CAST(total_price AS CHAR) tp, "
      "CAST(COALESCE(base_qty, quantity) AS CHAR) q FROM inventory_movement WHERE is_deleted = 0 AND transaction_type IN ('GDL', 'GDL-R') AND trx_no IN (%s)"
      % ",".join("'" + g.replace("'", "''") + "'" for g in sorted(set(g for _, g in gds))))
by_gd = defaultdict(list)
for m in M:
    by_gd[(m["org"], m["gd"])].append(m)
# one revert writes a run of consecutive GDL-R rows: its delivery window ends at the run's first row and starts after the
# previous run's last row, as v13's single read sees it before writing anything
window = {}
for rows in by_gd.values():
    rows.sort(key=lambda x: int(x["id"]))
    prev_end, start, last = 0, None, None
    for x in rows:
        if x["tt"] == "GDL-R":
            if start is None:
                start = int(x["id"])
            window[x["id"]] = (prev_end, start)
            last = int(x["id"])
        elif start is not None:
            prev_end, start = last, None


def delivery_cost(r):
    rows = by_gd[(r["org"], r["gd"])]
    prev, me = window[r["id"]]
    acc = defaultdict(lambda: [D(0), D(0)])
    for x in rows:
        if x["tt"] != "GDL" or x["mv"] != "OUT" or x["cat"] != "Reserved" or not (prev < int(x["id"]) < me):
            continue
        tp, bq = D(x["tp"] or 0), D(x["q"] or 0)
        if bq <= 0:
            continue
        for k in ((x["item"], part(x["b"]), part(x["bin"]), part(x["hu"])), (x["item"], part(x["b"])), (x["item"],)):
            acc[k][0] += tp
            acc[k][1] += bq
    for k in ((r["item"], part(r["b"]), part(r["bin"]), part(r["hu"])), (r["item"], part(r["b"])), (r["item"],)):
        if acc[k][1] > 0:
            return (acc[k][0] / acc[k][1]).quantize(D("0.00000001"))
    return D(0)


items = sorted(set(r["item"] for r in R))
F = q("SELECT CAST(id AS CHAR) id, tenant_id t, CAST(material_id AS CHAR) item, CAST(batch_id AS CHAR) b, CAST(fifo_initial_quantity AS CHAR) iq, "
      "CAST(fifo_available_quantity AS CHAR) aq, CAST(fifo_cost_price AS CHAR) c, DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s.%f') ct "
      "FROM fifo_costing_history WHERE is_deleted = 0 AND fifo_cost_price = 0 AND material_id IN (" + ",".join(items) + ")")
pairs = []
for r in R:
    if r["cm"] != "First In First Out":
        continue
    for f in F:
        if f["t"] == r["t"] and f["item"] == r["item"] and part(f["b"]) == part(r["b"]) and D(f["iq"]) == D(r["q"]):
            dt = abs((ts(f["ct"]) - ts(r["ct"])).total_seconds())
            if dt <= 15:
                pairs.append((dt, r["id"], f["id"]))
pairs.sort()
layer_of, taken = {}, set()
for dt, rid, fid in pairs:
    if rid in layer_of or fid in taken:
        continue
    layer_of[rid] = fid
    taken.add(fid)
Fby = {f["id"]: f for f in F}

rows, upd = [], []
for r in sorted(R, key=lambda r: (r["t"], r["ct"])):
    cost = delivery_cost(r)
    f = Fby.get(layer_of.get(r["id"])) if r["cm"] == "First In First Out" else None
    qty = D(r["q"])
    avail = D(f["aq"]) if f else D(0)
    rows.append({"tenant": r["t"], "gd_no": r["gd"], "reverted_at": r["ct"][:19], "item_code": r["code"], "costing": r["cm"], "batch_id": part(r["b"]),
                 "qty_returned": plain(qty), "delivery_cost_per_unit": plain(cost), "value": str((qty * cost).quantize(D("0.01"))),
                 "fifo_layer_id": f["id"] if f else "", "still_in_stock_qty": plain(avail), "still_in_stock_value": str((avail * cost).quantize(D("0.01"))),
                 "consumed_value": str(((qty - avail) * cost).quantize(D("0.01"))) if f else "", "repair": "yes" if (f and cost > 0 and avail > 0) else ""})
    if f and cost > 0 and avail > 0:
        upd.append((r["t"], r["item"], f["id"], cost, avail, r["gd"]))

with open(os.path.join(OUT, "reverts_at_cost0.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

head = ["-- PROD repair: Revert Completed (GD_PROCESS_REVERT v12) returned stock as FIFO layers at cost 0. Sets each such layer that",
        "-- still holds stock to the cost its delivery went out at (per base unit). Generated %s by gen_repair.py (read-only)." % datetime.now().strftime("%Y-%m-%d %H:%M"),
        "-- Each UPDATE is guarded on fifo_cost_price = 0, so a re-run or an already-repaired layer changes nothing.",
        "-- %d layers, %s of stock value restored. Re-generate right before running (layers keep being consumed)." % (len(upd), sum((c * a for _, _, _, c, a, _ in upd), D(0)).quantize(D("0.01"))),
        ""]
with open(os.path.join(OUT, "repair_fifo_cost.sql"), "w") as fh:
    fh.write("\n".join(head) + "\n")
    for t, item, fid, cost, avail, gd in upd:
        fh.write("UPDATE fifo_costing_history SET fifo_cost_price = %s WHERE id = %s AND tenant_id = '%s' AND material_id = %s AND fifo_cost_price = 0 AND is_deleted = 0; -- %s, %s in stock\n"
                 % (plain(cost), fid, t, item, gd, plain(avail)))
    fh.write("\n-- verify: expect %d rows\nSELECT COUNT(*) FROM fifo_costing_history WHERE id IN (%s) AND fifo_cost_price > 0;\n" % (len(upd), ",".join(u[2] for u in upd)))
with open(os.path.join(OUT, "rollback_fifo_cost.sql"), "w") as fh:
    fh.write("-- rollback of repair_fifo_cost.sql: the same layers back to cost 0\nUPDATE fifo_costing_history SET fifo_cost_price = 0 WHERE id IN (%s) AND is_deleted = 0;\n"
             % ",".join(u[2] for u in upd))

tot = defaultdict(lambda: [0, 0, D(0), D(0), D(0)])
for x in rows:
    a = tot[x["tenant"]]
    a[0] += 1
    a[1] += 1 if x["repair"] else 0
    a[2] += D(x["value"])
    a[3] += D(x["still_in_stock_value"])
    a[4] += D(x["consumed_value"] or 0)
print("revert movements %d | FIFO paired %d of %d | layers to repair %d" % (len(R), len(layer_of), sum(1 for r in R if r["cm"] == "First In First Out"), len(upd)))
print("%-8s %5s %7s %12s %15s %15s" % ("tenant", "mvts", "repair", "value", "in stock", "consumed"))
for t, (n, k, v, s, c) in sorted(tot.items()):
    print("%-8s %5d %7d %12.2f %15.2f %15.2f" % (t, n, k, v, s, c))
