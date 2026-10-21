"""python3 scratchpad/iav2/client/test/mutants_res_delete.py - RES-01 R5 in the IA list Delete: each mutant of the BUILT list page
(Item Assembly & BOM/AsyncV2/IAlistPage.json, the ON build) must make test/test_lists.js fail (IA_LIST = the mutated copy)."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIST = os.path.join(HERE, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2", "IAlistPage.json")
J = lambda s: json.dumps(s)[1:-1]
GATE = 'if (resOn && String(stored.material_hold_status || "") !== "") {'
MUTANTS = [
    ("no release at all", J("const resOn = /^[1-9][0-9]{0,19}$/.test(RES_HOLD);"), J("const resOn = false;")),
    ("the release skipped", J(GATE), J("if (false) {")),
    ("a never-reserving IA released", J(GATE), J("if (resOn) {")),
    ("the stored read unchanged", J('.field("item_assembly_status,material_hold_status,organization_id")'), J('.field("item_assembly_status")')),
    ("another operation", J('operation: "RELEASE_ALL"'), J('operation: "RECONCILE"')),
    ("another source", J('operation: "RELEASE_ALL", source: "LIST"'), J('operation: "RELEASE_ALL", source: "FORM"')),
    ("any code accepted", J('String(answer.code) !== "200" || '), ""),
    ("any status accepted", J(' || held !== "NONE")'), ")"),
    ("refused but deleted", J("        this.refresh();\n        return;\n      }\n    }\n"), J("        this.refresh();\n      }\n    }\n")),
]
text = open(LIST, encoding="utf-8").read()
survived = 0
for name, old, new in MUTANTS:
    if text.count(old) != 1:
        print("BROKEN mutant (anchor found %d times): %s" % (text.count(old), name))
        survived += 1
        continue
    fd, path = tempfile.mkstemp(prefix="ialist-mut-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text.replace(old, new, 1))
    r = subprocess.run(["node", os.path.join(HERE, "test_lists.js")], env=dict(os.environ, IA_LIST=path, IA_EXPECT_ON="1"), capture_output=True, text=True, timeout=300)
    os.remove(path)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
