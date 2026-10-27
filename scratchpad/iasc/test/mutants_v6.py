"""python3 scratchpad/iasc/test/mutants_v6.py - each mutant of IA_V2_SUBMIT v6's output split (submit/patch_v6.py) edits the built
IA_V2_SUBMIT.json and must make test/sim_submit_v4.js (its v6 cases) fail."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
J = lambda s: json.dumps(s)[1:-1]
MUTANTS = [
    ("the split's rows not checked", J('  if (oc.route === "STOP") return out("STOP", "400", oc.message, "IA_OS_INVALID");\n'), ""),
    ("the merge's guard ignored", J('  if (om.route === "STOP") return out("STOP", "400", om.message, "IA_OS_INVALID");\n'), ""),
    ("a split row's duplicate balance not screened", J('    if (oc.output_split.some((r) => dup["B|" + parentId + "|" + r.os_location_id + "|"])) return'), J("    if (false) return")),
    ("row 1 not copied into the header", J("    Object.assign(a, osHeader(oc.output_split, a, oc.kind));\n"), ""),
    ("movementCount without the receipts", J("    base.movementCount = picks.length + oc.output_split.length;\n"), ""),
    ("the date rule not per group", J("    const msg = osSplit ? oc.genGroups.map((g) => {"), J("    const msg = osSplit ? [].map((g) => {")),
    ("the single GENERATE_BATCH also for a split", J("  const one = needBatch && !osSplit;"), J("  const one = needBatch;")),
    ("the dup tuples without the split's bins", J(".concat(osBins.map((b) => [parent, b]))"), ""),
    ("the split's read never runs", J("  const osRead = osRows.length > 0 ||"), J("  const osRead = false &&")),
    ("the stored rows not read for an old tab", J('osIaId: osEdit ? s(guard.iaId) : "0"'), J('osIaId: "0"')),
    ("the numbers not on the stored rows", J("const rows = res.output_split || [];"), J("const rows = [{{node:code_node_ISgate.data.osRows}}][0] || [];")),
    ("the header's batch_no not row 1's number", J(": s(gate.osBatchNo);"), J(': "";')),
    ("the Add does not store the rows", '"value": "{{node:code_node_ISosFinal.data.output_split}}"', '"value": ""'),
    ("the header read without the split", J("'ia_v2_job_id', h.ia_v2_job_id, 'output_split', h.output_split) AS j"), J("'ia_v2_job_id', h.ia_v2_job_id) AS j")),
    ("the link's fingerprint without the split", J("  return split.length ? base.concat([split]) : base;"), J("  return base;")),
    ("GENERATE_BATCH per group without the organization", '"value": "{{node:code_node_ISgate.data.organizationId}}"', '"value": ""'),
]
out = tempfile.mkdtemp(prefix="sc-v6-mut-")
b = subprocess.run([sys.executable, os.path.join(IASC, "submit", "patch_v6.py"), "--write"], env=dict(os.environ, IASC_OUT=out), capture_output=True, text=True)
assert b.returncode == 0, b.stderr[-800:]
built = os.path.join(out, "IA_V2_SUBMIT.json")
base = open(built).read()
survived = 0
for name, old, new in MUTANTS:
    n = base.count(old)
    if n < 1:
        print("BROKEN mutant (anchor not found): " + name)
        survived += 1
        continue
    f = os.path.join(tempfile.mkdtemp(prefix="sc-v6-m-"), "IA_V2_SUBMIT.json")
    open(f, "w").write(base.replace(old, new, 1))
    r = subprocess.run(["node", os.path.join(HERE, "sim_submit_v4.js")], env=dict(os.environ, IA_V4=f), capture_output=True, text=True)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name + " (%d place(s), the first mutated)" % n)
    else:
        print("killed   " + name)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
