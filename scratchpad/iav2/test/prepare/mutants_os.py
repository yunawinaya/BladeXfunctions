"""python3 scratchpad/iav2/test/prepare/mutants_os.py - the IA output split (plan 10-27) in IA_V2_PREPARE: each mutant of the BUILT
PREPARE (JSON text) must make test_prepare.js fail (IAP_BUILT = the mutant)."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BUILT = os.path.join(HERE, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2", "IA_V2_PREPARE.json")
J = lambda s: json.dumps(s)[1:-1]
MUTANTS = [
    ("the split not checked again", J("  if (!chk.ok) return { why: chk.message };\n  const bc = "), J("  const bc = ")),
    ("the split's bins not checked", J("  if (!bc.ok) return { why: bc.message };\n"), ""),
    ("a group's two numbers let through", J("if (!nums[0] || nums.some((x) => x !== nums[0])) return"), J("if (!nums[0]) return")),
    ("two groups with one number let through", J("    if (all.some((x, i) => all.indexOf(x) !== i)) return"), J("    if (false) return")),
    ("the row's qty ignored", J("quantity: r.os_qty, location_id: r.os_location_id,"), J("quantity: r1.quantity, location_id: r.os_location_id,")),
    ("the row's bin ignored", J("location_id: r.os_location_id, inventory_category: r.os_category }"), J("location_id: r1.location_id, inventory_category: r.os_category }")),
    ("the row's category ignored", J("inventory_category: r.os_category },"), J("inventory_category: r1.inventory_category },")),
    ("a System batch's dates from the header", J('kind === "SYSTEM" ? { manufacturing_date: iaPlanDate(r.os_mfg_date), expired_date: iaPlanDate(r.os_exp_date) } : {}'), J("{}")),
    ("a grid date passed as typed", J('return !t ? null : m ? m[1] + " " + (m[2] || "00:00:00") : t;'), J("return !t ? null : t;")),
    ("the receipts' batches not named", J('split && split.kind === "SYSTEM" ? { batchOf: split.batchOf } : {}'), J("{}")),
    ("one Batch row for the first group only", J("rows: split.groups.map((g) => batchRow("), J("rows: split.groups.slice(0, 1).map((g) => batchRow(")),
    ("a Batch row at the output's total", J("batchRow(g.batch_no, g.base, "), J("batchRow(g.batch_no, receiptBaseQty, ")),
    ("Ready: one receipt result expected", J('keysR.length || 1, labels, keysR.length ? keysR : ["R1"]'), J('1, labels, ["R1"]')),
    ("the split left out of the fingerprint", J("  return split.length ? base.concat([split]) : base;"), J("  return base;")),
]
text = open(BUILT, encoding="utf-8").read()
survived = 0
for name, old, new in MUTANTS:
    n = text.count(old)
    if n < 1:
        print("BROKEN mutant (anchor not found): " + name)
        survived += 1
        continue
    d = tempfile.mkdtemp(prefix="iap-os-mut-")
    path = os.path.join(d, "IA_V2_PREPARE.json")
    open(path, "w", encoding="utf-8").write(text.replace(old, new))
    r = subprocess.run(["node", os.path.join(HERE, "test_prepare.js")], env=dict(os.environ, IAP_BUILT=path), capture_output=True, text=True, timeout=900)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name + " (" + str(n) + " place(s))")
    else:
        print("killed   " + name + " (" + str(n) + " place(s))")
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
