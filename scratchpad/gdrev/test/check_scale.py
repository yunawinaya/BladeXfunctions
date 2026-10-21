"""check_scale.py <pre.json> <post.json>: one live revert's end state from two snap.py snapshots (offline): the job, the GD and its
snapshot; no reservation of the GD left Delivered; each SO line's delivered_qty back by the GD's quantities (same unit); per balance
(item / batch / bin) the revert's GDL-R movements against what the completion moved out (base quantity and cost); the new FIFO layers'
value against the revert's; item_balance reserved / unrestricted moved by the revert's movements. Prints each check; exit 1 on a failure."""
import json
import sys
from collections import Counter, defaultdict

pre, post = (json.load(open(f)) for f in sys.argv[1:3])
gd = pre["meta"]["gd"]
f = lambda v: float(v or 0)
k3 = lambda item, b, bin_: (str(item), str(b or "0"), str(bin_ or ""))
fails = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (": " + detail if detail else ""))
    if not ok:
        fails.append(name)


jobs = [j for j in post["job"] if j["id"] not in {x["id"] for x in pre["job"]}]
check("one new REVERT_GD job, COMPLETED", len(jobs) == 1 and jobs[0]["job_status"] == "COMPLETED", str([(j["id"], j["job_status"], j.get("error_code")) for j in jobs]))
check("GD Completed -> Created", pre["gd"][0]["gd_status"] == "Completed" and post["gd"][0]["gd_status"] == "Created", post["gd"][0]["gd_status"])
active = [s["id"] for s in pre["snap"] if s["snapshot_status"] == "Active"]
after = {s["id"]: s["snapshot_status"] for s in post["snap"]}
check("its active snapshot -> Reverted", len(active) == 1 and after.get(active[0]) == "Reverted", str(active))

rb = {r["id"]: r for r in pre["res"]}
ra = {r["id"]: r for r in post["res"]}
moves = Counter((rb[i]["status"], ra[i]["status"], rb[i]["is_deleted"], ra[i]["is_deleted"]) for i in rb if i in ra and (rb[i]["status"], rb[i]["is_deleted"]) != (ra[i]["status"], ra[i]["is_deleted"]))
print("     reservations changed (status before, after, is_deleted before, after):", dict(moves), "| new rows:", len([i for i in ra if i not in rb]))
left = [i for i, r in ra.items() if r["status"] == "Delivered" and str(r["is_deleted"]) == "0" and gd in (str(r.get("target_gd_id")), str(r.get("doc_id")))]
check("no reservation of the GD left Delivered", not left, "%d left" % len(left))

lines = [l for l in pre["gdl"] if str(l["is_deleted"]) == "0"]
back = defaultdict(float)
uom = {}
for l in lines:
    if l.get("so_line_item_id"):
        back[str(l["so_line_item_id"])] += f(l["gd_qty"])
        uom[str(l["so_line_item_id"])] = str(l.get("good_delivery_uom_id"))
sb = {str(r["id"]): r for r in pre["sol"]}
sa = {str(r["id"]): r for r in post["sol"]}
bad, skipped = [], 0
for sid, q in back.items():
    if sid not in sb or sid not in sa:
        bad.append(sid + " missing")
        continue
    if str(sb[sid].get("so_item_uom")) != uom[sid]:
        skipped += 1
        continue
    d = f(sb[sid]["delivered_qty"]) - f(sa[sid]["delivered_qty"])
    if abs(d - q) > 1e-6:
        bad.append("%s back %s, GD %s" % (sid, d, q))
check("SO lines' delivered_qty back by the GD's quantities", not bad, "%d lines, %d other unit skipped; %s" % (len(back), skipped, bad[:3]))

