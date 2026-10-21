// test_direct_return.js <reads.json>: GD_PROCESS_REVERT's direct-delivery return (code_node_inConflictBatch 1b, lift/lifted_revert.js)
// on one GD's live reads with the completion's movements (sql_node_inDirectOut rows) replaced by crafted ones: only what left
// beyond the reservation returns goes back to Unrestricted, at the cost it left at; handling-unit stock and a short net out
// add nothing. Prints each case; exit 1 on a failure.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const X = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
for (const f of [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_revert.js", R + "scratchpad/gdc/code/prepare/adapter.js", D + "/code/prepare/chain.js"]) vm.runInContext(fs.readFileSync(f, "utf8"), sb);
vm.runInContext("this.grReads = grReads; this.grChain = grChain;", sb);
const base = JSON.parse(JSON.stringify(X.reads));
const run = (dout) => {
  const S = Object.assign({ organizationId: X.org }, JSON.parse(JSON.stringify(base)), { dout: dout });
  const Rd = sb.grReads(S);
  const stored = Rd.gd.data;
  stored.gd_status = "Completed";
  const out = sb.grChain(stored, Rd, "all");
  assert.strictEqual(out.route, "PLANNED", out.message);
  return out.batch.inventoryMovements;
};
const reserved = run([]);
const res = reserved.filter((m) => m.inventory_category === "Reserved");
assert.ok(res.length > 0, "the GD has reservation returns");
const m0 = res[0];
const key = { item: m0.material_id, b: m0.batch_id || "0", bin: m0.location_id, hu: "0" };
const resQty = res.filter((m) => m.material_id === m0.material_id && String(m.batch_id || "0") === String(key.b) && m.location_id === key.bin).reduce((a, m) => a + m.quantity, 0);
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };
t("no completion movements read: the reservation returns only", () => {
  assert.ok(reserved.every((m) => m.inventory_category === "Reserved"));
});
t("net out equal to the reservation returns: nothing more", () => {
  const mv = run([Object.assign({}, key, { net_bq: String(resQty), u_tp: "0", u_bq: "0", parent_no: "SO/x" })]);
  assert.strictEqual(mv.filter((m) => m.inventory_category === "Unrestricted").length, 0);
  assert.strictEqual(mv.length, reserved.length);
});
t("3 more left than the reservations put back: 3 to Unrestricted at the Unrestricted outs' cost (in the base unit)", () => {
  const mv = run([Object.assign({}, key, { net_bq: String(resQty + 3), u_tp: "21", u_bq: "3", parent_no: "SO/x" })]);
  const u = mv.filter((m) => m.inventory_category === "Unrestricted");
  assert.strictEqual(u.length, 1);
  assert.deepStrictEqual([u[0].material_id, u[0].quantity, u[0].unit_price, u[0].location_id, u[0].handling_unit_id || null, u[0].parent_no], [m0.material_id, 3, 7, key.bin, null, "SO/x"]);
  assert.strictEqual(u[0].material_uom, String(u[0].itemData.based_uom));
});
t("an item delivered with no reservation at all: its whole net out to Unrestricted", () => {
  const other = Object.assign({}, key, { bin: "999" });
  const mv = run([Object.assign({}, other, { net_bq: "5", u_tp: "50", u_bq: "5", parent_no: "SO/y" })]);
  const u = mv.filter((m) => m.inventory_category === "Unrestricted");
  assert.deepStrictEqual(u.map((m) => [m.location_id, m.quantity, m.unit_price]), [["999", 5, 10]]);
});
t("stock in a handling unit is left to the HU revert", () => {
  const mv = run([Object.assign({}, key, { hu: "123", net_bq: "4", u_tp: "4", u_bq: "4", parent_no: "SO/x" })]);
  assert.strictEqual(mv.filter((m) => m.inventory_category === "Unrestricted").length, 0);
});
t("less left than the reservations put back: nothing added (never negative)", () => {
  const mv = run([Object.assign({}, key, { net_bq: String(resQty - 1), u_tp: "0", u_bq: "0", parent_no: "SO/x" })]);
  assert.strictEqual(mv.filter((m) => m.inventory_category === "Unrestricted").length, 0);
});
console.log(n + " passed");
