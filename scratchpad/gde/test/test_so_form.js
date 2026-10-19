// test_so_form.js: the SO form's Issue (7c0j62pj) and Issue and Post (a2lq37fj) handlers - the EMBEDDED copies in Sales
// Order/SOfullJSON.json - on a mock form: SO_SAVE answers gdEditJobs (the GD edits its cascade released) -> GD_EDIT_WORKER is
// started once per job (fire and forget), before any alert the user can close; no jobs -> no start. The .js mirror of Issue
// must be the embedded handler.
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const SO_SAVE = "1988908545345945602", WORKER = "2110618789356687361";
const form = JSON.parse(fs.readFileSync(R + "Sales Order/SOfullJSON.json", "utf8"));
const handler = (key) => form.config.eventScript.filter((x) => x.key === key)[0].func;

const POST = "2013511169625042946";
async function scenario(key, o) {
  const code = handler(key);
  const log = [], kicks = [], submits = [], alerts = [];
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
      if (id === SO_SAVE) {
        submits.push(JSON.parse(JSON.stringify(params.allData || {})));
        const answer = Array.isArray(o.answers) ? o.answers[Math.min(submits.length - 1, o.answers.length - 1)] : o.answer;
        log.push("SO_SAVE"); fakeSetTimeout(() => ok(Object.assign({ code: 200, data: { data: answer } }, o.envelope || {})), 0); return;
      }
      if (id === POST) { log.push("POST"); fakeSetTimeout(() => ok({ data: {} }), 0); return; }
      log.push("WF " + id); fakeSetTimeout(() => ok({ code: 200, data: { data: {} } }), 0);
    },
    $alert: (m, t) => { log.push("alert " + (t || "")); alerts.push({ t: t, m: String(m) }); return o.alertClosedByX ? Promise.reject("close") : Promise.resolve(); },
    $confirm: (m, t) => { log.push("confirm " + (t || "")); return o.confirmCancel ? Promise.reject("cancel") : Promise.resolve(); },
    $message: { success: () => log.push("ok"), error: (m) => log.push("error " + String(m).slice(0, 60)), warning: () => log.push("warn"), info: () => {} },
  };
  const quiet = { log: () => {}, warn: () => {}, error: () => {} };
  const db = { collection: () => ({ where: () => ({ get: async () => ({ data: [{ acc_integration_type: "AutoCount", agent_id: "a1" }] }) }) }) };
  new Function("setTimeout", "console", "db", code).call(self, fakeSetTimeout, quiet, db);
  for (let k = 0; k < 200; k++) {
    await new Promise((r) => setImmediate(r));
    if (!queue.length) break;
    const t = queue.shift(); now = Math.max(now, t.at);
    try { await t.fn(); } catch (e) { log.push("threw " + String(e && e.message || e).slice(0, 40)); }
  }
  await new Promise((r) => setImmediate(r));
  return { log, kicks, submits, alerts };
}

