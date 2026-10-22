// test_lanes.js: code/commit/lanes.js (10-22, after GD Completed V2's lanes): a write pass's first 12 slices go to parallel lanes,
// the rest to the loop; a missing or repeated row id sends every slice to the loop, so two lanes never write one row.
const fs = require("fs"), path = require("path"), assert = require("assert");
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0].slice(0, 240)); } };
const SRC = fs.readFileSync(path.join(__dirname, "../code/commit/lanes.js"), "utf8").replace(/__LANES__/g, "12");
const BODY = SRC.replace("[{{node:__SRC__}}][0]", "__IN__");
const run = (slices) => new Function("__IN__", BODY)(slices);
const sl = (n0, k) => ({ n: n0, rows: Array.from({ length: k }, (_, i) => ({ id: String(n0 * 1000 + i), x: i })) });

it("3 slices -> lanes 0-2, nothing for the loop", () => {
  const o = run([sl(1, 250), sl(2, 250), sl(3, 10)]);
  assert.deepStrictEqual([o.has0, o.has1, o.has2, o.has3, o.hasRest, o.count, o.lane2.length, o.rest.length], ["YES", "YES", "YES", "NO", "NO", "510", 10, 0]);
});
it("14 slices -> 12 lanes, the last 2 to the loop", () => {
  const o = run(Array.from({ length: 14 }, (_, k) => sl(k + 1, 5)));
  assert.deepStrictEqual([o.has11, o.hasRest, o.rest.length, o.rest[0].n, o.lane11[0].id], ["YES", "YES", 2, 13, "12000"]);
});
it("a repeated row id -> every slice to the loop, no lane", () => {
  const a = sl(1, 3), b = sl(2, 3);
  b.rows[0].id = a.rows[0].id;
  const o = run([a, b]);
  assert.deepStrictEqual([o.has0, o.has1, o.hasRest, o.rest.length], ["NO", "NO", "YES", 2]);
});
it("a row without an id -> every slice to the loop", () => {
  const a = sl(1, 3);
  delete a.rows[1].id;
  const o = run([a]);
  assert.deepStrictEqual([o.has0, o.hasRest, o.rest.length], ["NO", "YES", 1]);
});
it("no slices -> no lane, no loop", () => {
  const o = run([]);
  assert.deepStrictEqual([o.has0, o.hasRest, o.count, o.lane0], ["NO", "NO", "0", []]);
});
it("a single slice object (not an array) is one slice", () => {
  const o = run(sl(1, 2));
  assert.deepStrictEqual([o.has0, o.lane0.length, o.hasRest], ["YES", 2, "NO"]);
});
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
