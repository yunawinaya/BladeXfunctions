// test_run_marker_sim.js <harness dir>: engine v12's run marker on bladexfunctions-8c's FlowGram interpreter - two calls of ONE operation
// at once. <harness dir> = a copy of scratchpad/idav2/test/integration whose fixture.js points INVENTORY_BULK_APPLY at the v12 JSON and
// whose world.js mocks v12's reads (IBops id + heartbeat, IBlk3 db_now, IBrunMe, IBfence, IBfzRel). Each case: a receipt of 3 FIFO items
// (6 keys); the second call starts from a hook on the first run's INVENTORY_LOCK_TOKENS call. Prints each check; exit 1 on a failure.
const assert = require("assert");
const H = process.argv[2];
const F = require(H + "/fixture.js");
const { call } = require(H + "/interp.js");
const docs = F.loadDocs();
const ITEMS = [801, 802, 803];
const MIN = 60000;
const mk = () => F.world({ lines: ITEMS.map((i) => ({ kind: "none", item: i, qty: 1 })) }).w;
const req = (op) => ({ operation_key: op, mode: "APPLY", organization_id: F.ORG, movements: ITEMS.map((i, k) => ({
  movement_key: "R" + (k + 1), direction: "ADD", inventory_category: "Unrestricted", isMovingInv: 0, plant_id: F.PLANT, organization_id: F.ORG, material_id: F.comp(i),
  location_id: F.BINS[0], batch_id: null, quantity: 2, material_uom: F.UOM, unit_price: 5, transaction_type: "TEST", trx_no: "TEST-RM", parent_trx_no: null,
  doc_date: "2026-10-21 00:00:00", handling_unit_id: null })) });
const apply = (w, op) => call(w, docs, F.IDS, "INVENTORY_BULK_APPLY", req(op));
const ans = (r) => (r.err ? "ERR " + r.err : r.out.code + " " + r.out.result_code);
const moves = (w, op) => w.mv.filter((m) => !m.is_deleted && String(m.operation_effect_key || "").indexOf(op + "|") === 0).length;
const layers = (w) => w.fifo.filter((f) => !f.is_deleted && ITEMS.map((i) => F.comp(i)).indexOf(String(f.material_id)) >= 0).length;
const held = (w, op) => w.locks.filter((l) => !l.is_deleted && Number(l.free_token) === 0 && (l.owner_operation_id === op || (!l.owner_operation_id && l.last_owner_operation_id === op))).length;
const marks = (w, op) => w.steps.filter((s) => !s.is_deleted && s.job_id === op && s.step_name.indexOf("IBA|RUN|") === 0)
  .sort((a, b) => (a.step_name < b.step_name ? -1 : 1)).map((s) => s.step_name.slice(8) + ":" + s.step_status);
const tokensOk = (w) => w.locks.every((l) => Number(l.free_token) === 0 || Number(l.free_token) === 1);
let n = 0, bad = 0;
const t = (name, f) => {
  try { f(); n++; console.log("ok", name); } catch (e) { bad++; console.log("FAIL", name, "--", String(e.message).split("\n")[0].slice(0, 200)); }
};
process.on("exit", () => { if (bad) process.exitCode = 1; });

