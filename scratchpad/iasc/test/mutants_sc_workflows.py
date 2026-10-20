"""python3 scratchpad/iasc/test/mutants_sc_workflows.py - each mutant of the projection / relink glue (code/projection, code/relink)
is built into a temp folder and must make test/sim_sc_workflows.js fail."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
MUTANTS = [
    ("projection: no tenant check", "projection/guard.js", "if (!digits(inp.tenantId)) return bad(\"no session tenant\");", ""),
    ("projection: line id unchecked", "projection/guard.js", "if (op === \"SUMMARY\" && !digits(inp.so_line_id)) return bad(\"so_line_id: digits only\");", ""),
    ("projection: organisation unchecked", "projection/guard.js", "if (!digits(inp.organization_id)) return bad(\"organization_id: digits only\");", ""),
    ("projection: exclusion dropped", "projection/summary.js", "excludeIaId: g.exclude,", "excludeIaId: \"\","),
    ("projection: proposal dropped", "projection/summary.js", "proposal: g.proposal,", "proposal: null,"),
    ("projection: baseline dropped", "projection/summary.js", "baseline: g.baseline,", "baseline: null,"),
    ("projection: relink candidates dropped", "projection/summary.js", "candidates: spRows([{{node:sql_node_SPrelink.data}}][0])", "candidates: []"),
    ("relink: Processing allowed", "relink/check.js", "if (status === \"Processing\") return stop(", "if (false) return stop("),
    ("relink: Draft allowed", "relink/check.js", "if (status === \"Draft\") return stop(", "if (false) return stop("),
    ("relink: live old line allowed", "relink/check.js", "if (Number(ia.old_line_live) > 0) return stop(", "if (false) return stop("),
    ("relink: other SO allowed", "relink/check.js", "if (spS(line.sales_order_id) !== spS(ia.source_so_id)) return stop(", "if (false) return stop("),
    ("relink: other item allowed", "relink/check.js", "if (spS(line.item_name) !== spS(ia.item_id)) return stop(", "if (false) return stop("),
    ("relink: history not kept", "relink/check.js", "(Array.isArray(old.history) ? old.history : [])", "[]"),
    ("relink: id unchecked", "relink/guard.js", "const wrong = [\"ia_id\", \"so_line_id\", \"item_id\", \"organization_id\"]", "const wrong = [\"so_line_id\", \"item_id\", \"organization_id\"]"),
    ("projection: another organisation's line shows its figures", "projection/summary.js", "if (lh.header && spS(lh.header.organization_id) !== spS(g.org)) {", "if (false) {"),
]
survived = 0
for name, rel, old, new in MUTANTS:
    tmp = tempfile.mkdtemp(prefix="sc-wf-mut-")
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
    b = subprocess.run([sys.executable, os.path.join(IASC, "build_sc.py"), "--write"], env=env, capture_output=True, text=True)
    if b.returncode:
        print("killed at build: " + name)
        continue
    r = subprocess.run(["node", os.path.join(HERE, "sim_sc_workflows.js"), out], capture_output=True, text=True)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
    shutil.rmtree(tmp, ignore_errors=True)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
