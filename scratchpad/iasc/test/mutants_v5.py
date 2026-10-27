"""python3 scratchpad/iasc/test/mutants_v5.py - each mutant of IA_V2_SUBMIT v5's output split gate (submit/patch_v5.py's helper) edits the
built IA_V2_SUBMIT.json and must make test/sim_submit_v4.js (its v5 cases) fail."""
import os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
MUTANTS = [
    ("a split never ineligible", 'return Array.isArray(v) && v.length > 0 ? \\"its output is split across bins\\" : \\"\\";', 'return \\"\\";'),
    ("the split rows' JSON text not read", "v = JSON.parse(v);", "v = null;"),
    ("the gate never asks", "|| iaOsIneligible(r.allData);", ";"),
]
out = tempfile.mkdtemp(prefix="sc-v5-mut-")
b = subprocess.run([sys.executable, os.path.join(IASC, "submit", "patch_v5.py"), "--write"], env=dict(os.environ, IASC_OUT=out), capture_output=True, text=True)
assert b.returncode == 0, b.stderr[-800:]
built = os.path.join(out, "IA_V2_SUBMIT.json")
base = open(built).read()
survived = 0
for name, old, new in MUTANTS:
    if old not in base:
        print("BROKEN mutant (anchor not found): " + name)
        survived += 1
        continue
    f = os.path.join(tempfile.mkdtemp(prefix="sc-v5-m-"), "IA_V2_SUBMIT.json")
    open(f, "w").write(base.replace(old, new, 1))
    r = subprocess.run(["node", os.path.join(HERE, "sim_submit_v4.js")], env=dict(os.environ, IA_V4=f), capture_output=True, text=True)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
