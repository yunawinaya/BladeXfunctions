// test_so_form.js: the SO form's Issue (7c0j62pj) and Issue and Post (a2lq37fj) handlers - the EMBEDDED copies in Sales
// Order/SOfullJSON.json - on a mock form: SO_SAVE answers gdEditJobs (the GD edits its cascade released) -> GD_EDIT_WORKER is
// started once per job (fire and forget), before any alert the user can close; no jobs -> no start. The .js mirror of Issue
// must be the embedded handler.
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const SO_SAVE = "1988908545345945602", WORKER = "2110618789356687361";
const form = JSON.parse(fs.readFileSync(R + "Sales Order/SOfullJSON.json", "utf8"));
const handler = (key) => form.config.eventScript.filter((x) => x.key === key)[0].func;

async function scenario(key, o) {
  const code = handler(key);
  const log = [], kicks = [];
  let now = 0; const queue = [];
  const fakeSetTimeout = (fn, ms) => { queue.push({ at: now + (ms || 0), fn }); };
  const values = { id: "5", so_status: "Issued", previous_status: "Issued", organization_id: "9", table_so: [] };
  const self = {
    isEdit: true, isAdd: false,
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.push("closed") } }, refresh: () => log.push("refreshed") },
    validateByColName: async () => ({ valid: true, errors: [] }),
    getValue: (k) => values[k], getValues: () => JSON.parse(JSON.stringify(values)), setData: (x) => Object.assign(values, x),
    showLoading: () => {}, hideLoading: () => {}, display: () => {}, hide: () => {},
    runWorkflow: (id, params, ok, fail) => {
      if (id === WORKER) { kicks.push(String(params.job_id)); log.push("WORKER " + params.job_id); return; }
      if (id === SO_SAVE) { log.push("SO_SAVE"); fakeSetTimeout(() => ok({ code: 200, data: { data: o.answer } }), 0); return; }
      log.push("WF " + id); fakeSetTimeout(() => ok({ code: 200, data: { data: {} } }), 0);
    },
    $alert: (m, t) => { log.push("alert " + (t || "")); return o.alertClosedByX ? Promise.reject("close") : Promise.resolve(); },
    $confirm: () => Promise.resolve(),
    $message: { success: () => log.push("ok"), error: (m) => log.push("error " + String(m).slice(0, 60)), warning: () => log.push("warn"), info: () => {} },
  };
  const quiet = { log: () => {}, warn: () => {}, error: () => {} };
  new Function("setTimeout", "console", code).call(self, fakeSetTimeout, quiet);
  for (let k = 0; k < 200; k++) {
    await new Promise((r) => setImmediate(r));
    if (!queue.length) break;
    const t = queue.shift(); now = Math.max(now, t.at);
    try { await t.fn(); } catch (e) { log.push("threw " + String(e && e.message || e).slice(0, 40)); }
  }
  await new Promise((r) => setImmediate(r));
  return { log, kicks };
}

let failed = 0, n = 0;
const it = async (name, f) => { n++; try { await f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };
(async () => {
  for (const [key, label] of [["7c0j62pj", "Issue"], ["a2lq37fj", "Issue and Post"]]) {
    await it(label + ": the released GD edits -> GD_EDIT_WORKER started once per job", async () => {
      const r = await scenario(key, { answer: { so_id: "5", so_no: "SO/1", gdEditJobs: ["21", "22"] } });
      assert.deepStrictEqual(r.kicks, ["21", "22"], r.log.join(" | "));
    });
    await it(label + ": no GD edits -> nothing started", async () => {
      const r = await scenario(key, { answer: { so_id: "5", so_no: "SO/1" } });
      assert.deepStrictEqual(r.kicks, [], r.log.join(" | "));
    });
  }
  await it("Issue: the stock-to-put-back alert closed with its X -> the worker was already started", async () => {
    const r = await scenario("7c0j62pj", { answer: { so_id: "5", so_no: "SO/1", gdEditJobs: ["21"], pickingReversalNote: "Put back 1 unit" }, alertClosedByX: true });
    assert.deepStrictEqual(r.kicks, ["21"], r.log.join(" | "));
    assert.ok(r.log.indexOf("WORKER 21") < r.log.indexOf("alert Stock to put back"), r.log.join(" | "));
  });
  await it("Issue: a cascade block (gateCode) -> nothing started", async () => {
    const r = await scenario("7c0j62pj", { answer: { gateCode: "406", message: "blocked", gdEditJobs: ["21"] } });
    assert.deepStrictEqual(r.kicks, [], r.log.join(" | "));
  });
  await it("the Issue mirror (SOsaveWorkflow_Issued.js) is the embedded handler", async () => {
    assert.strictEqual(fs.readFileSync(R + "Sales Order/SOsaveWorkflow_Issued.js", "utf8"), handler("7c0j62pj"));
  });
  console.log((n - failed) + "/" + n + " passed");
  process.exit(failed ? 1 : 0);
})();
