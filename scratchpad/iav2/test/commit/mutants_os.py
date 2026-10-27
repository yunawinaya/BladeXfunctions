"""python3 scratchpad/iav2/test/commit/mutants_os.py - the IA output split (plan 10-27) in IA_V2_COMMIT: each mutant of the BUILT
COMMIT (JSON text) must make test_steps.js or commit_sim.js fail (IAC_OUT = a folder holding the mutant)."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2")
BUILT = os.path.join(DIR, "IA_V2_COMMIT.json")
J = lambda s: json.dumps(s)[1:-1]
MUTANTS = [
    ("I1 decide: a receipt naming an unplanned batch accepted",
     J('    if (mvs.some((m) => keys.indexOf(batchKey(batchOf[s(m.movement_key)])) < 0)) bad.push('), J('    if (false) bad.push(')),
    ("I1 decide: a planned Batch row no receipt takes accepted",
     J('    if (keys.some((k) => !mvs.some((m) => batchKey(batchOf[s(m.movement_key)]) === k))) bad.push('), J('    if (false) bad.push(')),
    ("I1 check: every receipt re-PLANned on group 1's row",
     J('batch_id: ids[batchKey((d.batchOf || {})[s(m.movement_key)])] || null'), J('batch_id: ids[batchKey(idts[0].batch_number)] || null')),
    ("I1 / I3 answer: only R1's code read", J('const worst = (keys.length ? keys : ["R1"]).map('), J('const worst = ["R1"].map(')),
    ("I3 plan: every receipt on I1's first batch", J('const idOf = (m) => (batchOf ? s(ids[batchKey(batchOf[s(m.movement_key)])]) : s(entry.batchId));'),
     J('const idOf = (m) => s(entry.batchId);')),
    ("the job's Batch rows = I1's first only", J('const iaBatchIdsOf = (entry, more) => [entry, more].reduce((out, x) => out.concat(x && x.batchIds && typeof x.batchIds === "object" ? Object.values(x.batchIds) : [],'),
     J('const iaBatchIdsOf = (entry, more) => [entry, more].reduce((out, x) => out.concat([],')),
    ("entry end: only the intent's first identity searched", J('const intentsOf = (intent) => (Array.isArray(intent) ? intent : '), J('const intentsOf = (intent) => (Array.isArray(intent) ? intent.slice(0, 1) : ')),
    ("I0: the split left out of the fingerprint", J('  return split.length ? base.concat([split]) : base;'), J('  return base;')),
    # review 10-27
    ("I1 decide: the split intent cut at 2,000 characters", J('result_ref: JSON.stringify(idts) })];'), J('result_ref: JSON.stringify(idts).slice(0, 2000) })];')),
    ("I1: a refused receipt named R1", J('  const k = s(ans.r1Key) || "R1";'), J('  const k = "R1";')),
    ("I1: the engine's movements[i] read against R1 only", J('iaMapEngineMessage(s(ans.message), labels(), keys.length ? keys : ["R1"])'),
     J('iaMapEngineMessage(s(ans.message), labels(), ["R1"])')),
    ("I3: a refused receipt named R1", J('(s(ans.r1Key) || "R1") + " answered "'), J('"R1 answered "')),
    # one stock call per worker run (prod 10-26)
    ("I2: after op 1 phase B in the same run (SPLIT)", J("    const park = called || Math.max("), J("    const park = Math.max(")),
    ("WORKER: another job after a COMMIT call", J('const called = [{{node:code_node_IWmid.data.route}}][0] === \"PUBLISH\";'), J("const called = false;"), "IA_V2_WORKER.json"),
]
texts = {f: open(os.path.join(DIR, f), encoding="utf-8").read() for f in ("IA_V2_COMMIT.json", "IA_V2_WORKER.json")}
survived = 0
for m in MUTANTS:
    name, old, new = m[0], m[1], m[2]
    target = m[3] if len(m) > 3 else "IA_V2_COMMIT.json"
    text = texts[target]
    n = text.count(old)
    if n < 1:
        print("BROKEN mutant (anchor not found): " + name)
        survived += 1
        continue
    d = tempfile.mkdtemp(prefix="iac-mut-")
    for f, body in texts.items():
        open(os.path.join(d, f), "w", encoding="utf-8").write(body.replace(old, new) if f == target else body)
    env = dict(os.environ, IAC_OUT=d)
    killed = False
    for t in ("test_steps.js", "commit_sim.js", "worker_sim.js"):
        r = subprocess.run(["node", os.path.join(HERE, t)], env=env, capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            killed = True
            break
    if not killed:
        survived += 1
        print("SURVIVED: " + name + " (" + str(n) + " place(s))")
    else:
        print("killed   " + name + " (" + str(n) + " place(s), by " + t + ")")
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
