// test_view_stock.js: scratchpad/pk1d/code/view_stock.js must equal classic PICKING code_node_iES7iMKA's buildViewStock
// (extracted from the deployed JSON at test time) on every input below, plus the merge / unit helpers Force Complete uses.
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const { buildViewStock, mergeByKey, uomFromViewStock } = require("../code/view_stock.js");
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0]); } };

const walk = (l, out = []) => { for (const x of l || []) { out.push(x); walk(x.blocks, out); } return out; };
const code = walk(JSON.parse(fs.readFileSync(R + "Picking/PickingProcessWorkflow.json", "utf8")).nodes).filter((x) => x.id === "code_node_iES7iMKA")[0].data.script.code;
const start = code.indexOf("const buildViewStock = (entries, uom) => {");
const src = code.slice(start, code.indexOf("const updatedGdLines", start));
const classic = (names) => new Function("locationNameMap", "batchNameMap", "huNameMap", src + "\nreturn buildViewStock;")(names.bins, names.batches, names.hus);

const NAMES = { bins: { L1: "WH-A-01", L2: "WH-A-02" }, batches: { B1: "Batch--0000000149" }, hus: { H1: "HU-0001", H2: "HU-0002" } };
const CASES = {
  "one loose entry": [{ location_id: "L1", gd_quantity: 5 }],
  "two loose entries with batches": [{ location_id: "L1", batch_id: "B1", gd_quantity: 2 }, { location_id: "L2", batch_id: null, gd_quantity: 3 }],
  "HU only": [{ location_id: "L1", handling_unit_id: "H1", gd_quantity: 4 }],
  "loose + HU": [{ location_id: "L1", gd_quantity: 1 }, { location_id: "L2", handling_unit_id: "H2", batch_id: "B1", gd_quantity: 2 }],
  "zero quantities filtered": [{ location_id: "L1", gd_quantity: 0 }, { location_id: "L2", gd_quantity: 3 }],
  "nothing allocated": [{ location_id: "L1", gd_quantity: 0 }],
  "names missing fall back to ids": [{ location_id: "L9", batch_id: "B9", gd_quantity: 1 }, { location_id: "L9", handling_unit_id: "H9", gd_quantity: 1 }],
  "decimal quantities": [{ location_id: "L1", gd_quantity: 2.5 }, { location_id: "L2", gd_quantity: 0.25 }],
};
for (const [name, entries] of Object.entries(CASES)) {
  for (const uom of ["PCS", "BAG"]) {
    it("buildViewStock = classic: " + name + " (" + uom + ")", () => {
      assert.strictEqual(buildViewStock(JSON.parse(JSON.stringify(entries)), uom, NAMES), classic(NAMES)(JSON.parse(JSON.stringify(entries)), uom));
    });
  }
}
it("buildViewStock without a names argument uses the ids", () => {
  assert.strictEqual(buildViewStock([{ location_id: "L1", gd_quantity: 5 }], "PCS"), "Total: 5 PCS\n\nDETAILS:\n1. L1: 5 PCS");
});

it("mergeByKey sums one bin/batch/HU and keeps the first entry's other fields", () => {
  const out = mergeByKey([{ location_id: "1", batch_id: null, gd_quantity: 2, plant_id: "P", x: "a" }, { location_id: "1", batch_id: null, gd_quantity: 3, x: "b" }]);
  assert.deepStrictEqual(out, [{ location_id: "1", batch_id: null, gd_quantity: 5, plant_id: "P", x: "a" }]);
});
it("mergeByKey treats null, undefined and the string 'undefined' batch alike", () => {
  const out = mergeByKey([{ location_id: "1", batch_id: "undefined", gd_quantity: 1 }, { location_id: "1", gd_quantity: 1 }, { location_id: "1", batch_id: null, gd_quantity: 1 }]);
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].gd_quantity, 3); assert.strictEqual(out[0].batch_id, null);
});
it("mergeByKey keeps HU and loose stock at one bin apart", () => {
  const out = mergeByKey([{ location_id: "1", gd_quantity: 1 }, { location_id: "1", handling_unit_id: "H", gd_quantity: 2 }]);
  assert.strictEqual(out.length, 2);
});
it("mergeByKey sums to_quantity when the entries carry it, and keeps first-seen order", () => {
  const out = mergeByKey([{ location_id: "2", gd_quantity: 1, to_quantity: 1 }, { location_id: "1", gd_quantity: 1 }, { location_id: "2", gd_quantity: 2, to_quantity: 2 }]);
  assert.deepStrictEqual(out.map((e) => [e.location_id, e.gd_quantity, e.to_quantity]), [["2", 3, 3], ["1", 1, undefined]]);
});
it("mergeByKey does not mutate its input", () => {
  const input = [{ location_id: "1", gd_quantity: 1 }, { location_id: "1", gd_quantity: 2 }];
  mergeByKey(input);
  assert.strictEqual(input[0].gd_quantity, 1);
});
it("uomFromViewStock reads the total's unit like classic", () => {
  assert.strictEqual(uomFromViewStock("Total: 5 PCS\n\nDETAILS:\n1. L1: 5 PCS"), "PCS");
  assert.strictEqual(uomFromViewStock("Total: 2.5 BAG\n\nDETAILS:\n1. L1: 2.5 BAG"), "BAG");
});
it("uomFromViewStock falls back to PCS like classic", () => {
  assert.strictEqual(uomFromViewStock(""), "PCS");
  assert.strictEqual(uomFromViewStock(null), "PCS");
});
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
