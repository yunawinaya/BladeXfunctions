// test_submit_fc.js: PICKING_ASYNC_SUBMIT's FORCE_COMPLETE (Picking 1d, Task 9) - scratchpad/pk1d/code/submit_guard.js and
// submit_decide.js run as the nodes run them (the source cut at its {{template}} tail), on hand-made facts.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const C = path.join(__dirname, "../code/");
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0].slice(0, 240)); } };
const mod = (file, extra) => {
  let t = fs.readFileSync(C + file, "utf8");
  for (const [a, b] of Object.entries(extra || {})) { assert.ok(t.indexOf(a) >= 0, file + ": " + a); t = t.replace(a, b); }
  const cut = t.search(/^.*\{\{.*$/m);
  const ctx = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Date, parseInt, parseFloat, isNaN, isFinite, RegExp };
  vm.createContext(ctx);
  vm.runInContext(cut >= 0 ? t.slice(0, cut) : t, ctx);
  return ctx;
};
const G = mod("submit_guard.js"), D = mod("submit_decide.js"), DON = mod("submit_decide.js", { "FORCE_COMPLETE: false": "FORCE_COMPLETE: true" });
const call = (ctx, fn, ...args) => { ctx.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", ctx))); };
const KEY = "pk1d-fc-0000000000000001";
const gin = (o) => Object.assign({ systemTenantId: "496474", pickingId: "2112000000000000088", organizationId: "1901545950162329602", operation: "FORCE_COMPLETE", idempotencyKey: KEY, payload: "{}", confirmedBy: "admin" }, o || {});

// ---- guard
it("guard: FORCE_COMPLETE is accepted with no lines; its request has none and no header patch", () => {
  const r = call(G, "submitGuard", gin({ payload: JSON.stringify({ lines: [{ row_id: "1", qty: 2 }], header_patch: { remarks: "x" } }) }));
  assert.strictEqual(r.route, "CONTINUE", r.result_message);
  const req = JSON.parse(r.request);
  assert.deepStrictEqual([req.operation, req.lines, req.header_patch, r.lineCount, r.moveRowsJson], ["FORCE_COMPLETE", [], {}, 0, "[]"]);
});
it("guard: CONFIRM still needs a picked line", () => { assert.strictEqual(call(G, "submitGuard", gin({ operation: "CONFIRM" })).route, "REJECT"); });
it("guard: an unknown operation is refused, naming FORCE_COMPLETE among the valid ones", () => {
  const r = call(G, "submitGuard", gin({ operation: "NOPE" })); assert.strictEqual(r.route, "REJECT"); assert.ok(/FORCE_COMPLETE/.test(r.result_message), r.result_message);
});

// ---- decide
const g = () => call(G, "submitGuard", gin());
const facts = (o) => [Object.assign({ db_now: "2026-10-20 10:00:00", key_job: "", id: "2112000000000000088", is_deleted: 0, organization_id: "1901545950162329602", to_status: "In Progress",
  gd_busy: "", open_job: "", is_processing: 0, lock_age_sec: 99999, picking_after: "Goods Delivery", allow_full_picking: 0, setup_loading_bay: 0, is_loading_bay: 0, auto_completed_gd: 0, plant_id: "8" }, o || {})];
const gdRow = (id, o) => Object.assign({ kind: "G", gd_id: id, delivery_no: "GD/" + id, gd_status: "Created", line_count: "3", serial_items: "0", select_picking: "0", linked: "0", other_job: "0" }, o || {});
const fc = (gds, recs) => gds.concat([{ kind: "P", rec_count: String(recs === undefined ? 4 : recs) }]);
const dec = (ctx, f, rows) => call(ctx, "submitDecide", g(), f || facts(), [], rows || fc([gdRow("1")]));

it("decide: the stage switch off -> NOT_ELIGIBLE, classic_ok 1 (small)", () => {
  const r = dec(D); assert.deepStrictEqual([r.route, r.classic_ok], ["NOT_ELIGIBLE", "1"]);
});
it("decide: a Picking not In Progress is refused", () => {
  for (const st of ["Created", "Draft"]) { const r = dec(DON, facts({ to_status: st })); assert.strictEqual(r.route, "REJECT"); assert.ok(/In Progress/.test(r.result_message), r.result_message); }
});
it("decide: Picking Plan / Full Picking / Auto Complete GD / Loading Bay (setup or Picking) -> NOT_ELIGIBLE", () => {
  for (const o of [{ picking_after: "Sales Order" }, { allow_full_picking: 1 }, { auto_completed_gd: 1 }, { setup_loading_bay: 1 }, { is_loading_bay: 1 }]) {
    assert.strictEqual(dec(DON, facts(o)).route, "NOT_ELIGIBLE", JSON.stringify(o));
  }
});
it("decide: a delivery with serial items / select picking / internal trading -> NOT_ELIGIBLE", () => {
  for (const o of [{ serial_items: "2" }, { select_picking: "1" }, { linked: "1" }]) assert.strictEqual(dec(DON, null, fc([gdRow("1"), gdRow("2", o)])).route, "NOT_ELIGIBLE", JSON.stringify(o));
});
it("decide: 26 deliveries -> refused PK_FC_TOO_BIG, classic_ok 0", () => {
  const gds = []; for (let i = 0; i < 26; i++) gds.push(gdRow(String(i + 1), { line_count: "1" }));
  const r = dec(DON, null, fc(gds)); assert.deepStrictEqual([r.route, r.result_code, r.classic_ok], ["REJECT", "PK_FC_TOO_BIG", "0"]);
});
it("decide: more than 2,000 lines -> refused PK_FC_TOO_BIG", () => {
  const r = dec(DON, null, fc([gdRow("1", { line_count: "1500" }), gdRow("2", { line_count: "501" })])); assert.strictEqual(r.result_code, "PK_FC_TOO_BIG");
});
it("decide: the switch off with 501 lines -> NOT_ELIGIBLE but classic_ok 0 (classic is capped)", () => {
  const r = dec(D, null, fc([gdRow("1", { line_count: "501" })])); assert.deepStrictEqual([r.route, r.classic_ok], ["NOT_ELIGIBLE", "0"]);
});
it("decide: nothing picked -> refused PK_FC_NO_RECORDS", () => { const r = dec(DON, null, fc([gdRow("1")], 0)); assert.strictEqual(r.result_code, "PK_FC_NO_RECORDS"); });
it("decide: a delivery busy on another Picking's job -> refused", () => { assert.strictEqual(dec(DON, null, fc([gdRow("1", { other_job: "1" })])).route, "REJECT"); });
it("decide: a delivery busy in the background (gd_busy) -> refused", () => { assert.strictEqual(dec(DON, facts({ gd_busy: "GD/9" })).route, "REJECT"); });
it("decide: an open confirmation -> refused; under review -> refused with support", () => {
  assert.strictEqual(dec(DON, facts({ open_job: "77|QUEUED" })).route, "REJECT");
  assert.ok(/support/.test(dec(DON, facts({ open_job: "77|REQUIRES_REVIEW" })).result_message));
});
it("decide: a fresh device lock -> refused", () => { assert.strictEqual(dec(DON, facts({ is_processing: 1, lock_age_sec: 30 })).route, "REJECT"); });
it("decide: the same key again -> RETURN its job", () => { const r = dec(DON, facts({ key_job: "55|READY_TO_COMMIT" })); assert.deepStrictEqual([r.route, r.job_id], ["RETURN", "55"]); });
it("decide: eligible -> CREATE the FORCE_COMPLETE job (no moves) and take the Picking lock", () => {
  const r = dec(DON);
  assert.strictEqual(r.route, "CREATE", r.result_message);
  const req = JSON.parse(r.jobRows[0].request_payload);
  assert.deepStrictEqual([req.operation, req.lines, req.moves, r.jobRows[0].command], ["FORCE_COMPLETE", [], 0, "CONFIRM_PICKING"]);
  assert.deepStrictEqual([r.needLock, r.lockRows[0].is_processing], ["YES", 1]);
});
it("decide: a CONFIRM submit is untouched by the force-complete facts (classic_ok empty)", () => {
  const gc = call(G, "submitGuard", gin({ operation: "CONFIRM", payload: JSON.stringify({ lines: [{ row_id: "1", qty: 1 }] }) }));
  const r = call(DON, "submitDecide", gc, facts(), [], null); assert.deepStrictEqual([r.route, r.classic_ok], ["CREATE", ""]);
});
it("decide: the V2 switch off (ASYNC_PICKING_ENABLED) -> a FORCE_COMPLETE is NOT_ELIGIBLE with classic_ok: 1 small, 0 above the classic cap", () => {
  const OFF = mod("submit_decide.js", { "const ASYNC_PICKING_ENABLED = true;": "const ASYNC_PICKING_ENABLED = false;" });
  const small = call(OFF, "submitDecide", g(), facts(), [], fc([gdRow("1")]));
  assert.deepStrictEqual([small.route, small.classic_ok], ["NOT_ELIGIBLE", "1"]);
  const big = call(OFF, "submitDecide", g(), facts(), [], fc([gdRow("1", { line_count: "501" })]));
  assert.deepStrictEqual([big.route, big.classic_ok], ["NOT_ELIGIBLE", "0"]);
});
it("the workflow declares every key its return nodes answer (classic_ok, operation, progress_percent, kick)", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../Picking/AsyncV2/PICKING_ASYNC_SUBMIT.json"), "utf8"));
  const top = new Set((doc.response_json || []).map((r) => r.name));
  const walk = (l, o = []) => { for (const x of l || []) { o.push(x); walk(x.blocks, o); } return o; };
  const missing = [...new Set(walk(doc.nodes).filter((x) => x.type === "return-node").flatMap((x) => x.data.response_value.list.map((f) => f.prop)))].filter((k) => !top.has(k));
  assert.deepStrictEqual(missing, []);
});
it("STATUS reads the edits to kick only for an open force complete, through the open-job states", () => {
  const sql = fs.readFileSync(C + "submit_status.sql", "utf8");
  assert.ok(/CASE WHEN JSON_UNQUOTE\(JSON_EXTRACT\(j\.request_payload, '\$\.operation'\)\) = 'FORCE_COMPLETE'\s+AND j\.job_status IN \('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING'\)/.test(sql), "no FORCE_COMPLETE gate");
  assert.ok(/e\.job_status IN \('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'HELD'\)/.test(sql), "the edits are not read through their open states");
});
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
