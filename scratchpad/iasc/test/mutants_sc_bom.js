// node scratchpad/iasc/test/mutants_sc_bom.js [outDir] - each mutant of sc_bom.js must make test_sc_bom.js fail
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "code", "shared", "sc_bom.js");
const TEST = path.join(__dirname, "test_sc_bom.js");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "sc-bom-mut-"));
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["default BOM ignored", "const d = (Number(b.parent_mat_is_default) === 1 ? 1 : 0) - (Number(a.parent_mat_is_default) === 1 ? 1 : 0);", "const d = 0;"],
  ["REF rows consumed", "filter((r) => r.consume_type !== \"REF\")", "filter((r) => true)"],
  ["serial ceil before q8", "return serial ? Math.ceil(q) : q;", "return serial ? scQ8(Math.ceil(amount)) : q;"],
  ["wastage ignored", "(1 + scNum(steps[i][1]) / 100)", "1"],
  ["conversion inverted", "return a > 0 && b > 0 ? b / a : null;", "return a > 0 && b > 0 ? a / b : null;"],
  ["unknown conversion = 1:1", "if (!c) return null;", "if (!c) return 1;"],
  ["cycle not detected", "if (ancestors.indexOf(code) >= 0) throw", "if (false) throw"],
  ["depth off by one", "if (depth >= maxDepth) throw", "if (depth > maxDepth) throw"],
  ["Flat rows not merged", "if (mode === \"STANDARD\") {\n        counts[base]", "if (true) {\n        counts[base]"],
  ["missing items tolerated", "if (missing.length) throw", "if (false) throw"],
  ["root conversion ignored", "rootConv = f1 / f2;", "rootConv = 1;"],
  ["Standard reads the tree", "if (mode === \"FLAT\") {\n      const seen", "if (true) {\n      const seen"],
  ["drift not checked", "Math.abs(scNum(l.requested_qty) - x.qty) > 0.0005", "false"],
  ["expanded consumption allowed", "if (hit) return { ok: false, code: \"SC_EXPANDED_CONSUMED\"", "if (false) return { ok: false, code: \"SC_EXPANDED_CONSUMED\""],
  ["header mismatch ignored", ".filter((d) => scS(d[1]) !== scS(d[2]))", ".filter((d) => false)"],
  ["ref_bom_id ignored", "if (scS(row.bom_type) === \"reference\" && scS(row.ref_bom_id)) {", "if (false) {"],
  ["empty child BOM allowed", "if (!scUsableRows(child).length) throw", "if (false) throw"],
  ["read errors swallowed", "throw scFail(\"SC_READ_FAILED\", \"The Bill of Materials could not be read", "return; throw scFail(\"SC_READ_FAILED\", \"The Bill of Materials could not be read"],
  ["tree ignores ref_bom_id", "const child = depth >= maxDepth ? null : f.refBomId ? own.filter((b) => scS(b.id) === f.refBomId)[0] || null : scPickBom(own);", "const child = depth >= maxDepth ? null : scPickBom(own);"],
  ["tree follows references at the root only", "          const refs = refsOf(usable);", "          const refs = {};"],
  ["tree names no BOM version", "version: child ? scS(child.parent_mat_bom_version) : \"\" });", "version: \"\" });"],
];
let survived = 0;
MUTANTS.forEach(([name, from, to], i) => {
  if (base.indexOf(from) < 0) {
    console.log("BROKEN mutant (anchor not found): " + name);
    survived++;
    return;
  }
  const file = path.join(OUT, "m" + i + ".js");
  fs.writeFileSync(file, base.replace(from, to));
  const r = spawnSync("node", [TEST], { env: Object.assign({}, process.env, { SC_BOM: file }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  }
});
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