t("M0 one call: applied once, keys back, its marker ENDED", () => {
  const w = mk();
  const r = apply(w, "T|M0");
  assert.deepStrictEqual([ans(r), moves(w, "T|M0"), layers(w), held(w, "T|M0"), marks(w, "T|M0")], ["200 OK", 3, 3, 0, ["001:ENDED"]]);
});
t("M1 a second call while the first is alive (inside its lock take): 409 'still running', nothing written twice", () => {
  const w = mk();
  let inner = null, started = false;
  w.hooks.INVENTORY_LOCK_TOKENS = (p) => { if (p.mode === "TAKE" && !started) { started = true; inner = apply(w, "T|M1"); } };
  const outer = apply(w, "T|M1");
  assert.strictEqual(ans(inner), "409 LOCK_BUSY");
  assert.ok(/still running/.test(inner.out.message), inner.out.message);
  assert.deepStrictEqual([ans(outer), moves(w, "T|M1"), layers(w), held(w, "T|M1"), marks(w, "T|M1"), tokensOk(w)], ["200 OK", 3, 3, 0, ["001:ENDED"], true]);
});
t("M2 the first run died after its take: a call within 20 min -> 409; after 20 min it takes over and applies once", () => {
  const dry = mk();
  apply(dry, "T|M2");
  const at = dry.writeLog.findIndex((x) => x.indexOf("update_node_IBrunHb1") >= 0) + 1;
  assert.ok(at > 0, "Hb1 is a write");
  const w = mk();
  w.crashAfter = w.writeCount + at;
  const r1 = apply(w, "T|M2");
  w.crashAfter = 0;
  assert.ok(/crash right after write/.test(String(r1.err)), ans(r1));
  assert.deepStrictEqual([held(w, "T|M2") > 0, moves(w, "T|M2"), marks(w, "T|M2")], [true, 0, ["001:RUNNING"]]);
  w.now += 10 * MIN;
  const r2 = apply(w, "T|M2");
  assert.deepStrictEqual([ans(r2), moves(w, "T|M2"), marks(w, "T|M2")], ["409 LOCK_BUSY", 0, ["001:RUNNING"]]);
  w.now += 11 * MIN;
  const r3 = apply(w, "T|M2");
  assert.deepStrictEqual([ans(r3), moves(w, "T|M2"), layers(w), held(w, "T|M2"), marks(w, "T|M2"), tokensOk(w)], ["200 OK", 3, 3, 0, ["001:RUNNING", "002:ENDED"], true]);
});
t("M3 the first run stalled before its take for 21 min; a later call took over and finished: the first stops at the fence and gives back what it took", () => {
  const w = mk();
  let inner = null, started = false;
  w.hooks.INVENTORY_LOCK_TOKENS = (p) => { if (p.mode === "TAKE" && !started) { started = true; w.now += 21 * MIN; inner = apply(w, "T|M3"); } };
  const outer = apply(w, "T|M3");
  assert.strictEqual(ans(inner), "200 OK");
  assert.strictEqual(ans(outer), "409 LOCK_BUSY");
  assert.ok(/superseded/.test(outer.out.message), outer.out.message);
  assert.deepStrictEqual([moves(w, "T|M3"), layers(w), held(w, "T|M3"), marks(w, "T|M3"), tokensOk(w)], [3, 3, 0, ["001:ENDED", "002:ENDED"], true]);
});
t("M4 busy on another operation's key: the marker ends, so an immediate retry is busy for the key, not for itself; then it applies", () => {
  const w = mk();
  apply(w, "T|Y");
  const key = w.locks.find((l) => /^ITEM\|/.test(l.lock_key));
  Object.assign(key, { free_token: 0, owner_operation_id: "T|Y" });
  const r1 = apply(w, "T|M4"), r2 = apply(w, "T|M4");
  assert.deepStrictEqual([ans(r1), ans(r2), marks(w, "T|M4")], ["409 LOCK_BUSY", "409 LOCK_BUSY", ["001:ENDED", "002:ENDED"]]);
  assert.ok(/T\|Y/.test(r2.out.message) && !/still running/.test(r2.out.message), r2.out.message);
  Object.assign(key, { free_token: 1, owner_operation_id: "" });
  const r3 = apply(w, "T|M4");
  assert.deepStrictEqual([ans(r3), moves(w, "T|M4"), held(w, "T|M4"), marks(w, "T|M4")], ["200 OK", 3, 0, ["001:ENDED", "002:ENDED", "003:ENDED"]]);
});
t("M5 a replay while the first run is still giving its keys back: 409 (no second GIVE); after it ends, REPLAYED", () => {
  const w = mk();
  let inner = null, started = false;
  w.hooks.INVENTORY_LOCK_TOKENS = (p) => { if (p.mode === "GIVE" && !started) { started = true; inner = apply(w, "T|M5"); } };
  const outer = apply(w, "T|M5");
  assert.deepStrictEqual([ans(outer), ans(inner)], ["200 OK", "409 LOCK_BUSY"]);
  const again = apply(w, "T|M5");
  assert.deepStrictEqual([ans(again), moves(w, "T|M5"), layers(w), held(w, "T|M5"), marks(w, "T|M5"), tokensOk(w)], ["200 REPLAYED", 3, 3, 0, ["001:ENDED", "002:ENDED"], true]);
});
t("M6 8c's case: a second call (RESUME) while the first is mid-writes (its intent rows and balances written, its FIFO layers next): 409, applied once", () => {
  const w = mk();
  let inner = null, started = false;
  const ins0 = w.insert.bind(w);
  w.insert = (table, rows, nid, ctx) => {
    if (nid === "add_node_IBwFfNew" && !started) { started = true; inner = apply(w, "T|M6"); }
    return ins0(table, rows, nid, ctx);
  };
  const outer = apply(w, "T|M6");
  assert.deepStrictEqual([ans(outer), ans(inner), moves(w, "T|M6"), layers(w), held(w, "T|M6"), tokensOk(w)], ["200 OK", "409 LOCK_BUSY", 3, 3, 0, true]);
});
console.log(n + " passed" + (bad ? ", " + bad + " FAILED" : ""));
