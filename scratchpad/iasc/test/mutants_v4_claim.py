"""python3 scratchpad/iasc/test/mutants_v4_claim.py - MIN-02 (BA 10-22) in IA_V2_SUBMIT: each mutant of the claim code (submit/claim_in.js and
the normal save's claim_row.js / claim_win.js that SUBMIT maps) is built into a temp folder and must make test/sim_submit_v4.js fail."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
MUTANTS = [
    ("shipped without the claim", "submit/claim_in.js", "const IA_CLAIM_ENABLED = true;", "const IA_CLAIM_ENABLED = false;"),
    # BA rev 1.2 C2: the submit's claim ends V2 (the background completion owns the effects), a loser's LOST
    ("C2: the submit's claim unmarked", "submit/claim_exit.js", 'rows(win.exitRows, "V2")', 'rows(win.exitRows, "")'),
    ("C2: a losing submit marked like a winner", "submit/claim_exit.js", 'rows(win.freeRows, "LOST")', 'rows(win.freeRows, "V2")'),
    ("a new IA claims", "submit/claim_in.js", 's(entry.action) === "DIRECT" && (stored === "Draft" || stored === "Created") && ', 's(entry.action) === "DIRECT" && '),
    ("a Created IA not claimed", "submit/claim_in.js", '(stored === "Draft" || stored === "Created")', '(stored === "Draft")'),
    ("a live rival ignored", "classic/claim_win.js", "if (!me || !first || s(first.name) !== s(me.name)) {", "if (!me) {"),
    ("a dead run's claim blocks for ever", "classic/claim_win.js", "< CL_LEASE_MS);", "< Infinity);"),
    ("the IA's change under the claim ignored", "classic/claim_win.js", 'if (s(storedStatus) !== "" && s(st.status) !== s(storedStatus)) {', "if (false) {"),
    ("the winner's claim never freed", "classic/claim_win.js", 'exitRows: free, needExit: "YES" };', 'exitRows: free, needExit: "NO" };'),
    ("the highest number not counted", "classic/claim_row.js", "const n = (parseInt(st.max, 10) || 0) + 1;", "const n = 1;"),
]
survived = 0
for name, rel, old, new in MUTANTS:
    tmp = tempfile.mkdtemp(prefix="sc-v4-mut-")
    code, out = os.path.join(tmp, "code"), os.path.join(tmp, "out")
    shutil.copytree(os.path.join(IASC, "code"), code)
    path = os.path.join(code, rel)
    text = open(path, encoding="utf-8").read()
    if text.count(old) != 1:
        print("BROKEN mutant (anchor not found once): " + name)
        survived += 1
        continue
    open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
    env = dict(os.environ, IASC_CODE=code, IASC_OUT=out)
    b = subprocess.run([sys.executable, os.path.join(IASC, "submit", "patch_v4.py"), "--write"], env=env, capture_output=True, text=True)
    if b.returncode:
        print("killed at build: " + name)
        shutil.rmtree(tmp, ignore_errors=True)
        continue
    r = subprocess.run(["node", os.path.join(HERE, "sim_submit_v4.js")], env=dict(os.environ, IA_V4=os.path.join(out, "IA_V2_SUBMIT.json")), capture_output=True, text=True)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
    shutil.rmtree(tmp, ignore_errors=True)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
