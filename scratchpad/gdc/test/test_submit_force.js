// test_submit_force.js: GD_COMPLETE_SUBMIT's Force Complete (code/submit/guard.js, entry.js, post.js + code/_fc.js) and the
// stale-form rule (gate.js gsFormDiff): the force is the form's / list's "Yes" only; it is queued instead of sent to the classic
// save; if_FcBusy's rule is the last gate (device lock <= 900 s or an unset age refuses, 901 s does not, unforced ignores it);
// columns only pick confirmations write are no form edit.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const D = __dirname + "/../";
const body = (f) => {
  const t = fs.readFileSync(D + f, "utf8");
  const i = t.indexOf("{{");
  return i < 0 ? t : t.slice(0, t.lastIndexOf("\n", i));
};
const ctx = (files, names) => {
  const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(files.map((f) => (f.startsWith("+") ? body(f.slice(1)) : fs.readFileSync(D + f, "utf8"))).join("\n") + "\nthis.out = { " + names.map((x) => x + ": " + x).join(", ") + " };", sb);
  return sb.out;
};
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };

const { submitGuard } = ctx(["code/submit/_common.js", "+code/submit/guard.js"], ["submitGuard"]);
const G = (source, isForceComplete) => submitGuard({ operation: "SUBMIT", gdId: "3", source: source, tenantId: "711077", uid: "1", answers: { isForceComplete: isForceComplete } });
t("guard: a force is the form's or the list's exact Yes", () => {
  eq([G("FORM", "Yes").force, G("FORM", "Yes").answers.isForceComplete], ["Yes", "Yes"]);
  eq(G("LIST", "Yes").force, "Yes");
  eq([G("PICKING", "Yes").force, G("PACKING", "Yes").force, G("FORM", "yes").force, G("FORM", "1").force, G("FORM", "").force], ["", "", "", "", ""]);
  eq(submitGuard({ operation: "SUBMIT", gdId: "3", source: "FORM", tenantId: "711077", answers: JSON.stringify({ isForceComplete: "Yes" }) }).force, "Yes");
});

const { submitEntry } = ctx(["code/submit/_common.js", "+code/submit/entry.js"], ["submitEntry"]);
const facts = [{ db_now: "2026-10-19 12:00:00", gd_id: "3", delivery_no: "GD/1", gd_status: "Created", organization_id: "2", plant_id: "4", line_count: 10, last_lock: "LOCK|2", open_jobs: null, picking_jobs: null, last_job: null }];
t("entry: a forced Created delivery goes on (no longer sent to the classic save)", () => {
  const r = submitEntry(G("FORM", "Yes"), facts);
  eq([r.route, r.lockN], ["GO", 3]);
});

const { submitPost } = ctx(["code/submit/_common.js", "code/_fc.js", "+code/submit/post.js"], ["submitPost"]);
const entry = { gdId: "3", gdNo: "GD/1", organizationId: "2", plantId: "4", lineCount: 10, dbNow: "2026-10-19 12:00:00", lockN: 3 };
// the gates as the lifted fill-back leaves them under a force: header stamped Completed, so 405 / 406 pass
const gate = (extra) => ({ needCL: "not required", overrides: {}, post: Object.assign({ pickingRequired: 1, skipPicking: 0, fillPickingStatus: "Completed", rollupPickingStatus: "Completed", packingSetups: 0 }, extra || {}) });
const locks = (rows) => [Object.assign({}, facts[0], { picking_locks: rows === null ? null : JSON.stringify(rows) })];
const held = (age, processing) => [{ picking_id: "11", picking_no: "PI-1", is_processing: processing === undefined ? 1 : processing, lock_age_sec: age }];
t("post: a device holding the Picking (<= 900 s, or no age) refuses 400 with the classic message; 901 s and a free Picking queue", () => {
  const r = submitPost(G("FORM", "Yes"), entry, gate(), null, locks(held(100)));
  eq([r.route, r.code, r.message], ["STOP", "400", "Picking PI-1 is being processed on a device right now. Try again in a moment."]);
  eq(submitPost(G("FORM", "Yes"), entry, gate(), null, locks(held(null))).code, "400");
  eq(submitPost(G("FORM", "Yes"), entry, gate(), null, locks(held(900))).code, "400");
  eq(submitPost(G("FORM", "Yes"), entry, gate(), null, locks(held(901))).route, "QUEUE");
  eq(submitPost(G("FORM", "Yes"), entry, gate(), null, locks(held(100, 0))).route, "QUEUE");
  eq(submitPost(G("FORM", "Yes"), entry, gate(), null, locks(null)).route, "QUEUE");
  eq(submitPost(G("FORM", "Yes"), entry, gate(), null, locks([])).route, "QUEUE");
});
t("post: the busy check comes last (a 412 or 407 answers first); unforced ignores the lock; a bad read refuses", () => {
  eq(submitPost(G("FORM", "Yes"), entry, gate({ siConfirm: 412, siMsg: "auto SI?" }), null, locks(held(100))).code, "412");
  eq(submitPost(G("FORM", "Yes"), entry, gate({ packingSetups: 1, packingStatus: "" }), null, locks(held(100))).code, "407");
  eq(submitPost(G("FORM", ""), entry, gate(), null, locks(held(100))).route, "QUEUE");
  const bad = [Object.assign({}, facts[0], { picking_locks: "{not json" })];
  eq(submitPost(G("FORM", "Yes"), entry, gate(), null, bad).code, "400");
});
t("post: a forced job carries the answer to PREPARE (request_payload.answers.isForceComplete)", () => {
  const r = submitPost(G("LIST", "Yes"), entry, gate(), null, locks([]));
  eq(JSON.parse(r.jobRows[0].request_payload).answers.isForceComplete, "Yes");
  eq(JSON.parse(submitPost(G("FORM", ""), entry, gate(), null, locks([])).jobRows[0].request_payload).answers.isForceComplete, "");
});

