"""Unit test of reconcile.py's classification (no database): the engine-made fixtures (make_fixtures.js: every race scenario
serial -> CONSISTENT, interleaved -> LOST UPDATE / DUPLICATE SEQUENCE) plus edge cases, and the timeline classifier.
usage: python3 scratchpad/sav2/race/test/test_reconcile.py   (regenerate fixtures first: node .../make_fixtures.js)
"""
import glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.join(HERE, ".."))
import reconcile as R  # noqa: E402

fails = 0
n = 0


def check(ok, what):
    global fails, n
    n += 1
    if not ok:
        fails += 1
    print(("PASS " if ok else "FAIL ") + what)


def verdicts(name):
    fx = json.load(open(os.path.join(HERE, "fixtures", name + ".json")))
    return fx, R.classify(fx["before"], fx["after"], fx["movements"], fx["materials"])


files = sorted(glob.glob(os.path.join(HERE, "fixtures", "*.json")))
check(len(files) >= 19, f"{len(files)} fixtures present (make_fixtures.js)")
for f in files:
    name = os.path.basename(f)[:-5]
    fx, v = verdicts(name)
    check(R.overall(v) == fx["expect"], f"{name}: {R.overall(v)} (expected {fx['expect']})")
    # the bins are lock-guarded: every engine-made fixture keeps them consistent
    if name != "E2_balance_mismatch":
        check(all("BALANCE MISMATCH" not in x["tags"] for x in v), f"{name}: bins consistent")

key = lambda v, mat: next(x for x in v if x["material"] == mat and x["method"] != "bin")  # noqa: E731
_, v = verdicts("R0_interleaved")
k = key(v, "9001")
check(k["rows_delta"] == -10 and k["movement_delta"] == -15, "R0: B's stale write keeps -10 of -15: A's 5 lost")
_, v = verdicts("R1_interleaved")
k = key(v, "9001")
check(k["rows_delta"] == -7 and k["movement_delta"] == -12, "R1: last writer (B, 7) wins, A's 5 lost")
_, v = verdicts("R1b_interleaved")
k = key(v, "9003")
check(k["batch"] == "8001" and "LOST UPDATE" in k["tags"], "R1b: batch-scoped FIFO key 9003/7001/8001 lost")
_, v = verdicts("R2_interleaved")
k = key(v, "9002")
check(k["rows_delta"] == 10 and k["movement_delta"] == 20 and abs(k["movement_value_delta"] - 800) < 1e-6 and k["value_delta"] < 600, "R2: WA qty +10 of +20, value ~500 of 800")
_, v = verdicts("R2_interleaved_rev")
k = key(v, "9002")
check(k["rows_delta"] == 10 and abs(k["value_delta"] - 300) < 0.2, "R2 reversed: A's stale write keeps only A's 10 @ 30")
_, v = verdicts("R2s_interleaved")
k = key(v, "9002")
check("LOST UPDATE" in k["tags"] and k["movement_delta"] == 0, "R2s: ADD 10 + SUBTRACT 10 net 0, still LOST (value / qty overwritten)")
_, v = verdicts("R3_interleaved")
k = key(v, "9001")
check(k["tags"] == ["DUPLICATE SEQUENCE"] and k["rows_delta"] == 20 and k["new_layers"] == 2 and "3 x2" in k["notes"][0], "R3: both new layers took sequence 3, quantities intact")
_, v = verdicts("R3_serial")
k = key(v, "9001")
check(k["tags"] == ["CONSISTENT"] and k["new_layers"] == 2, "R3 serial: sequences 3 and 4")
_, v = verdicts("E1_shortfall")
check(key(v, "9001")["tags"] == ["SHORTFALL"], "E1: OUT beyond the layers is inconclusive, not LOST")
_, v = verdicts("E2_balance_mismatch")
bad = [x for x in v if "BALANCE MISMATCH" in x["tags"]]
check(len(bad) == 1 and "9001/6001" in bad[0]["key"], "E2: only the tampered bin row mismatches")
_, v = verdicts("E3_lost_layer")
check(any("1 new layers for 2 IN movements" in nn for x in v for nn in x["notes"]), "E3: a missing layer insert is reported")
_, v = verdicts("E4_fixed_cost_only")
check(all(x["tags"] == ["CONSISTENT"] for x in v) and any(x["method"] == "Fixed Cost" for x in v), "E4: Fixed Cost has no cost row to compare")

# a tolerance sanity check: a value 0.0004 off at 4 dp prices is rounding, 1.0 off is not
fx = json.load(open(os.path.join(HERE, "fixtures", "R2_serial.json")))
after = json.loads(json.dumps(fx["after"]))
w = next(r for r in after["wa"] if r["material_id"] == "9002")
w["wa_cost_price"] = str(float(w["wa_cost_price"]) + 0.00004)
check(R.overall(R.classify(fx["before"], after, fx["movements"], fx["materials"])) == "CONSISTENT", "WA price 0.00004 off (rounding) stays CONSISTENT")
w["wa_cost_price"] = str(float(w["wa_cost_price"]) + 0.01)
check(R.overall(R.classify(fx["before"], after, fx["movements"], fx["materials"])) == "LOST UPDATE", "WA price 0.01 off on 1,020 units is LOST UPDATE")

# timeline classifier (ms)
B = {"read0": 100, "read1": 150, "plan1": 2000, "back0": 4000}
check(R.interleaving({"B": B, "A": {"read0": 300, "read1": 320, "plan1": 400, "back0": 700}}).startswith("A INSIDE"), "timeline: A read after B's read and wrote before B's plan finished -> inside")
check(R.interleaving({"B": B, "A": {"read0": 90, "read1": 120, "plan1": 1500, "back0": 2500}}).startswith("OVERLAP"), "timeline: both read before either could write -> overlap")
check(R.interleaving({"B": B, "A": {"read0": 4100, "read1": 4120, "plan1": 4200, "back0": 4400}}).startswith("SERIAL"), "timeline: A read after B's writes -> serial")
check(R.interleaving({"B": B, "A": {"read0": 2500, "read1": 2520, "plan1": 2600, "back0": 2900}}).startswith("PARTIAL"), "timeline: A read inside B's write phase -> partial")
check(R.interleaving({"B": B}).startswith("INCOMPLETE"), "timeline: one op missing -> incomplete")
check(R.interleaving({"B": B, "A": {"read0": 0, "read1": 0, "plan1": 0, "back0": 0}}).startswith("INCOMPLETE"), "timeline: an op that never read (REPLAY / BUSY) -> incomplete")

print(f"{n - fails} of {n} passed")
sys.exit(1 if fails else 0)
