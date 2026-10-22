"""python3 scratchpad/iav2/client/test/mutants_res_delete.py - RES-01 R5 in the IA list Delete: each mutant of the BUILT list page
(Item Assembly & BOM/AsyncV2/IAlistPage.json, the ON build) must make test/test_lists.js fail (IA_LIST = the mutated copy)."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIST = os.path.join(HERE, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2", "IAlistPage.json")
J = lambda s: json.dumps(s)[1:-1]
# a 4th element = a marker that appears once: the mutant changes the first occurrence of its anchor after it (the list's on-open sweep
# also releases with RELEASE_ALL / LIST)
DELETE = J("// RES-01 (scratchpad/iasc/res01/RES01_PLAN.md): a Draft that reserves materials")
GATE = 'if (resOn && String(stored.material_hold_status || "") !== "") {'
MUTANTS = [
    ("no release at all", J("const resOn = /^[1-9][0-9]{0,19}$/.test(RES_HOLD);"), J("const resOn = false;")),
    ("the release skipped", J(GATE), J("if (false) {")),
    ("a never-reserving IA released", J(GATE), J("if (resOn) {")),
    ("the stored read unchanged", J('.field("item_assembly_status,material_hold_status,organization_id")'), J('.field("item_assembly_status")')),
    ("another operation", J('operation: "RELEASE_ALL"'), J('operation: "RECONCILE"'), DELETE),
    ("another source", J('operation: "RELEASE_ALL", source: "LIST"'), J('operation: "RELEASE_ALL", source: "FORM"'), DELETE),
    ("any code accepted", J('String(answer.code) !== "200" || '), ""),
    ("any status accepted", J(' || held !== "NONE")'), ")"),
    ("refused but the IA left deleted (review M4)", J('        await db.collection("sm_item_assembly").doc(row.id).update({ is_deleted: 0 });\n'), ""),
    ("a running reservation not waited for (review M4)", J('for (let i = 0; i < 3 && answer'), J('for (let i = 0; i < 0 && answer')),
    ("a Created IA deleted (Cancel, user 10-22)", J('const UNDELETABLE = ["Completed", "Fully Posted", "Processing", "Created"];'), J('const UNDELETABLE = ["Completed", "Fully Posted", "Processing"];')),
    ("refused but deleted", J("        this.refresh();\n        return;\n      }\n    }\n"), J("        this.refresh();\n      }\n    }\n")),
]
text = open(LIST, encoding="utf-8").read()
survived = 0
for m in MUTANTS:
    name, old, new = m[0], m[1], m[2]
    after = m[3] if len(m) > 3 else None
    if after is not None:
        i = text.find(old, text.find(after)) if text.count(after) == 1 else -1
        if i < 0:
            print("BROKEN mutant (marker or anchor not found): %s" % name)
            survived += 1
            continue
        mutated = text[:i] + new + text[i + len(old):]
    elif text.count(old) != 1:
        print("BROKEN mutant (anchor found %d times): %s" % (text.count(old), name))
        survived += 1
        continue
    else:
        mutated = text.replace(old, new, 1)
    fd, path = tempfile.mkstemp(prefix="ialist-mut-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(mutated)
    r = subprocess.run(["node", os.path.join(HERE, "test_lists.js")], env=dict(os.environ, IA_LIST=path, IA_EXPECT_ON="1"), capture_output=True, text=True, timeout=300)
    os.remove(path)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
