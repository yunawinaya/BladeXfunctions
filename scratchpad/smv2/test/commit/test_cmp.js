// node test/commit/test_cmp.js - sameVal / sameStored (code/commit/_cmp.js), loaded the way build_commit.py concatenates a
// COMMIT code node (lot_common.js, _common.js, _cmp.js); then the built LOT_V2_COMMIT.json must carry this _cmp.js.
const fs = require("fs");
const path = require("path");
const CODE = path.join(__dirname, "..", "..", "code");
const read = (p) => fs.readFileSync(path.join(CODE, p), "utf8");
const common = read("shared/lot_common.js").split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const cmp = read("commit/_cmp.js");
const { sameVal, sameStored } = new Function([common, read("commit/_common.js"), cmp, "return { sameVal, sameStored };"].join("\n"))();

let fails = 0;
const check = (label, got, want) => {
  if (got !== want) fails++;
  console.log((got === want ? "ok   " : "FAIL ") + label + (got === want ? "" : " -> " + got));
};
// numeric text of 16+ characters compares as a number once its fraction's trailing zeros are gone
check("1234567.5 == '1234567.50000000'", sameVal(1234567.5, "1234567.50000000"), true);
check("'1234567.50000000' == 1234567.5", sameVal("1234567.50000000", 1234567.5), true);
check("'1234567.50000000' == '1234567.5'", sameVal("1234567.50000000", "1234567.5"), true);
check("12345678.12345678 == '12345678.12345678'", sameVal(12345678.12345678, "12345678.12345678"), true);
check("1234567.5 != '1234567.60000000'", sameVal(1234567.5, "1234567.60000000"), false);
check("0.1 + 0.2 == '0.30000000'", sameVal(0.1 + 0.2, "0.30000000"), true);
check("12 == '12.00000000'", sameVal(12, "12.00000000"), true);
check("sameStored(1234567.5, '1234567.50000000')", sameStored(1234567.5, "1234567.50000000"), true);
// long digit-only ids stay exact text
check("id text == same id text", sameVal("2105231525751984129", "2105231525751984129"), true);
check("id text != neighbour id", sameVal("2105231525751984129", "2105231525751984128"), false);
check("id text != the rounded NUMBER", sameVal("2105231525751984129", 2105231525751984129), false);
check("short text exact", sameVal("Processing", "In Progress"), false);
check("nothing == nothing", sameVal(null, ""), true);

const built = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_COMMIT.json"), "utf8"));
const scripts = [];
const walk = (n) => {
  if (Array.isArray(n)) n.forEach(walk);
  else if (n && typeof n === "object") {
    if (n.type === "code-node" && n.data && n.data.script && /const sameVal = /.test(n.data.script.code)) scripts.push(n.data.script.code);
    Object.values(n).forEach(walk);
  }
};
walk(built);
check("built COMMIT: every sameVal is this _cmp.js (" + scripts.length + " nodes)", scripts.length > 0 && scripts.every((c) => c.indexOf(cmp.trimEnd()) >= 0), true);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
