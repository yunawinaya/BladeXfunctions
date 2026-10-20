"""python3 scratchpad/iasc/test/mutants_v4.py - each mutant of the IA_V2_SUBMIT v4 Small Cycle glue (code/submit), plus three of the shared
check, is built into a temp folder and must make test/sim_submit_v4.js fail (the shared scClassicCheck is mutation-tested through IA_SAVE
v13, test/mutants_v13.py). scIn's
tenantId is not mutated here: v4's SQL takes the tenant from SUBMIT's own guard (an equivalent mutant)."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
MUTANTS = [
    ("stored / line rows dropped", "submit/sc_check.js", "rows: [{{node:sql_node_ISsc.data}}][0]", "rows: []"),
    ("completion treated as a Draft", "submit/sc_check.js", "saveAs: \"Completed\"", "saveAs: \"Draft\""),
    ("the form's record instead of the gate's", "submit/sc_check.js", "allData: [{{node:code_node_ISgate.data.allData}}][0]", "allData: {}"),
    ("Edit not detected", "submit/sc_in.js", "pageStatus: g.pageStatus,", "pageStatus: \"Add\","),
    # the shared check through SUBMIT too: re-linking a stored Draft and the item rule (review 10-20, #5 / #6)
    ("an Edit moving the link skips the new-link checks", "shared/sc_check.js", 'const isNew = sin.edit !== "YES" || out.source_so_line_id !== storedLine;', 'const isNew = sin.edit !== "YES";'),
    ("RELINK recorded as LINK", "shared/sc_check.js", 'op: storedLine ? "RELINK" : "LINK"', 'op: "LINK"'),
    ("an SO-side item change refused", "shared/sc_check.js", "} else if (stored && scS(stored.item_id) && scS(stored.item_id) !== scS(a.item_id)) {",
     "} else if ((stored && scS(stored.item_id) && scS(stored.item_id) !== scS(a.item_id)) || (line && scS(line.item_name) !== scS(a.item_id))) {"),
]
survived = 0
for name, rel, old, new in MUTANTS:
    tmp = tempfile.mkdtemp(prefix="sc-v4-mut-")
    code, out = os.path.join(tmp, "code"), os.path.join(tmp, "out")
    shutil.copytree(os.path.join(IASC, "code"), code)
    path = os.path.join(code, rel)
    text = open(path).read()
    if old not in text:
        print("BROKEN mutant (anchor not found): " + name)
        survived += 1
        continue
    open(path, "w").write(text.replace(old, new, 1))
    env = dict(os.environ, IASC_CODE=code, IASC_OUT=out)
    b = subprocess.run([sys.executable, os.path.join(IASC, "submit", "patch_v4.py"), "--write"], env=env, capture_output=True, text=True)
    if b.returncode:
        print("killed at build: " + name)
        continue
    r = subprocess.run(["node", os.path.join(HERE, "sim_submit_v4.js")], env=dict(os.environ, IA_V4=os.path.join(out, "IA_V2_SUBMIT.json")), capture_output=True, text=True)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
    shutil.rmtree(tmp, ignore_errors=True)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
