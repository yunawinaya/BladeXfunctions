"""check_one.py <before.json> <after.json>: a completed GD (snap.py before / after) against what its own lines and Allocated
reservations say the completion must do - every number reconciled, every unexpected change listed."""
import json
import sys
from collections import defaultdict
from decimal import Decimal

B, A = [json.load(open(p)) for p in sys.argv[1:3]]
D = lambda v: Decimal(str(v or 0))
problems = []
gd = B["meta"]["gd"]
ok = lambda cond, what: problems.append(what) if not cond else None

# header
ok(A["gd"][0]["gd_status"] == "Completed", "gd_status is %s" % A["gd"][0]["gd_status"])
# lines: only the columns the completion may write
ALLOWED = {"prev_temp_qty_data", "customer_id", "organization_id", "plant_id", "billing_state_id", "billing_country_id", "shipping_state_id",
           "shipping_country_id", "assigned_to", "area_id", "line_index", "gd_undelivered_qty", "packing_qty", "net_weight", "update_time", "update_user"}
# an auto-SI (C6_SI) stamps the invoice back onto the lines
if any(s["step_name"] == "C6_SI" and s["step_status"] == "DONE" for s in A["step"]):
    ALLOWED |= {"invoice_qty", "si_status"}
bl = {r["id"]: r for r in B["gdl"]}
for r in A["gdl"]:
    o = bl.get(r["id"])
    if not o:
        problems.append("new GD line %s" % r["id"])
        continue
    for k in set(r) | set(o):
        x, y = o.get(k), r.get(k)
        if k in ALLOWED or (x in (None, "") and y in (None, "")) or str(x) == str(y):
            continue
        try:
            if Decimal(str(x)) == Decimal(str(y)):
                continue
        except Exception:
            pass
        problems.append("GD line %s: %s %r -> %r" % (r["id"], k, x, y))
# reservations: every Allocated row of the GD -> Delivered, delivered = reserved, open 0
allocated = [r for r in B["res"] if r["target_gd_id"] == gd and r["status"] == "Allocated"]
after_res = {r["id"]: r for r in A["res"]}
by_key = defaultdict(Decimal)
for r in allocated:
    a = after_res.get(r["id"])
    if not a:
        problems.append("reservation %s vanished" % r["id"])
        continue
    if a["status"] != "Delivered" or D(a["delivered_qty"]) != D(r["reserved_qty"]) or D(a["open_qty"]) != 0:
        problems.append("reservation %s: %s delivered %s open %s (reserved %s)" % (r["id"], a["status"], a["delivered_qty"], a["open_qty"], r["reserved_qty"]))
    by_key[(r["material_id"], r["bin_location"])] += D(r["reserved_qty"])
new_res = [r for r in A["res"] if r["id"] not in {x["id"] for x in B["res"]}]
# balances: reserved and total down by the delivered quantity per material + bin, nothing else moves
bib = {r["id"]: r for r in B["ib"]}
seen = set()
for r in A["ib"]:
    o = bib[r["id"]]
    k = (r["material_id"], r["location_id"])
    want = by_key.get(k, Decimal(0))
    seen.add(k)
    for col, d in (("reserved_qty", -want), ("balance_quantity", -want), ("unrestricted_qty", 0), ("block_qty", 0), ("qualityinsp_qty", 0), ("intransit_qty", 0)):
        if D(r[col]) - D(o[col]) != d:
            problems.append("item_balance %s %s: %s %s -> %s, expected change %s" % (k[0], k[1], col, o[col], r[col], d))
for k in by_key:
    if k not in seen:
        problems.append("no item_balance row for %s" % (k,))
# FIFO: available down by the delivered quantity per material
by_mat = defaultdict(Decimal)
for (m, _), q in by_key.items():
    by_mat[m] += q
fb = defaultdict(Decimal)
fa = defaultdict(Decimal)
for r in B["fifo"]:
    fb[r["material_id"]] += D(r["fifo_available_quantity"])
for r in A["fifo"]:
    fa[r["material_id"]] += D(r["fifo_available_quantity"])
for m in set(fb) | set(fa):
    if fa[m] - fb[m] != -by_mat.get(m, Decimal(0)):
        problems.append("FIFO %s: available %s -> %s, expected -%s" % (m, fb[m], fa[m], by_mat.get(m, 0)))
# movements: one OUT from Reserved per material + bin, the delivered quantity, GDL
old_mv = {r["id"] for r in B["mv"]}
mv = [r for r in A["mv"] if r["id"] not in old_mv]
mq = defaultdict(Decimal)
for r in mv:
    if r["transaction_type"] != "GDL" or r["movement"] != "OUT" or r["inventory_category"] != "Reserved":
        problems.append("movement %s: %s %s %s" % (r["id"], r["transaction_type"], r["movement"], r["inventory_category"]))
    mq[(r["item_id"], r["bin_location_id"])] += D(r["quantity"])
if dict(mq) != {k: v for k, v in by_key.items() if v}:
    problems.append("movement quantities differ from the reservations: %d keys vs %d" % (len(mq), len(by_key)))
# SO lines: delivered up by the GD's quantity on each line
gdq = defaultdict(Decimal)
for r in B["gdl"]:
    if r.get("so_line_item_id"):
        gdq[str(r["so_line_item_id"])] += D(r["gd_qty"])
