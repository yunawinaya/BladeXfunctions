"""python3 scratchpad/iav2/test/prepare/mutants_res.py - RES-01 R4 in IA_V2_PREPARE's plan: each mutant of the BUILT plan code (JSON text)
must make test_prepare.js fail (IAP_BUILT = the mutant)."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BUILT = os.path.join(HERE, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2", "IA_V2_PREPARE.json")
J = lambda s: json.dumps(s)[1:-1]
MUTANTS = [
    ("the stored hold status ignored", J('const reserves = !!resRead && s(resRead.hold) !== "";'), J("const reserves = !!resRead;")),
    ("a reservation running not refused", J("if (split.busy) return fail("), J("if (false) return fail(")),
    ("Reserved refused", J('const okIssue = reserves ? IA_OK_CATEGORIES.concat(["Reserved"]) : IA_OK_CATEGORIES;'), J("const okIssue = IA_OK_CATEGORIES;")),
    ("the split lines not used", J("    header.stock_movement = split.lines;\n"), ""),
    ("an IA that never reserved split", J(' && s(resRead.hold) !== ""'), ""),
]
text = open(BUILT, encoding="utf-8").read()
survived = 0
for name, old, new in MUTANTS:
    if text.count(old) != 1:
        print("BROKEN mutant (anchor not found once): " + name)
        survived += 1
        continue
    d = tempfile.mkdtemp(prefix="iap-mut-")
    path = os.path.join(d, "IA_V2_PREPARE.json")
    open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
    r = subprocess.run(["node", os.path.join(HERE, "test_prepare.js")], env=dict(os.environ, IAP_BUILT=path), capture_output=True, text=True, timeout=900)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
