// The cell comparison of SO Save V2 (the "SO Save V2 rules" block): a datetime is the same value with or without
// ".000" or a midnight time, so an unchanged line is not rewritten; everything else compares as before. Also: every copy
// of the block in PREPARE and COMMIT is the same text.
//   node scratchpad/sosave_perf/test/test_canon.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const START = "// ---- SO Save V2 rules";
const END = "// ---- SO_SAVE_PREPARE";
const codeNodes = (file) => {
  const out = [];
  const walk = (ns) => ns.forEach((n) => { if (n.type === "code-node") out.push(n); walk(n.blocks || []); });
  // before trimming: every copy of the block is whole there (out/ keeps only what each node uses)
  walk(JSON.parse(fs.readFileSync(path.join(ROOT, "out", "preshake", file), "utf8")).nodes);
  return out;
};
// the rules block: from its marker to the next "// ---- " section
const rulesOf = (code) => {
  const i = code.indexOf(START);
  if (i < 0) return null;
  const j = code.indexOf("\n// ---- ", i + START.length);
  return code.slice(i, j < 0 ? code.length : j);
};

let fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + (detail || "")}`);
  if (!ok) fail++;
};

const plan = codeNodes("SO_SAVE_PREPARE.json").find((n) => n.id === "code_node_SPplan").data.script.code;
const rules = rulesOf(plan);
const lib = new Function(rules + "\nreturn { soCanonText, soSameCol };")();
// a text (non-numeric) line column, as PREPARE compares so_shipping_date
const same = (a, b) => lib.soSameCol("line", "so_shipping_date", a, b);

check("'2026-10-20 00:00:00' = '2026-10-20 00:00:00.000'", same("2026-10-20 00:00:00", "2026-10-20 00:00:00.000") === true);
check("'2026-10-20' = '2026-10-20 00:00:00'", same("2026-10-20", "2026-10-20 00:00:00") === true);
check("'2026-10-20T08:30:00.000' = '2026-10-20 08:30:00'", same("2026-10-20T08:30:00.000", "2026-10-20 08:30:00") === true);
check("a real date change is a change: 10-20 vs 10-21.000", same("2026-10-20 00:00:00", "2026-10-21 00:00:00.000") === false);
check("a real time change is a change: 00:00:00.500 vs 00:00:00", same("2026-10-20 00:00:00.500", "2026-10-20 00:00:00") === false);
check("text stays case-sensitive: 'ABC' vs 'abc'", same("ABC", "abc") === false);
check("JSON text still equals its value: '[1,2]' vs [1,2]", same("[1,2]", [1, 2]) === true);
check("blank still equals null", same("", null) === true);
check("a date is not equal to blank", same("2026-10-20 00:00:00", null) === false);

// every copy of the block, in PREPARE and COMMIT, is the same text
const copies = [];
for (const file of ["SO_SAVE_PREPARE.json", "SO_SAVE_COMMIT.json"]) {
  for (const n of codeNodes(file)) {
    const r = rulesOf(n.data.script.code);
    if (r !== null) copies.push({ file, id: n.id, r });
  }
}
const distinct = new Set(copies.map((c) => c.r));
check(`${copies.length} copies of the rules block (16 PREPARE + 12 COMMIT)`, copies.length === 28, `found ${copies.length}`);
check("every copy is the same text", distinct.size === 1, `${distinct.size} variants`);

console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
