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
  ["depth off by one", "if (depth >= maxDepth) throw", "if (depth > maxDepth) throw"],
  ["Flat rows not merged", "if (mode === \"STANDARD\") {\n        counts[base]", "if (true) {\n        counts[base]"],
  ["missing items tolerated", "if (missing.length) throw", "if (false) throw"],
  ["root conversion ignored", "rootConv = f1 / f2;", "rootConv = 1;"],
  ["Standard reads the tree", "if (mode === \"FLAT\") {\n      // every place a component sits", "if (true) {\n      // every place a component sits"],
  // one choice per place (the BA, 10-27)
  ["per place ignored (item ticks always)", "const isTicked = (code, key) => (places ? !!tickedAt[key] || (!exact && !!tickedAt[scPlainKey(key)]) : !!ticked[code]);",
    "const isTicked = (code, key) => !!ticked[code] || !!tickedAt[code];"],
  ["expand = every item expanded somewhere", "order.filter((id) => reached[id][1] > 0 && reached[id][1] === reached[id][0])", "order.filter((id) => reached[id][1] > 0)"],
  ["a loop inside an expanded place not stopped", "if (mode === \"FLAT\" && depth > 1 && ancestors.indexOf(code) >= 0) {", "if (false) {"],
  ["the tree in level order", "      visit(\"\");\n", "      listed.forEach((x) => tree.push(x));\n"],
  ["a place keyed without the places above it", "key: (parent ? parent.key + \">\" : \"\") + scSegs(rows)[i]", "key: scSegs(rows)[i]"],
  ["expandAt not saved", "expandAt: expandedAt, expandAtV: 2, boms: boms", "expandAt: [], expandAtV: 2, boms: boms"],
  ["a place whose BOM loops back offered", "          else if (back) reason = ", "          else if (false) reason = "],
  ["duplicate lines share one place", "    return n[id] > 1 ? id + \"#\" + k[id] : id;", "    return id;"],
  ["an older snapshot's plain keys not matched", " || (!exact && !!tickedAt[scPlainKey(key)])", ""],
  ["line keys exact for an older snapshot too", "  const exact = Number(inp.expandAtV) === 2;", "  const exact = true;"],
  ["drift not checked", "Math.abs(scNum(l.requested_qty) - x.qty) > 0.0005", "false"],
  ["expanded consumption allowed", "if (hit) return { ok: false, code: \"SC_EXPANDED_CONSUMED\"", "if (false) return { ok: false, code: \"SC_EXPANDED_CONSUMED\""],
  ["header mismatch ignored", ".filter((d) => scS(d[1]) !== scS(d[2]))", ".filter((d) => false)"],
  ["ref_bom_id ignored", "if (scS(row.bom_type) === \"reference\" && scS(row.ref_bom_id)) {", "if (false) {"],
  ["empty child BOM allowed", "if (!scUsableRows(child).length) throw", "if (false) throw"],
  ["read errors swallowed", "throw scFail(\"SC_READ_FAILED\", \"The Bill of Materials could not be read", "return; throw scFail(\"SC_READ_FAILED\", \"The Bill of Materials could not be read"],
  ["tree ignores ref_bom_id", "const child = depth >= maxDepth || loops ? null : f.refBomId ? own.filter((b) => scS(b.id) === f.refBomId)[0] || null : scPickBom(own);", "const child = depth >= maxDepth || loops ? null : scPickBom(own);"],
  ["tree follows references at the root only", "refBomId: scS(r.bom_type) === \"reference\" ? scS(r.ref_bom_id) : \"\",", "refBomId: !parent && scS(r.bom_type) === \"reference\" ? scS(r.ref_bom_id) : \"\","],
  ["tree names no BOM version", "version: child ? scS(child.parent_mat_bom_version) : \"\", uses: 1,", "version: \"\", uses: 1,"],
  ["tree: a place's parent named wrong", "parents: [nameOf(f.parentItemId)],", "parents: [nameOf(itemId)],"],
  ["tree: a place's version not listed", "versions: child ? [scS(child.parent_mat_bom_version)] : [] });", "versions: [] });"],
  ["tree: the places under a place not listed", "          placesOf(usable, f).forEach((x) => next.push(x));\n", ""],
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
