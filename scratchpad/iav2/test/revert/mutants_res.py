"""python3 scratchpad/iav2/test/revert/mutants_res.py - RES-01 R5 in the reverts: each mutant of a BUILT workflow (JSON text of the classic
IA_REVERT v6, IA_REVERT_V2_PREPARE or _COMMIT) must make test/revert/classic_sim.js fail (IARV_OUT = a copy of the built folder)."""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2")
J = lambda s: json.dumps(s)[1:-1]
MUTANTS = [
    ("classic: open holds ignored", "IA_REVERT", J("const open = due && (!st"), J("const open = false && (!st")),
    ("classic: a live ticket ignored", "IA_REVERT", J("Number(st.live) > 0 || (Array.isArray"), J("false || (Array.isArray")),
    ("classic: Reserved comes back Reserved", "IA_REVERT", J("const out = resRevertAdds(adds, "), J("const out = adds || (adds, ")),
    ("classic: never marked RESERVING", "IA_REVERT", '"value": "RESERVING"', '"value": "FULL"'),
    ("classic: a never-reserving IA checked", "IA_REVERT", J('const due = hold !== "" && [id, org, tenant]'), J("const due = [id, org, tenant]")),
    ("V2: open holds ignored", "IA_REVERT_V2_PREPARE", J("if (hold && (Number(resRead.live) > 0 || iaList(resRead.rows).length > 0)) {"), J("if (false) {")),
    ("V2: Reserved comes back Reserved", "IA_REVERT_V2_PREPARE", J("const adds = resRevertAdds(built, hold, resRead ? iaList(resRead.delivered) : [], resRevertBound(moves, e.iaId), R.items);"),
     J("const adds = built;")),
    ("classic: this cycle's Delivered rows ignored (review I3)", "IA_REVERT", J("st && Array.isArray(st.delivered) ? st.delivered : []"), J("[]")),
    ("V2: no mark planned", "IA_REVERT_V2_PREPARE", J('mark: hold ? "RESERVING" : ""'), J('mark: ""')),
    ("V2: the mark not written", "IA_REVERT_V2_COMMIT", J('const mark = s(h.mark) === "RESERVING" ? {'), J('const mark = false ? {')),
]
survived = 0
for name, wf, old, new in MUTANTS:
    path = os.path.join(SRC, wf + ".json")
    text = open(path, encoding="utf-8").read()
    if text.count(old) != 1:
        print("BROKEN mutant (anchor found %d times): %s" % (text.count(old), name))
        survived += 1
        continue
    d = tempfile.mkdtemp(prefix="iarv-mut-")
    for f in os.listdir(SRC):
        if f.endswith(".json"):
            shutil.copy(os.path.join(SRC, f), d)
    open(os.path.join(d, wf + ".json"), "w", encoding="utf-8").write(text.replace(old, new, 1))
    r = subprocess.run(["node", os.path.join(HERE, "classic_sim.js")], env=dict(os.environ, IARV_OUT=d), capture_output=True, text=True, timeout=900)
    shutil.rmtree(d, ignore_errors=True)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