let failed = 0, n = 0;
const it = async (name, f) => { n++; try { await f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };
(async () => {
  for (const [key, label] of [["7c0j62pj", "Issue"], ["a2lq37fj", "Issue and Post"]]) {
    await it(label + ": the released GD edits -> GD_EDIT_WORKER started once per job", async () => {
      const r = await scenario(key, { answer: { so_id: "5", so_no: "SO/1", gdEditJobs: ["21", "22"] } });
      assert.deepStrictEqual(r.kicks, ["21", "22"], r.log.join(" | "));
    });
    await it(label + ": a GD edit this save could not complete -> its note shown, the save still reported done", async () => {
      const r = await scenario(key, { answer: { so_id: "5", so_no: "SO/1", gdEditJobs: ["21"], gdEditNotes: ["Goods Delivery GD/2 was not updated: short. Change the delivery itself."] } });
      assert.ok(r.log.indexOf("alert Deliveries not updated") >= 0, r.log.join(" | ")); assert.ok(r.log.indexOf("ok") >= 0, r.log.join(" | "));
      const html = await scenario(key, { answer: { so_id: "5", so_no: "SO/1", gdEditJobs: ["21"], gdEditNotes: ["Item <img src=x onerror=alert(1)> & co", "second"] } });
      const a = html.alerts.filter((x) => x.t === "Deliveries not updated")[0];
      assert.strictEqual(a.m, "Item &lt;img src=x onerror=alert(1)&gt; &amp; co<br>second", a.m);
      const none = await scenario(key, { answer: { so_id: "5", so_no: "SO/1", gdEditJobs: ["21"], gdEditNotes: [] } });
      assert.ok(none.log.indexOf("alert Deliveries not updated") < 0, none.log.join(" | "));
    });
    await it(label + ": the stock-to-put-back note is HTML-escaped except its line breaks", async () => {
      const r = await scenario(key, { answer: { so_id: "5", so_no: "SO/1", pickingReversalNote: "Item <img src=x onerror=alert(1)>: return 1<br>Item B: return 2" } });
      const a = r.alerts.filter((x) => x.t === "Stock to put back")[0];
      assert.strictEqual(a.m, "Item &lt;img src=x onerror=alert(1)&gt;: return 1<br>Item B: return 2", a.m);
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
  // Issue and Post: a gate in the 200 body means the order was NOT saved - it must not report success or post
  await it("Issue and Post: a cascade block (gateCode 406) -> explained, nothing posted or started", async () => {
    const r = await scenario("a2lq37fj", { answer: { gateCode: "406", message: "blocked", gdEditJobs: ["21"] } });
    assert.ok(r.log.includes("alert Linked documents"), r.log.join(" | "));
    assert.ok(!r.log.includes("POST") && !r.log.includes("ok") && !r.log.includes("closed"), r.log.join(" | "));
    assert.deepStrictEqual(r.kicks, []);
  });
  await it("Issue and Post: 414 -> asks, saves again with raiseGdQty, then posts", async () => {
    const r = await scenario("a2lq37fj", { answers: [{ gateCode: "414", message: "raise?" }, { so_id: "5", so_no: "SO/1" }] });
    assert.strictEqual(r.submits.length, 2, r.log.join(" | ")); assert.strictEqual(r.submits[1].raiseGdQty, "Yes");
    assert.ok(r.log.includes("confirm Delivery quantity") && r.log.indexOf("POST") > r.log.lastIndexOf("SO_SAVE"), r.log.join(" | "));
  });
  await it("Issue and Post: 413 -> asks, saves again with confirmPickReversal Yes, then posts", async () => {
    const r = await scenario("a2lq37fj", { answers: [{ gateCode: "413", message: "reverse?" }, { so_id: "5", so_no: "SO/1" }] });
    assert.strictEqual(r.submits.length, 2, r.log.join(" | ")); assert.strictEqual(r.submits[1].confirmPickReversal, "Yes");
    assert.ok(r.log.includes("confirm Reverse picked quantities") && r.log.includes("POST"), r.log.join(" | "));
  });
  await it("Issue and Post: 413 cancelled -> not saved again, nothing posted", async () => {
    const r = await scenario("a2lq37fj", { answers: [{ gateCode: "413", message: "reverse?" }], confirmCancel: true });
    assert.strictEqual(r.submits.length, 1, r.log.join(" | ")); assert.ok(!r.log.includes("POST"), r.log.join(" | "));
  });
  await it("Issue and Post: the stock-to-put-back note is shown; closed with its X -> still posts and closes", async () => {
    const r = await scenario("a2lq37fj", { answer: { so_id: "5", so_no: "SO/1", pickingReversalNote: "Put back 1 unit" }, alertClosedByX: true });
    assert.ok(r.log.includes("alert Stock to put back") && r.log.includes("POST") && r.log.includes("closed"), r.log.join(" | "));
  });
  await it("Issue: the stock-to-put-back alert closed with its X -> the dialog still closes", async () => {
    const r = await scenario("7c0j62pj", { answer: { so_id: "5", so_no: "SO/1", pickingReversalNote: "Put back 1 unit" }, alertClosedByX: true });
    assert.ok(r.log.includes("ok") && r.log.includes("closed"), r.log.join(" | "));
  });
  await it("Issue: the approval alert closed with its X -> the dialog still closes", async () => {
    const r = await scenario("7c0j62pj", { answer: { so_id: "5", so_no: "SO/1" }, envelope: { enteredSlotApproval: true }, alertClosedByX: true });
    assert.ok(r.log.includes("alert Approval Required") && r.log.includes("closed"), r.log.join(" | "));
  });
  await it("the Issue mirror (SOsaveWorkflow_Issued.js) is the embedded handler", async () => {
    assert.strictEqual(fs.readFileSync(R + "Sales Order/SOsaveWorkflow_Issued.js", "utf8"), handler("7c0j62pj"));
  });
  console.log((n - failed) + "/" + n + " passed");
  process.exit(failed ? 1 : 0);
})();