const F = JSON.parse(fs.readFileSync(D + "lift/fields.json", "utf8"));
const { gsFormDiff } = ctx(["code/prepare/chain.js", "code/submit/_common.js", "+code/submit/gate.js"], ["gsFormDiff"]);
const kinds = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const stored = { id: "3", table_gd: [{ id: "31", gd_qty: 2, picking_status: "In Progress", picked_qty: 0, prev_temp_qty_data: "[]" }] };
t("gate: a form opened before the latest pick is not an edit; a quantity change still is", () => {
  const stale = { id: "3", table_gd: [{ id: "31", gd_qty: 2, picking_status: "Created", picked_qty: 1, prev_temp_qty_data: "[{\"x\":1}]", picked_temp_qty_data: "[]" }] };
  eq(gsFormDiff(stale, stored, kinds).changed, []);
  eq(gsFormDiff({ id: "3", table_gd: [{ id: "31", gd_qty: 3, picking_status: "In Progress" }] }, stored, kinds).changed, ["table_gd.gd_qty"]);
});
// LSH 10-23..25: 21 of 25 form completions went to the classic save on "unsaved changes (gd_ref_doc)" - the form sends [] for
// an attachment column the stored GD holds as null
t("gate: an empty list / object is no value, as null is; a real attachment still is an edit", () => {
  const line = [{ id: "31", gd_qty: 2, picking_status: "In Progress" }];
  eq(gsFormDiff({ id: "3", gd_ref_doc: [], table_gd: line }, Object.assign({}, stored, { gd_ref_doc: null }), kinds).changed, []);
  eq(gsFormDiff({ id: "3", gd_ref_doc: [], table_gd: line }, Object.assign({}, stored, { gd_ref_doc: "[]" }), kinds).changed, []);
  eq(gsFormDiff({ id: "3", gd_ref_doc: "", table_gd: line }, Object.assign({}, stored, { gd_ref_doc: "[]" }), kinds).changed, []);
  eq(gsFormDiff({ id: "3", gd_ref_doc: {}, table_gd: line }, stored, kinds).changed, []);
  eq(gsFormDiff({ id: "3", gd_ref_doc: [{ url: "a.pdf" }], table_gd: line }, Object.assign({}, stored, { gd_ref_doc: null }), kinds).changed, ["gd_ref_doc"]);
  eq(gsFormDiff({ id: "3", gd_ref_doc: [], table_gd: line }, Object.assign({}, stored, { gd_ref_doc: "[{\"url\":\"a.pdf\"}]" }), kinds).changed, ["gd_ref_doc"]);
  eq(gsFormDiff({ id: "3", table_gd: [{ id: "31", gd_qty: 2, picking_status: "In Progress", temp_qty_data: [] }] }, stored, kinds).changed, []);
});
console.log(n + " passed");
