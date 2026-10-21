// test_form_revert_follow.js [--file GDonMounted.js] [--mutate name]: the GD form's Processing view (followBackgroundSave) on a delivery a
// GD Revert V2 job holds: GD_REVERT_WORKER started with its job, revert wording on every outcome; cancel / completion wording unchanged.
// --file: a patched copy (patch_form.py --to) before the ids are real. The mock form is GD Cancel V2's test_form_cancel_follow.js.
const fs = require("fs"), assert = require("assert");
const arg = (k) => (process.argv.indexOf(k) >= 0 ? process.argv[process.argv.indexOf(k) + 1] : "");
const FILE = arg("--file") || __dirname + "/../../../Goods Delivery/GDonMounted.js";
const SRC = fs.readFileSync(FILE, "utf8");
const REVERT_WORKER = (SRC.match(/REVERT_GD: "([0-9]+)", \/\/ GD_REVERT_WORKER/) || [])[1];
assert.ok(REVERT_WORKER, "no REVERT_GD worker in " + FILE);
const SUBMIT = "2110618741159940097", EDIT_WORKER = "2110618789356687361", COMPLETE_WORKER = "2110182645714518018", CANCEL_WORKER = "2112455700319932418";
const mutate = arg("--mutate");
const MUT = { no_revert_worker: ['  REVERT_GD: "' + REVERT_WORKER + '", // GD_REVERT_WORKER\n', ""], save_wording: ['REVERT_GD: ["reverted", "revert"],', ""] };

async function scenario(statuses) {
  let code = SRC;
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
      if (id === EDIT_WORKER || id === COMPLETE_WORKER || id === CANCEL_WORKER || id === REVERT_WORKER) { workers.push({ id, params }); return; }
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
  await it("a revert running -> GD_REVERT_WORKER started with its job, 'being reverted', then 'has been reverted', list refreshed", async () => {
    const r = await scenario([ST("REVERT_GD", "COMMITTING_GD"), ST("REVERT_GD", "COMPLETED")]);
    assert.deepStrictEqual(r.workers, [{ id: REVERT_WORKER, params: { job_id: "J9" } }], JSON.stringify(r));
    assert.ok(r.messages.indexOf("info: Goods Delivery GD/20261020/091 is being reverted in the background. It is read-only until that finishes.") >= 0, JSON.stringify(r.messages));
    assert.ok(r.messages.indexOf("success: Goods Delivery GD/20261020/091 has been reverted. Reopen it to see the result.") >= 0, JSON.stringify(r.messages));
    assert.strictEqual(r.refreshed, 1);
  });
  await it("a revert that failed (e.g. a conflict, the delivery back to Completed) -> 'was not reverted' with the reason", async () => {
    const r = await scenario([ST("REVERT_GD", "FAILED", { error_code: "GDR_CONFLICT", error_message: "Revert blocked: state has changed since completion" })]);
    assert.deepStrictEqual(r.alerts, ["error | Goods Delivery GD/20261020/091 was not reverted | Revert blocked: state has changed since completion. Reopen it to continue."]);
  });
  await it("a revert under review -> 'part-way through its revert'", async () => {
    const r = await scenario([ST("REVERT_GD", "REQUIRES_REVIEW", { error_message: "R3_SO: changed" })]);
    assert.strictEqual(r.alerts.length, 1); assert.ok(/^warning \| Goods Delivery GD\/20261020\/091 needs a review \| It stopped part-way through its revert and needs a review/.test(r.alerts[0]), r.alerts[0]);
    assert.deepStrictEqual(r.workers, []);
  });
  await it("unchanged: a cancel -> GD_CANCEL_WORKER, 'has been cancelled'; a completion -> 'has been completed'", async () => {
    let r = await scenario([ST("CANCEL_GD", "COMMITTING_GD"), ST("CANCEL_GD", "COMPLETED")]);
    assert.deepStrictEqual(r.workers.map((w) => w.id), [CANCEL_WORKER]);
    assert.ok(r.messages.indexOf("success: Goods Delivery GD/20261020/091 has been cancelled. Reopen it to see the result.") >= 0, JSON.stringify(r.messages));
    r = await scenario([ST("COMPLETE_GD", "COMPLETED")]);
    assert.ok(r.messages.indexOf("success: Goods Delivery GD/20261020/091 has been completed. Reopen it to see the result.") >= 0, JSON.stringify(r.messages));
  });
  console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
  process.exit(failed ? 1 : 0);
})();
