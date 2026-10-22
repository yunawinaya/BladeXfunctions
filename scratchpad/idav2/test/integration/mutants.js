// node scratchpad/idav2/test/integration/mutants.js [--list] - e2e.js has teeth: each mutant breaks ONE cross-package interface in the
// in-memory copy of ONE built workflow's code bodies (IDA_E2E_MUTANT), runs the scenarios that cross that interface, and must make e2e
// fail (exit 1 with at least one FAIL line). --list only checks that every mutant's text is present exactly where it is aimed.
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const OUT = path.join(__dirname, "..", "..", "..", "..", "Item Disassembly", "AsyncV2");
const MUTANTS = [
  // SUBMIT -> PREPARE: a renamed request_payload key (CONTRACT section 3)
  { id: "M1 SUBMIT request key lineFingerprint renamed", wf: "IDA_V2_SUBMIT", from: "request.lineFingerprint = idaLineFingerprint(", to: "request.lineFp = idaLineFingerprint(", run: ["a"] },
  // PREPARE -> COMMIT: an alloc field (ENGINE_R part shape) renamed
  { id: "M2 ENGINE_R alloc share_qty renamed", wf: "IDA_V2_PREPARE", from: "share_qty: share, base_qty: baseQty,", to: "shareQty: share, base_qty: baseQty,", run: ["a"] },
  // PREPARE -> COMMIT: a manifest key renamed
  { id: "M3 manifest lineFingerprint renamed", wf: "IDA_V2_PREPARE", from: "lineFingerprint: s(req.lineFingerprint), batchMode:", to: "fingerprint: s(req.lineFingerprint), batchMode:", run: ["a"] },
  // PREPARE -> COMMIT / engine: the op key suffixes swapped (op 1 written under |R, op 2 under |I). Not "I" -> "X": the shared idaOpKey maps
  // every side but "R" to "I" (code/shared/ida_common.js), so that mutant is equivalent
  { id: "M4 op key suffixes I <-> R swapped", wf: "IDA_V2_PREPARE", from: 'const opI = idaOpKey(jobId, "I");\n  const opR = idaOpKey(jobId, "R");',
    to: 'const opI = idaOpKey(jobId, "R");\n  const opR = idaOpKey(jobId, "I");', run: ["a"] },
  // PREPARE -> COMMIT D1: a BATCH row's number field renamed (TYPED rows)
  { id: "M5 BATCH row batch_number renamed (TYPED)", wf: "IDA_V2_PREPARE", from: 'kind: "TYPED", insert: true, batch_number: idaPlanText(l.batch_number)', to: 'kind: "TYPED", insert: true, number: idaPlanText(l.batch_number)', run: ["b"] },
  // COMMIT -> WORKER: the SPLIT hand-over renamed
  { id: "M6 COMMIT SPLIT| lease owner renamed", wf: "IDA_V2_COMMIT", from: '"SPLIT|" +', to: '"SPLITX|" +', run: ["a"] },
  // COMMIT D4 -> the posting / the list: posted_status
  { id: "M7 D4 posted_status Unposted -> Posted", wf: "IDA_V2_COMMIT", from: 'posted_status: "Unposted"', to: 'posted_status: "Posted"', run: ["a"] },
  // PREPARE ENGINE_I -> COMMIT OUT_TOTALS: the movements' transaction_type
  { id: "M8 ENGINE_I transaction_type IDA -> IDAX", wf: "IDA_V2_PREPARE", from: 'material_uom: s(prep.material_uom), transaction_type: "IDA"', to: 'material_uom: s(prep.material_uom), transaction_type: "IDAX"', run: ["a"] },
  // the classic v7's guard vs V2's Processing lock
  { id: "M9 v7 guard ignores Processing", wf: "IDA_SAVE", from: '"Processing"', to: '"Processing-x"', node: "code_node_IDAguardStored", run: ["e"] },
  // SUBMIT -> the lock sequence the WORKER / PREPARE / COMMIT own by (a stored Draft's LOCK|n+1)
  { id: "M10 SUBMIT stored-Draft lock always LOCK|1", wf: "IDA_V2_SUBMIT", from: 'step_name: "LOCK|" + num(entry.lockN)', to: 'step_name: "LOCK|1"', run: ["c"] },
  // COMMIT D3 -> the engine: the receipt's batch id (oursByKey) dropped
  { id: "M11 D3 sends no batch_id", wf: "IDA_V2_COMMIT", from: "if (s(a.batch_key)) o.batch_id = byKey[s(a.batch_key)];", to: "if (false) o.batch_id = byKey[s(a.batch_key)];", run: ["b"] },
  // COMMIT D1 rows 6 / 10: no renumber (the live 10-21 race: both jobs FAILED IDA_BATCH_DUPLICATE)
  { id: "M12 D1 renumber off", wf: "IDA_V2_COMMIT", from: "const IDA_BATCH_RENUMBER_TRIES = 5;", to: "const IDA_BATCH_RENUMBER_TRIES = 0;", run: ["i"] },
  // COMMIT D1 row 4: a newer holder fails at once again (X FAILED although Y completed)
  { id: "M13 D1 row 4 renumber off", wf: "IDA_V2_COMMIT", from: "if (d1CanRenumberNew(entry, taken, holders)) return", to: "if (false) return", run: ["i2"] },
];
function present(mu) {
  const doc = JSON.parse(fs.readFileSync(path.join(OUT, mu.wf + ".json"), "utf8"));
  let hits = 0;
  const walk = (ns) => (ns || []).forEach((n) => {
    for (const where of [n.data && n.data.script, n.data && n.data.expression]) if (where && typeof where.code === "string" && (!mu.node || n.id === mu.node)) hits += where.code.split(mu.from).length - 1;
    walk(n.blocks);
  });
  walk(doc.nodes);
  return hits;
}
const listOnly = process.argv.indexOf("--list") >= 0;
let caught = 0;
const rows = [];
for (const mu of MUTANTS) {
  const hits = present(mu);
  if (listOnly) {
    console.log((hits ? "found x" + hits + " " : "MISSING ") + mu.id);
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--max-old-space-size=8192", path.join(__dirname, "e2e.js")].concat(mu.run), { encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    env: Object.assign({}, process.env, { IDA_E2E_MUTANT: JSON.stringify(mu), TZ: "Asia/Kuala_Lumpur" }) });
  const out = r.stdout || "";
  const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
  const ok = r.status === 1 && fails.length > 0 && out.indexOf("MUTANT ") >= 0;
  if (ok) caught++;
  rows.push({ id: mu.id, caught: ok, fails: fails.length, first: fails[0] ? fails[0].slice(5, 200) : "", hits: hits, seconds: (Date.now() - t0) / 1000 });
  console.log((ok ? "CAUGHT " : "MISSED ") + mu.id + " (x" + hits + ")" + (ok ? " - " + fails.length + " failing check(s), first: " + fails[0].slice(5, 170) : " (exit " + r.status + ")\n" + (out + (r.stderr || "")).slice(-700)));
}
if (!listOnly) {
  console.log(caught + "/" + MUTANTS.length + " mutants caught");
  if (process.argv.indexOf("--json") >= 0) fs.writeFileSync(process.argv[process.argv.indexOf("--json") + 1], JSON.stringify(rows, null, 1));
  process.exit(caught === MUTANTS.length ? 0 : 1);
}
