// node scratchpad/iatr/test/mutants_iatr_rules.js - each mutant of code/shared/iatr_rules.js must make test_iatr_rules.js fail
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "code", "shared", "iatr_rules.js");
const TEST = path.join(__dirname, "test_iatr_rules.js");
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["required_qty ignored", "if (!iatrBlank(l.required_qty)) qty = iatrQ8(l.required_qty);", "if (false) qty = iatrQ8(l.required_qty);"],
  ["explicit zero falls back to the reference", "    if (qty === 0) continue;\n", ""],
  ["the picked quantity used as demand", 'else return { ok: false, message: label + " has no required quantity', 'else if (iatrQ8(l.total_quantity) > 0) qty = iatrQ8(l.total_quantity); else return { ok: false, message: label + " has no required quantity'],
  ["non-stock lines requested", "    if (Number(it.stock_control) === 0) continue;\n", ""],
  ["serial components allowed", "    if (Number(it.serial_number_management) === 1) {", "    if (false) {"],
  ["negative allowed", "    if (qty < 0) return", "    if (false) return"],
  ["an unreadable item skipped", '    if (!it) return { ok: false, message: "The item of "', '    if (!it) continue; if (false) return { ok: false, message: "The item of "'],
  ["the stored lines never compared with the IA now", "  if (Array.isArray(c.demand)) {\n", "  if (false) {\n"],
  ["a missing demand line not noticed", "    if (c.demand.length !== st.length) return lines;\n", ""],
  ["the stored quantity not compared", " || iatrQ8(d.requested_qty) !== iatrQ8(l.requested_qty)\n", "\n"],
  ["the stored unit not compared", " || iatrId(d.quantity_uom) !== iatrId(l.quantity_uom)", ""],
  ["a mixed destination not noticed", "        || iatrId(l.storage_location_id) !== dest[0] || iatrId(l.location_id) !== dest[1]) return lines;", "        ) return lines;"],
  ["fingerprint without the destination", "iatrId(b.plant), iatrId(b.storage), iatrId(b.bin), iatrId(b.itemId)", "iatrId(b.plant), iatrId(b.itemId)"],
  ["fingerprint depends on line order", "  rows.sort((a, b2) => (a[0] < b2[0] ? -1 : a[0] > b2[0] ? 1 : 0));\n", ""],
  ["fingerprint without the output basis", "iatrId(b.itemId), qty(b.itemQty), qty(b.plannedQty), iatrS(b.mode), iatrId(b.bomId)]", "iatrId(b.itemId)]"],
  ["fingerprint: a blank planned output is zero", 'const qty = (v) => (iatrBlank(v) ? "" : iatrQ8(v).toFixed(8));', "const qty = (v) => iatrQ8(v).toFixed(8);"],
  ["fingerprint: the mode untrimmed", "iatrS(b.mode), iatrId(b.bomId)]", "String(b.mode), iatrId(b.bomId)]"],
  ["fingerprint without the BOM", "iatrS(b.mode), iatrId(b.bomId)]", "iatrS(b.mode)]"],
  ["fingerprint without line ids", "rows = (Array.isArray(demandLines) ? demandLines : []).map((l) => [iatrId(l.source_ia_line_id), ", "rows = (Array.isArray(demandLines) ? demandLines : []).map((l) => [\"\", "],
  ["IA status not checked", '  if (iatrS(c.iaStatus) !== "Draft") {', "  if (false) {"],
  ["stale IA not checked", "  if (iatrS(c.iaFp) !== iatrS(c.lotFp)) {", "  if (false) {"],
  ["a removed / added line allowed", "  if (st.length !== inc.length) return changed;\n", ""],
  ["the destination not part of the demand", '"source_ia_line_id", "storage_location_id", "location_id"]', '"source_ia_line_id"]'],
  ["requested quantity changes allowed", " || iatrQ8(l.requested_qty) !== iatrQ8(s.requested_qty)) return changed;", ") return changed;"],
  ["picks of another item allowed", "      if (iatrId(e.material_id || l.item_selection) !== iatrId(l.item_selection)) return", "      if (false) return"],
  ["picks in another unit allowed", "      if (!iatrBlank(e.material_uom) && iatrId(e.material_uom) !== iatrId(l.quantity_uom)) {", "      if (false) {"],
  ["HU picks allowed", '      if (iatrS(e.handling_unit_id) && iatrS(e.handling_unit_id) !== "0") return', "      if (false) return"],
  ["Blocked picks allowed", '      if ((iatrS(e.category) || "Unrestricted") !== "Unrestricted") {', "      if (false) {"],
  ["picks at the destination allowed", "      if (iatrId(e.location_id) === iatrId(l.location_id)) return", "      if (false) return"],
  ["short / excess allowed", "    if (Math.abs(sum - want) > 1e-9) {", "    if (false) {"],
  ["excess allowed", "    if (Math.abs(sum - want) > 1e-9) {", "    if (want - sum > 1e-9) {"],
  ["total_quantity trusted", "      sum = iatrQ8(sum + q);\n", "      sum = iatrQ8(l.total_quantity);\n"],
  ["Save Picks dispatches", '    if (saveAs === "Draft") return { decision: "SAVE", message: "" };', '    if (saveAs === "Draft") return { decision: "DISPATCH", message: "" };'],
  ["Requested + Completed allowed", '    return refuse("A Requested transfer is dispatched first', '    return { decision: "RECEIVE", message: "" }; refuse("A Requested transfer is dispatched first'],
  ["purpose In Progress edit allowed", '    return refuse("This dispatched request can\'t be edited', '    return { decision: "NONE", message: "" }; refuse("This dispatched request can\'t be edited'],
  ["payload claims trusted", "    if (claims) return refuse(", "    if (false) return refuse("],
  ["an orphan Requested passes", '    if (stored === "Requested") return refuse("This transfer is Requested but not', '    if (false) return refuse("This transfer is Requested but not'],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (base.split(from).length !== 2) {
    console.log("BROKEN mutant (anchor not found once): " + name);
    survived++;
    continue;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-mut-"));
  fs.mkdirSync(path.join(dir, "code", "shared"), { recursive: true });
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "code", "shared", "iatr_rules.js"), base.replace(from, to));
  fs.copyFileSync(TEST, path.join(dir, "test", "test_iatr_rules.js"));
  const r = spawnSync(process.execPath, [path.join(dir, "test", "test_iatr_rules.js")], { encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
