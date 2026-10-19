// test_client_force.js: Force Complete in the two GD Completion V2 clients (Goods Delivery/CompleteV2/
// gdc_onClick_save_as_completed.js, gdc_list_func_bulkComplete.js). Form: a 406 asks the classic prompt; Proceed resubmits
// to V2 with isForceComplete "Yes", Cancel stops and releases; a 406 after a forced submit, or the switch off, runs the
// classic save. List: a 406 resubmits with the force at once (as its classic path does); a 412 after it keeps the force.
const fs = require("fs"), assert = require("assert");
const DIR = __dirname + "/../../../Goods Delivery/CompleteV2/";
const tick = () => new Promise((r) => setTimeout(r, 0));
const SUBMIT = "2110182609618337794", WORKER = "2110182645714518018", CLASSIC = "2017151544868491265";
let n = 0;
const ok = (name) => { n++; console.log("ok", name); };

async function form(submits, userSays, switchOff) {
  let code = fs.readFileSync(DIR + "gdc_onClick_save_as_completed.js", "utf8");
  if (switchOff) code = code.replace("const FORCE_COMPLETE_V2_ENABLED = true;", "const FORCE_COMPLETE_V2_ENABLED = false;");
  const log = { submits: [], prompts: [], classic: 0, worker: 0, closed: 0 };
  const f = {
    models: { _data: {} }, parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.closed++ } }, refresh: () => {} },
    getValues: () => ({ id: "2106409056132841473", page_status: "Edit", delivery_no: "GD/1" }),
    showLoading: () => {}, hideLoading: () => {}, hide: () => {},
    runWorkflow: (id, params, cb) => {
      if (id === WORKER) { log.worker++; return setTimeout(() => cb({ data: {} }), 0); }
      assert.strictEqual(id, SUBMIT);
      log.submits.push(params.answers);
      const r = submits.shift();
      setTimeout(() => cb({ code: 200, data: r }), 0);
    },
    triggerEvent: async (name) => { if (name === "onClick_save_as_completed") log.classic++; },
    $confirm: (m, t, o) => { log.prompts.push({ m: String(m), ok: o.confirmButtonText, cancel: o.cancelButtonText }); return userSays.shift() ? Promise.resolve() : Promise.reject(new Error("cancel")); },
    $alert: () => Promise.resolve(),
    $message: { success: () => {}, warning: () => {}, error: () => {} },
  };
  new Function(code).call(f);
  for (let k = 0; k < 30; k++) await tick();
  return Object.assign(log, { processing: f.models._data.is_processing });
}
const Q = { route: "QUEUED", code: "200", job_id: "J1", gd_no: "GD/1" };
const F406 = { route: "STOP", code: "406", message: "Picking is not being completed yet. \nProceeding will force complete picking process.\n\nWould you like to proceed?" };

async function list(submits, switchOff) {
  let code = fs.readFileSync(DIR + "gdc_list_func_bulkComplete.js", "utf8");
  if (switchOff) code = code.replace("const FORCE_COMPLETE_V2_ENABLED = true;", "const FORCE_COMPLETE_V2_ENABLED = false;");
  const log = { submits: [], classic: [], prompts: 0 };
  const rows = [{ id: "1", delivery_no: "GD/F", gd_status: "Created" }];
  const page = {
    showLoading: () => {}, hideLoading: () => {}, refresh: () => {},
    getComponent: () => ({ $refs: { crud: { tableSelect: rows } } }),
    $confirm: () => { log.prompts++; return Promise.resolve(); },
    $message: { success: () => {}, warning: () => {}, error: () => {} },
    runWorkflow: (id, params, cb) => {
      if (id === SUBMIT) { log.submits.push(params.answers); return setTimeout(() => cb({ data: submits.shift() }), 0); }
      if (id === WORKER) return setTimeout(() => cb({ data: { processed: "0" } }), 0);
      if (id === CLASSIC) { log.classic.push(params.isForceComplete); return setTimeout(() => cb({ data: { code: "200" } }), 0); }
    },
  };
  global.db = { collection: () => ({ doc: (id) => ({ get: async () => ({ data: [{ id, delivery_no: "GD/F" }] }) }) }) };
  new Function(code).call(page);
  for (let k = 0; k < 60; k++) await tick();
  return log;
}

(async () => {
  let r = await form([F406, Q], [true]);
  assert.strictEqual(r.prompts.length, 1);
  assert.strictEqual(r.prompts[0].m, F406.message, "the server's 406 text is the prompt");
  assert.deepStrictEqual([r.prompts[0].ok, r.prompts[0].cancel], ["Proceed", "Cancel"]);
  assert.deepStrictEqual(r.submits.map((a) => a.isForceComplete), ["", "Yes"]);
  assert.deepStrictEqual([r.classic, r.closed, r.worker, r.processing], [0, 1, 1, 0]);
  ok("form: 406 -> Proceed -> V2 with isForceComplete Yes -> queued, the worker started");

  r = await form([F406], [false]);
  assert.deepStrictEqual([r.submits.length, r.classic, r.closed, r.processing], [1, 0, 0, 0]);
  ok("form: 406 -> Cancel -> nothing more, released");

  r = await form([F406, F406], [true]);
  assert.deepStrictEqual(r.submits.map((a) => a.isForceComplete), ["", "Yes"]);
  assert.strictEqual(r.classic, 1, "a 406 after a forced submit runs the classic save, never a loop");
  ok("form: a 406 on a forced submit -> classic save");

  r = await form([F406], [true], true);
  assert.deepStrictEqual([r.submits.length, r.prompts.length, r.classic], [1, 0, 1]);
  ok("form: switch off -> 406 runs the classic save (which asks itself)");

  r = await form([{ route: "STOP", code: "401", message: "zero?" }, F406, { route: "STOP", code: "403", message: "Override - x" }, Q], [true, true, true]);
  assert.deepStrictEqual(r.submits.map((a) => [a.continueZero, a.isForceComplete, a.needCL]), [["", "", "required"], ["Yes", "", "required"], ["Yes", "Yes", "required"], ["Yes", "Yes", "not required"]]);
  ok("form: answers accumulate across 401 -> 406 -> 403");

  let l = await list([F406, Q]);
  assert.deepStrictEqual(l.submits.map((a) => a.isForceComplete), ["", "Yes"]);
  assert.deepStrictEqual(l.classic, []);
  ok("list: 406 -> V2 with the force at once (no prompt), queued");

  l = await list([F406, { route: "STOP", code: "412", message: "invoice?" }, Q]);
  assert.deepStrictEqual(l.submits.map((a) => [a.isForceComplete, a.auto_si_confirmed || ""]), [["", ""], ["Yes", ""], ["Yes", "true"]]);
  ok("list: 406 -> force -> 412 batch prompt -> resubmitted with the force kept");

  l = await list([F406, F406]);
  assert.strictEqual(l.classic.length, 1, "a second 406 runs the classic path (which forces on GOODS_DELIVERY's own 406)");
  ok("list: a 406 after a forced submit -> classic path");

  l = await list([F406], true);
  assert.deepStrictEqual([l.submits.length, l.classic.length], [1, 1]);
  ok("list: switch off -> 406 runs the classic path");
  console.log(n + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
