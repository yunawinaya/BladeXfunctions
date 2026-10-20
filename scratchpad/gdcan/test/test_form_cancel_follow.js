// test_form_cancel_follow.js [--mutate name]: the GD form's Processing view (Goods Delivery/GDonMounted.js followBackgroundSave) on a
// delivery a GD Cancel V2 job holds: GD_CANCEL_WORKER started with its job, cancel wording on every outcome; edit / completion wording
// unchanged. The mock form is GD Edit V2's (scratchpad/gde/test/test_mounted.js, which stays the regression suite for the rest).
const fs = require("fs"), assert = require("assert");
const ROOT = __dirname + "/../../../Goods Delivery/";
const SUBMIT = "2110618741159940097", EDIT_WORKER = "2110618789356687361", COMPLETE_WORKER = "2110182645714518018", CANCEL_WORKER = "2112455700319932418";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = { no_cancel_worker: ['  CANCEL_GD: "2112455700319932418", // GD_CANCEL_WORKER\n', ""], save_wording: ['CANCEL_GD: ["cancelled", "cancellation"],', ""] };

async function scenario(statuses) {
  let code = fs.readFileSync(ROOT + "GDonMounted.js", "utf8");
  if (mutate) { if (code.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant " + mutate + " does not apply"); code = code.split(MUT[mutate][0]).join(MUT[mutate][1]); }
  const workers = [], messages = [], alerts = [];
  let now = 1000000, queue = [], refreshed = 0;
  const fakeSetTimeout = (fn, ms) => { queue.push({ at: now + (ms || 0), fn }); return queue.length; };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
  const states = statuses.slice();
  const values = { id: "2112405430776991745", delivery_no: "GD/20261020/091", gd_status: "Processing", picking_status: "", so_id: ["2110000000000000001"],
    plant_id: "2105190589240086530", organization_id: "2105190589240086530", from_convert: "", all_item: "", gd_delivery_method: "",
    table_gd: [{ id: "l1", material_id: "m1", so_line_item_id: "s1", gd_qty: 2 }] };
  const list = (x) => (Array.isArray(x) ? x : [x]);
  const chain = () => { const c = { where: () => c, filter: () => c, field: () => c, limit: () => c, orderBy: () => c, doc: () => ({ get: () => Promise.resolve({ data: [{}] }) }), get: () => Promise.resolve({ data: [] }) }; return c; };
  const form = {
    isAdd: false, isEdit: false, isView: true, isCopy: false, models: { _data: {} },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => {} } }, refresh: () => refreshed++ },
    getValue: (k) => values[k], getValues: () => values, setData: (x) => Object.assign(values, x),
    getVarGlobal: (k) => (k === "deptParentId" ? "2105190589240086530" : "admin"), getVarSystem: (k) => (k === "tenantId" ? "496474" : "2105190589240086530"),
    display: () => {}, hide: () => {}, disabled: () => {}, getComponent: () => ({ hideChildRecord: () => {}, options: {} }), getParamsVariables: () => "",
    triggerEvent: async () => {}, onDropdownVisible: () => Promise.resolve([]), getOptionData: () => [], setOptionData: () => {},
    runWorkflow: (id, params, ok) => {
      if (id === EDIT_WORKER || id === COMPLETE_WORKER || id === CANCEL_WORKER) { workers.push({ id, params }); return; }
      if (id !== SUBMIT || params.operation !== "STATUS") throw new Error("unexpected workflow " + id);
      const s = states.length > 1 ? states.shift() : states[0];
      fakeSetTimeout(() => ok({ code: 200, data: s }), 0);
    },
    $message: { success: (m) => messages.push("success: " + m), warning: (m) => messages.push("warning: " + m), error: (m) => messages.push("error: " + m), info: (m) => messages.push("info: " + m) },
    $alert: (m, t, opt) => { alerts.push(((opt && opt.type) || "") + " | " + (t || "") + " | " + m); return Promise.resolve(); },
  };
  new Function("setTimeout", "Date", "db", "console", code).call(form, fakeSetTimeout, FakeDate, { collection: chain }, { log: () => {}, warn: () => {}, error: () => {} });
  for (let k = 0; k < 5000; k++) {
    await new Promise((r) => setImmediate(r));
    if (!queue.length) break;
    queue.sort((a, b) => a.at - b.at);
    const t = queue.shift();
    now = Math.max(now, t.at);
    await t.fn();
  }
  return { workers, messages, alerts, refreshed };
}
const ST = (command, job_status, extra) => Object.assign({ route: "STATUS", code: "200", command, job_id: "J9", job_status, gd_id: "2112405430776991745",
  gd_no: "GD/20261020/091", progress_message: "", error_code: "", error_message: "" }, extra || {});
