// node scratchpad/iav2/test/integration/mutants.js - e2e.js has teeth: each mutant breaks ONE cross-package interface in the
// in-memory build of one workflow (a code body), and e2e.js must fail (exit 1, at least one FAIL line).
const path = require("path");
const { spawnSync } = require("child_process");
const MUTANTS = [
  { id: "SUBMIT->PREPARE request key lineFingerprint", wf: "IA_V2_SUBMIT", from: "request.lineFingerprint = iaLineFingerprint(", to: "request.lineFp = iaLineFingerprint(" },
  { id: "PREPARE->COMMIT part name ENGINE_R", wf: "IA_V2_PREPARE", from: 'const IA_PLAN_PARTS = ["ENGINE_I", "ENGINE_R",', to: 'const IA_PLAN_PARTS = ["ENGINE_I", "ENGINE_RX",' },
  { id: "PREPARE->COMMIT ENGINE_R.receiptBaseQty", wf: "IA_V2_PREPARE", from: "receiptBaseQty: receiptBaseQty,", to: "receiptBase: receiptBaseQty," },
  { id: "COMMIT->WORKER SPLIT| hand-over", wf: "IA_V2_COMMIT", from: 'lease_owner: "SPLIT|" + guard.nonce', to: 'lease_owner: "SPLITX|" + guard.nonce' },
  { id: "COMMIT I3 price ignores ENGINE_R.assemblyCost", wf: "IA_V2_COMMIT", from: "receiptBaseQty: eng.receiptBaseQty, assemblyCost: eng.assemblyCost", to: "receiptBaseQty: eng.receiptBaseQty, assemblyCost: 0" },
  { id: "COMMIT I4 posted_status the revert reads", wf: "IA_V2_COMMIT", from: 'posted_status: "Unposted"', to: 'posted_status: "Posted"' },
  { id: "REVERT SUBMIT on the shared IAC| lock sequence", wf: "IA_REVERT_V2_SUBMIT", from: 'step_name: "LOCK|" + num(entry.lockN)', to: 'step_name: "LOCK|1"' },
  // the receipt's movement type (A's ENGINE_R) is what the revert's RV_MOVES pairs (F)
  { id: "PREPARE ENGINE_R transaction_type -> the revert's live rows", wf: "IA_V2_PREPARE", from: 'transaction_type: "IA", trx_no: iaPlanText(r.trx_no)',
    to: 'transaction_type: "IA-X", trx_no: iaPlanText(r.trx_no)' },
  // ruling 10 across packages: the classic revert's cap back on live rows (R1); PREPARE's unlinked FAILED without the link (R8)
  { id: "R1 v5 cap counted on live rows again", wf: "IA_REVERT", from: "const tooBig = !refused && picks > CAP ? 1 : 0;", to: "const tooBig = !refused && liveRows > CAP ? 1 : 0;" },
  { id: "R8 PREPARE's unlinked FAILED without its link", wf: "IA_V2_PREPARE", from: "const linked = link && s(link.correlation_id) ?", to: "const linked = false ?" },
];
// not a mutant here: dropping IA_REVERT_V2_SUBMIT's open-jobs BUSY - the stored-Processing check answers the same BUSY (defense in depth)
let caught = 0;
for (const mu of MUTANTS) {
  const r = spawnSync("node", [path.join(__dirname, "e2e.js")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: Object.assign({}, process.env, { IA_E2E_MUTANT: JSON.stringify(mu) }) });
  const out = r.stdout || "";
  const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
  const ok = r.status === 1 && fails.length > 0 && out.indexOf("MUTANT ") >= 0;
  if (ok) caught++;
  console.log((ok ? "CAUGHT " : "MISSED ") + mu.id + (ok ? " - " + fails.length + " failing check(s), first: " + fails[0].slice(5, 150) : " (exit " + r.status + ")\n" + out.slice(-600)));
}
console.log(caught + "/" + MUTANTS.length + " mutants caught");
process.exit(caught === MUTANTS.length ? 0 : 1);
