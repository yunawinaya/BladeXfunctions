// node scratchpad/iasc/test/mutants_sc_proj.js [outDir] - each mutant of sc_proj.js must make test_sc_proj.js fail
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "code", "shared", "sc_proj.js");
const TEST = path.join(__dirname, "test_sc_proj.js");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "sc-proj-mut-"));
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["deliveries and production both subtracted", "ordered - Math.max(delivered, produced) - open", "ordered - delivered - produced - open"],
  ["production ignored", "ordered - Math.max(delivered, produced) - open", "ordered - delivered - open"],
  ["excluded Draft still counted", "} else if (id && id === spS(inp.excludeIaId)) {", "} else if (false) {"],
  ["completed IA excludable", "if (SP_DONE[status]) {\n      row.role = \"produced\";", "if (SP_DONE[status] && id !== spS(inp.excludeIaId)) {\n      row.role = \"produced\";"],
  ["Processing not open", "const SP_OPEN = { Draft: 1, Created: 1, Processing: 1, Issued: 1 };", "const SP_OPEN = { Draft: 1, Created: 1, Issued: 1 };"],
  ["a Cancelled IA warned as unknown (Cancel, user 10-22)", "if (Number(x.is_deleted) === 1 || SP_VOID[status]) return row;", "if (Number(x.is_deleted) === 1) return row;"],
  ["Created not open (Created, BA 10-22)", "const SP_OPEN = { Draft: 1, Created: 1, Processing: 1, Issued: 1 };", "const SP_OPEN = { Draft: 1, Processing: 1, Issued: 1 };"],
  ["Fully Posted not produced", "const SP_DONE = { Completed: 1, \"Fully Posted\": 1 };", "const SP_DONE = { Completed: 1 };"],
  ["unknown conversion = 1:1", "if (!c) return null;", "if (!c) return 1;"],
  ["inactive SO still suggests", "const suggestion = unavailable ? null : active ? hi : 0;", "const suggestion = unavailable ? null : hi;"],
  ["outstanding_quantity trusted", "const delivered = lineLive ? spNum(line.delivered_qty) : 0;", "const delivered = lineLive ? spNum(line.so_quantity) - spNum(line.outstanding_quantity) : 0;"],
  ["undelivered not clamped", "undelivered: spQ8(Math.max(ordered - delivered, 0))", "undelivered: spQ8(ordered - delivered)"],
  ["organisation not checked", "else if (spS(inp.iaOrgId) && spS(header.organization_id) !== spS(inp.iaOrgId))", "else if (false)"],
  ["item not checked", "else if (itemMismatch) reason =", "else if (false) reason ="],
  ["reduction not warned", "else if (spNum(base.orderedQty) > ordered + 1e-9) warn(\"REDUCED\"", "else if (false) warn(\"REDUCED\""],
  ["deleted IAs counted", "if (Number(x.is_deleted) === 1 || SP_VOID[status]) return row;", "if (SP_VOID[status]) return row;"],
  ["excess ignores the proposal", "+ open + p - ordered", "+ open - ordered"],
  ["planned ignores planned_output_qty", "const plan = conv(spS(x.planned_output_qty) ? x.planned_output_qty : x.item_qty, x.item_uom);", "const plan = conv(x.item_qty, x.item_uom);"],
  ["candidates not filtered", "if (!p.eligibleNew) return;", ""],
  ["overlap never unavailable", 'active && lo !== hi ? "OVERLAP" : ""', '""'],
  ["the lower bound ignores production", "const lo = spQ8(Math.max(0, ordered - delivered - produced - open));", "const lo = spQ8(Math.max(0, ordered - delivered - open));"],
  ["excess never 'at least'", '(overlap ? "at least " : "")', '""'],
  ["excess marked exact under an overlap", "excessExact: !overlap", "excessExact: true"],
];
let survived = 0;
MUTANTS.forEach(([name, from, to], i) => {
  if (base.indexOf(from) < 0) {
    console.log("BROKEN mutant (anchor not found): " + name);
    survived++;
    return;
  }
  const file = path.join(OUT, "p" + i + ".js");
  fs.writeFileSync(file, base.replace(from, to));
  const r = spawnSync("node", [TEST], { env: Object.assign({}, process.env, { SC_PROJ: file }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  }
});
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