let n = 0, failed = 0;
const it = async (name, f) => { n++; try { await f(); console.log("ok", name); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0].slice(0, 300)); } };
(async () => {
  await it("a cancel running -> GD_CANCEL_WORKER started with its job, 'being cancelled', then 'has been cancelled', list refreshed", async () => {
    const r = await scenario([ST("CANCEL_GD", "COMMITTING_GD"), ST("CANCEL_GD", "COMPLETED")]);
    assert.deepStrictEqual(r.workers, [{ id: CANCEL_WORKER, params: { job_id: "J9" } }], JSON.stringify(r));
    assert.ok(r.messages.indexOf("info: Goods Delivery GD/20261020/091 is being cancelled in the background. It is read-only until that finishes.") >= 0, JSON.stringify(r.messages));
    assert.ok(r.messages.indexOf("success: Goods Delivery GD/20261020/091 has been cancelled. Reopen it to see the result.") >= 0, JSON.stringify(r.messages));
    assert.strictEqual(r.refreshed, 1);
  });
  await it("a cancel that failed (e.g. GDX_NOT_ELIGIBLE, the delivery back to Created) -> 'was not cancelled' with the reason", async () => {
    const r = await scenario([ST("CANCEL_GD", "FAILED", { error_code: "GDX_NOT_ELIGIBLE", error_message: "It is linked to Picking records" })]);
    assert.deepStrictEqual(r.alerts, ["error | Goods Delivery GD/20261020/091 was not cancelled | It is linked to Picking records. Reopen it to continue."]);
  });
  await it("a cancel under review -> 'part-way through its cancellation'", async () => {
    const r = await scenario([ST("CANCEL_GD", "REQUIRES_REVIEW", { error_message: "X4P_PICKING: changed" })]);
    assert.strictEqual(r.alerts.length, 1); assert.ok(/^warning \| Goods Delivery GD\/20261020\/091 needs a review \| It stopped part-way through its cancellation and needs a review/.test(r.alerts[0]), r.alerts[0]);
    assert.deepStrictEqual(r.workers, []);
  });
  await it("unchanged: an edit -> 'has been saved' / 'was not saved'; a completion -> 'has been completed' / 'its completion'", async () => {
    let r = await scenario([ST("EDIT_GD", "COMPLETED")]);
    assert.ok(r.messages.indexOf("success: Goods Delivery GD/20261020/091 has been saved. Reopen it to see the result.") >= 0, JSON.stringify(r.messages));
    r = await scenario([ST("EDIT_GD", "FAILED", { error_message: "Not enough stock" })]);
    assert.ok(/^error \| Goods Delivery GD\/20261020\/091 was not saved \|/.test(r.alerts[0]), r.alerts[0]);
    r = await scenario([ST("COMPLETE_GD", "COMMITTING_GD"), ST("COMPLETE_GD", "COMPLETED")]);
    assert.ok(r.messages.indexOf("success: Goods Delivery GD/20261020/091 has been completed. Reopen it to see the result.") >= 0, JSON.stringify(r.messages));
    assert.ok(r.messages.some((m) => /is being completed in the background/.test(m)), JSON.stringify(r.messages));
    assert.deepStrictEqual(r.workers.map((w) => w.id), [COMPLETE_WORKER]);
    r = await scenario([ST("COMPLETE_GD", "REQUIRES_REVIEW")]);
    assert.ok(/its completion and needs a review/.test(r.alerts[0]), r.alerts[0]);
  });
  console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
  process.exit(failed ? 1 : 0);
})();