snap_id = int(active[0]) if active else 0
comp, rev = defaultdict(lambda: [0.0, 0.0]), defaultdict(lambda: [0.0, 0.0])
cat = defaultdict(float)
mb = {r["id"] for r in pre["mv"]}
for r in pre["mv"]:
    if int(r["id"]) > snap_id and r["transaction_type"] == "GDL" and str(r["is_deleted"]) == "0":
        sg = 1 if str(r["movement"]).upper() == "OUT" else -1
        x = comp[k3(r["item_id"], r["batch_number_id"], r["bin_location_id"])]
        x[0] += sg * f(r["base_qty"] if r["base_qty"] is not None else r["quantity"])
        x[1] += sg * f(r["total_price"])
new_mv = [r for r in post["mv"] if r["id"] not in mb]
for r in new_mv:
    sg = 1 if str(r["movement"]).upper() == "IN" else -1
    bq = f(r["base_qty"] if r["base_qty"] is not None else r["quantity"])
    x = rev[k3(r["item_id"], r["batch_number_id"], r["bin_location_id"])]
    x[0] += sg * bq
    x[1] += sg * f(r["total_price"])
    cat[(str(r["item_id"]), str(r["batch_number_id"] or "0"), str(r["bin_location_id"] or ""), r["inventory_category"])] += sg * bq
check("new movements are all GDL-R", all(r["transaction_type"] == "GDL-R" for r in new_mv), "%d new, types %s" % (len(new_mv), dict(Counter(r["transaction_type"] for r in new_mv))))
qbad = [(k, comp[k][0], rev[k][0]) for k in set(comp) | set(rev) if abs(comp[k][0] - rev[k][0]) > 1e-6]
check("per balance: base quantity back = what the completion moved out", not qbad, "%d balances; %s" % (len(set(comp) | set(rev)), qbad[:3]))
cbad = [(k, round(comp[k][1], 4), round(rev[k][1], 4)) for k in set(comp) | set(rev) if abs(comp[k][1] - rev[k][1]) > max(0.01, 1e-6 * abs(comp[k][1]))]
tc, tr = sum(v[1] for v in comp.values()), sum(v[1] for v in rev.values())
check("per balance: cost back = the cost that left", not cbad, "out %.4f, back %.4f; %s" % (tc, tr, cbad[:3]))

fb = {r["id"] for r in pre["fifo"]}
nf = [r for r in post["fifo"] if r["id"] not in fb]
fv = sum(f(r["fifo_initial_quantity"]) * f(r["fifo_cost_price"]) for r in nf)
zero = [r["id"] for r in nf if f(r["fifo_cost_price"]) == 0 and f(r["fifo_initial_quantity"]) > 0]
fpre = {r["id"]: r for r in pre["fifo"]}
chg = [r["id"] for r in post["fifo"] if r["id"] in fpre and r != fpre[r["id"]]]
check("new FIFO layers' value = the cost back", abs(fv - tr) <= max(0.05, 1e-5 * abs(tr)), "%d layers, %.4f vs %.4f; %d at cost 0; %d older layers changed" % (len(nf), fv, tr, len(zero), len(chg)))

# batch items' balances are item_batch_balance rows
bal = lambda s: {(str(r["material_id"]), str(r.get("batch_id") or "0"), str(r["location_id"])): r for r in s["ib"] + s["ibb"]}
ib0, ib1 = bal(pre), bal(post)
bbad = []
for (item, b, bin_, c), q in cat.items():
    col = {"Reserved": "reserved_qty", "Unrestricted": "unrestricted_qty"}.get(c)
    b0, b1 = ib0.get((item, b, bin_)), ib1.get((item, b, bin_))
    if not col or not b1:
        bbad.append((item, b, bin_, c, "no balance row"))
        continue
    d = f(b1[col]) - f(b0[col] if b0 else 0)
    if abs(d - q) > 1e-3:
        bbad.append((item, b, bin_, c, round(d, 6), round(q, 6)))
check("item_balance moved by the revert's movements", not bbad, "%d balance / category pairs; %s" % (len(cat), bbad[:3]))
print("%d check(s) failed" % len(fails) if fails else "all checks passed")
sys.exit(1 if fails else 0)