bs = {str(r["id"]): r for r in B["sol"]}
for r in A["sol"]:
    o = bs[str(r["id"])]
    want = gdq.get(str(r["id"]), Decimal(0))
    if D(r["delivered_qty"]) - D(o["delivered_qty"]) != want:
        problems.append("SO line %s: delivered %s -> %s, expected +%s" % (r["id"], o["delivered_qty"], r["delivered_qty"], want))
# handling units: each one's total and its item rows down by what the lines deliver from it (temp_qty_data entries with a
# handling unit; a null batch drains any batch), movements carry the handling unit, nothing else on them changes
deliv_hu, deliv_key, deliv_mv = defaultdict(Decimal), defaultdict(Decimal), defaultdict(Decimal)
for r in B["gdl"]:
    try:
        temps = json.loads(r.get("temp_qty_data") or "[]")
    except Exception:
        temps = []
    for x in temps if isinstance(temps, list) else []:
        hu = str(x.get("handling_unit_id") or "")
        if not hu.isdigit():
            continue
        q = D(x.get("gd_quantity"))
        deliv_hu[hu] += q
        deliv_key[(hu, str(r["material_id"]), str(x.get("batch_id") or ""))] += q
        deliv_mv[(str(r["material_id"]), str(x.get("location_id")), hu)] += q
SAME = {"update_time", "update_user"}
bh = {str(r["id"]): r for r in B.get("hu", [])}
for r in A.get("hu", []):
    o = bh.get(str(r["id"]))
    if not o:
        problems.append("new handling unit %s" % r["id"])
        continue
    if D(r["total_quantity"]) - D(o["total_quantity"]) != -deliv_hu.get(str(r["id"]), Decimal(0)):
        problems.append("handling unit %s: total %s -> %s, expected -%s" % (r["id"], o["total_quantity"], r["total_quantity"], deliv_hu.get(str(r["id"]), 0)))
    for k in (set(r) | set(o)) - SAME - {"total_quantity"}:
        if str(r.get(k)) != str(o.get(k)):
            problems.append("handling unit %s: %s %r -> %r" % (r["id"], k, o.get(k), r.get(k)))
bi = {str(r["id"]): r for r in B.get("hui", [])}
chg = defaultdict(Decimal)
for r in A.get("hui", []):
    o = bi.get(str(r["id"]))
    if not o:
        problems.append("new HU item row %s" % r["id"])
        continue
    if D(r["quantity"]) < 0:
        problems.append("HU item row %s negative: %s" % (r["id"], r["quantity"]))
    chg[(str(r["handling_unit_id"]), str(r["material_id"]), str(r.get("batch_id") or ""))] += D(r["quantity"]) - D(o["quantity"])
    for k in (set(r) | set(o)) - SAME - {"quantity"}:
        if str(r.get(k)) != str(o.get(k)):
            problems.append("HU item row %s: %s %r -> %r" % (r["id"], k, o.get(k), r.get(k)))
covered = set()
for (hu, mat, batch), q in deliv_key.items():
    keys = [k for k in chg if k[0] == hu and k[1] == mat and (not batch or k[2] == batch)]
    covered.update(keys)
    if sum((chg[k] for k in keys), Decimal(0)) != -q:
        problems.append("HU %s material %s batch %s: items changed %s, expected -%s" % (hu, mat, batch or "-", sum((chg[k] for k in keys), Decimal(0)), q))
for k, d in chg.items():
    if d and k not in covered:
        problems.append("HU items %s changed by %s without a delivery" % (k, d))
if deliv_mv:
    mh = defaultdict(Decimal)
    for r in mv:
        mh[(str(r["item_id"]), str(r["bin_location_id"]), str(r.get("handling_unit_id") or ""))] += D(r["quantity"])
    if dict(mh) != dict(deliv_mv):
        problems.append("movements by material + bin + handling unit differ from the lines: %s vs %s" % (sorted(mh.items())[:3], sorted(deliv_mv.items())[:3]))
# snapshot, job, steps
ok(len(A["snapshot"]) == len(B["snapshot"]) + 1, "snapshot rows %d -> %d" % (len(B["snapshot"]), len(A["snapshot"])))
jobs = [j for j in A["job"] if j["id"] not in {x["id"] for x in B["job"]}]
ok(len(jobs) == 1 and jobs[0]["job_status"] == "COMPLETED", "jobs: %s" % [(j["job_status"], j["error_code"]) for j in jobs])
steps = {s["step_name"] for s in A["step"] if s["step_status"] == "DONE"}
for s in ["C0_REVALIDATE", "C1_SNAPSHOT", "C2_INVENTORY", "C3_RESERVATIONS", "C4_SO", "C5_GD", "C6_AFTER"] + (["C3H_HU"] if deliv_hu else []):
    ok(s in steps, "step %s not DONE" % s)
print("%s: %d lines, %d reservations delivered, %d new reservation rows, %d balance keys, %d movements, %d SO lines, %d handling units; SO %s -> %s" % (
    B["meta"]["no"], len(A["gdl"]), len(allocated), len(new_res), len(by_key), len(mv), len(A["sol"]), len(deliv_hu),
    B["so"][0]["so_status"] if B["so"] else "-", A["so"][0]["so_status"] if A["so"] else "-"))
print("PROBLEMS: %d" % len(problems))
for p in problems[:40]:
    print("  ", p)
