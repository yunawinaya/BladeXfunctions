// test_client.js: gde_onClick_save_as_created on a mock form, asserted. Each scenario scripts GD_EDIT_SUBMIT's answers (SUBMIT
// and STATUS, in order) and the user's answers to the prompts; the handler's setTimeout / Date run on a virtual clock (passed
// into its scope), so its 2 s polling and 90 s wait take no real time.
const fs = require("fs"), assert = require("assert");
const FILE = __dirname + "/../../../Goods Delivery/EditV2/gde_onClick_save_as_created.js";
const SUBMIT = "2110618741159940097", WORKER = "2110618789356687361", CONSUMER = "2105134245397041153";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = {
  switch_off: ["const ASYNC_EDIT_ENABLED = true;", "const ASYNC_EDIT_ENABLED = false;"],
  no_carry: ["{ ...answers, continueZero: \"Yes\" }", "{ continueZero: \"Yes\" }"],
  close_on_fail: ["if (st === \"FAILED\" || st === \"CANCELLED\") {", "if (false) {"],
  no_rekick: ["Date.now() - kickedAt >= GDE_KICK_MS", "!kickedAt"],
  refresh_always: ["if (processed > 0 && this.parentGenerateForm)", "if (this.parentGenerateForm)"],
  fallback_off: ["GDE_FALLBACK.indexOf(String(s.error_code)) >= 0 && ", "false && "],
  fallback_no_wait: [" && (await unlocked(q.gd_id))", ""],
};

async function scenario(o) {
  let code = fs.readFileSync(FILE, "utf8");
  if (mutate) { if (code.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant " + mutate + " does not apply"); code = code.split(MUT[mutate][0]).join(MUT[mutate][1]); }
  const log = [], submits = [], statuses = [];
  let now = 1000000, queue = [];
  const fakeSetTimeout = (fn, ms) => { queue.push({ at: now + (ms || 0), fn }); return queue.length; };
  const FakeDate = { now: () => now };
  const answers = (o.submits || []).slice(), states = (o.statuses || []).slice(), says = (o.userSays || []).slice();
  const form = {
    isAdd: !!o.isAdd, isCopy: false, isEdit: !o.isAdd,
    models: { _data: o.processing ? { is_processing: 1 } : {} },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.push("closed") } }, refresh: () => log.push("refreshed") },
    getValues: () => Object.assign({ id: "2110639610487418882", page_status: o.isAdd ? "Add" : "Edit", gd_status: "Draft", delivery_no: "Draft/GD/0002", table_gd: [] }, o.values || {}),
    showLoading: () => {}, hideLoading: () => {},
    hide: () => {},
    runWorkflow: (id, params, ok) => {
      if (id === CONSUMER) { log.push("CONSUMER " + params.event_id); return; }
      if (id === WORKER) { log.push("WORKER " + params.job_id); fakeSetTimeout(() => ok({ code: 200, data: { processed: o.workerProcessed || "0" } }), 1000); return; }
      if (id !== SUBMIT) throw new Error("unexpected workflow " + id);
      if (params.operation === "STATUS") {
        statuses.push(params);
        const s = states.length > 1 ? states.shift() : states[0];
        fakeSetTimeout(() => ok({ code: 200, data: s || null }), 0);
        return;
      }
      submits.push(params);
      const r = answers.shift();
      fakeSetTimeout(() => ok(r === undefined ? null : { code: 200, data: r }), 0);
    },
    triggerEvent: async (n) => log.push("TODAY " + n),
    $confirm: (m, t) => { const yes = says.shift(); log.push("confirm " + (t || "") + " -> " + yes); return yes ? Promise.resolve() : Promise.reject(new Error("cancel")); },
    $alert: (m, t, opt) => { log.push("alert " + (t || "") + ": " + String(m).slice(0, 40)); return o.alertClosedByX ? Promise.reject("close") : Promise.resolve(); },
    $message: { success: (m) => log.push("ok"), warning: (m) => log.push("warn: " + m), error: (m) => log.push("error: " + m), info: (m) => log.push("info") },
  };
  // the client db the platform injects into form events: the delivery's gd_status, as o.gdStatus scripts it (read by read)
  const gdStates = (o.gdStatus || ["Created"]).slice();
  const db = { collection: (name) => ({ where: (w) => ({ field: (f) => ({ get: () => { log.push("READ " + name + " " + f); const st = gdStates.length > 1 ? gdStates.shift() : gdStates[0];
    return new Promise((res) => fakeSetTimeout(() => res({ data: [{ id: w.id, gd_status: st }] }), 0)); } }) }) }) };
  new Function("setTimeout", "Date", "db", code).call(form, fakeSetTimeout, FakeDate, db);
  // drive: settle microtasks, then fire the earliest timer (advancing the clock), until nothing is left
  for (let k = 0; k < 2000; k++) {
    await new Promise((r) => setImmediate(r));   // every pending promise chain runs first
    if (!queue.length) break;
    queue.sort((a, b) => a.at - b.at);
    const t = queue.shift();
    now = Math.max(now, t.at);
    t.fn();
  }
  return { log, submits, statuses, processing: form.models._data.is_processing, elapsed: now - 1000000 };
}

let failed = 0, n = 0;
const it = async (name, f) => { n++; try { await f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };
const Q = { route: "QUEUED", code: "200", command: "EDIT_GD", job_id: "J1", job_status: "QUEUED", gd_id: "2110639610487418882", gd_no: "Draft/GD/0002", picking_reversal_note: "", credit_limit_note: "" };
const ST = (job_status, extra) => Object.assign({ route: "STATUS", code: "200", command: "EDIT_GD", job_id: "J1", job_status: job_status, error_code: "", error_message: "" }, extra || {});

(async () => {
  await it("a new delivery (Add) -> today's handler, no SUBMIT", async () => {
    const r = await scenario({ isAdd: true, values: { id: "" } });
    assert.deepStrictEqual(r.log, ["TODAY gdV2_onClick_save_as_created"]); assert.strictEqual(r.submits.length, 0);
  });
  await it("an edit the background save does not take -> today's handler, released", async () => {
    const r = await scenario({ submits: [{ route: "NOT_ELIGIBLE", code: "300", reason: "it has serial-numbered items" }] });
    assert.deepStrictEqual(r.log, ["TODAY gdV2_onClick_save_as_created"]); assert.strictEqual(r.processing, 0);
    assert.strictEqual(r.submits[0].source, "FORM"); assert.strictEqual(r.submits[0].gd_id, "2110639610487418882"); assert.ok(r.submits[0].form && r.submits[0].form.id);
  });
  await it("queued -> the worker is started, the form waits for the check, ready -> closed", async () => {
    const r = await scenario({ submits: [Q], statuses: [ST("VALIDATING"), ST("READY_TO_COMMIT")], workerProcessed: "1" });
    assert.ok(r.log.indexOf("WORKER J1") >= 0, r.log.join(" | ")); assert.ok(r.log.indexOf("closed") >= 0, r.log.join(" | "));
    assert.strictEqual(r.log.filter((l) => l === "refreshed").length, 2, "the worker that did the work refreshes the list: " + r.log.join(" | "));
    assert.ok(r.statuses.length >= 2); assert.strictEqual(r.statuses[0].gd_id, "2110639610487418882"); assert.strictEqual(r.processing, 0);
  });
  await it("queued -> the check fails -> the reason is shown, the form stays open with the edits", async () => {
    const r = await scenario({ submits: [Q], statuses: [ST("VALIDATING"), ST("FAILED", { error_code: "GDE_STOCK", error_message: "Not enough stock for line 3" })] });
    assert.ok(r.log.some((l) => /^alert .*Not enough stock/.test(l)), r.log.join(" | ")); assert.ok(r.log.indexOf("closed") < 0); assert.strictEqual(r.processing, 0);
  });
  await it("the queued answer's pick-reversal note is shown before the dialog closes", async () => {
    const r = await scenario({ submits: [Object.assign({}, Q, { picking_reversal_note: "Put back 2 units of A" })], statuses: [ST("COMPLETED")] });
    const a = r.log.findIndex((l) => /^alert Stock to put back/.test(l)), c = r.log.indexOf("closed");
    assert.ok(a >= 0 && c > a, r.log.join(" | "));
  });
  await it("the note's alert closed with its X -> still a success: the dialog closes, no error", async () => {
    const r = await scenario({ submits: [Object.assign({}, Q, { picking_reversal_note: "Put back 2 units of A" })], statuses: [ST("COMPLETED")], alertClosedByX: true });
    assert.ok(r.log.indexOf("closed") >= 0, r.log.join(" | ")); assert.ok(!r.log.some((l) => /^error:/.test(l)), r.log.join(" | "));
  });
  await it("401 yes, then 413 yes -> each retry carries every answer given so far", async () => {
    const r = await scenario({ submits: [{ route: "STOP", code: "401", message: "zero qty?" }, { route: "STOP", code: "413", message: "reverse picks?" }, Q], statuses: [ST("COMPLETED")], userSays: [true, true] });
    assert.strictEqual(r.submits.length, 3);
    assert.strictEqual(r.submits[1].answers.continueZero, "Yes"); assert.strictEqual(r.submits[1].answers.needCL, "required");
    assert.strictEqual(r.submits[2].answers.continueZero, "Yes"); assert.strictEqual(r.submits[2].answers.confirmPickReversal, "Yes");
    assert.strictEqual(r.submits[2].answers.needCL, "required");
  });
  await it("403 -> Proceed retries with needCL not required; Cancel stops, released", async () => {
    const y = await scenario({ submits: [{ route: "STOP", code: "403", message: "Override - over limit" }, Q], statuses: [ST("COMPLETED")], userSays: [true] });
    assert.strictEqual(y.submits[1].answers.needCL, "not required");
    const c = await scenario({ submits: [{ route: "STOP", code: "403", message: "Override - over limit" }], userSays: [false] });
    assert.strictEqual(c.submits.length, 1); assert.strictEqual(c.processing, 0); assert.ok(c.log.indexOf("closed") < 0);
  });
  await it("402 -> the block is alerted, nothing retried, released", async () => {
    const r = await scenario({ submits: [{ route: "STOP", code: "402", message: "Block - over credit" }] });
    assert.ok(r.log.some((l) => /^alert : over credit/.test(l)), r.log.join(" | ")); assert.strictEqual(r.submits.length, 1); assert.strictEqual(r.processing, 0);
  });
  await it("busy -> a warning, released", async () => {
    const r = await scenario({ submits: [{ route: "BUSY", code: "409", message: "This delivery is being saved - please wait." }] });
    assert.ok(r.log.some((l) => /^warn: This delivery is being saved/.test(l))); assert.strictEqual(r.processing, 0);
  });
  await it("no verdict within 90 s -> the dialog closes, the save goes on in the background", async () => {
    const r = await scenario({ submits: [Q], statuses: [ST("VALIDATING")] });
    assert.ok(r.log.indexOf("closed") >= 0, r.log.join(" | ")); assert.ok(r.elapsed >= 90000 && r.elapsed < 100000, "elapsed " + r.elapsed); assert.strictEqual(r.processing, 0);
  });
  await it("the job waits in a retry backoff -> the worker is started again every ~15 s", async () => {
    const waiting = []; for (let i = 0; i < 20; i++) waiting.push(ST("QUEUED"));
    const r = await scenario({ submits: [Q], statuses: waiting.concat([ST("READY_TO_COMMIT")]) });
    assert.ok(r.log.filter((l) => l === "WORKER J1").length >= 3, r.log.join(" | ")); assert.ok(r.log.indexOf("closed") >= 0, r.log.join(" | "));
    assert.strictEqual(r.log.filter((l) => l === "refreshed").length, 1, "kicks that did nothing refreshed the list: " + r.log.join(" | "));
  });
  // the inventory engine refuses data the classic save handles: once the delivery is back from Processing, today's handler
  await it("the engine refuses costing rows to migrate -> today's handler with the edits on screen, once the delivery is unlocked", async () => {
    const r = await scenario({ submits: [Q], statuses: [ST("FAILED", { error_code: "GDE_INVENTORY_UNSUPPORTED_COSTING", error_message: "Item 1 has costing rows that need migration" })],
      gdStatus: ["Processing", "Created"] });
    assert.ok(r.log.indexOf("TODAY gdV2_onClick_save_as_created") >= 0, r.log.join(" | ")); assert.ok(!r.log.some((l) => /^alert .*was not saved/.test(l)), r.log.join(" | "));
    assert.strictEqual(r.log.filter((l) => /^READ /.test(l)).length, 2, r.log.join(" | "));
  });
  await it("a duplicate balance row or a negative price falls back too; a stock shortage does not", async () => {
    for (const code of ["GDE_INVENTORY_DUPLICATE_BALANCE", "GDE_INVENTORY_UNSUPPORTED_PRICE"]) {
      const r = await scenario({ submits: [Q], statuses: [ST("FAILED", { error_code: code })] });
      assert.ok(r.log.indexOf("TODAY gdV2_onClick_save_as_created") >= 0, code + ": " + r.log.join(" | "));
    }
    const n = await scenario({ submits: [Q], statuses: [ST("FAILED", { error_code: "GDE_INVENTORY_INSUFFICIENT", error_message: "Insufficient quantity" })] });
    assert.ok(!n.log.some((l) => /^TODAY|^READ /.test(l)), n.log.join(" | ")); assert.ok(n.log.some((l) => /^alert .*was not saved/.test(l)), n.log.join(" | "));
  });
  await it("the delivery is still Processing after the wait -> the reason, no classic save on a locked delivery", async () => {
    const r = await scenario({ submits: [Q], statuses: [ST("FAILED", { error_code: "GDE_INVENTORY_UNSUPPORTED_COSTING" })], gdStatus: ["Processing"] });
    assert.ok(!r.log.some((l) => /^TODAY/.test(l)), r.log.join(" | ")); assert.ok(r.log.some((l) => /^alert .*was not saved/.test(l)), r.log.join(" | "));
  });
  // a GD V2 create whose Picking is not made yet (its outbox event left READY): no Quartz on prod, so the form starts the
  // consumer for that event without waiting (a failure there hits nobody's save) and shows the warning
  await it("BUSY on an unfinished GD V2 create -> its outbox consumer started (fire and forget), the warning shown; other BUSY -> no start", async () => {
    const r = await scenario({ submits: [{ route: "BUSY", code: "409", command: "CREATE_GD_FROM_FORM", message: "Its creation is still running" }] });
    assert.ok(r.log.indexOf("CONSUMER GD_COMMITTED|2110639610487418882|1") >= 0, r.log.join(" | ")); assert.ok(r.log.some((l) => /^warn:/.test(l)), r.log.join(" | "));
    assert.strictEqual(r.processing, 0);
    const o = await scenario({ submits: [{ route: "BUSY", code: "409", command: "COMPLETE_GD", message: "Its completion is running" }] });
    assert.ok(!o.log.some((l) => /^CONSUMER/.test(l)), o.log.join(" | "));
  });
  // job texts carry item names (master data): shown as HTML only for their line breaks
  await it("a failure's reason is HTML-escaped except its line breaks", async () => {
    const r = await scenario({ submits: [Q], statuses: [ST("FAILED", { error_code: "GDE_STOCK", error_message: "<img src=x onerror=alert(1)><br>line 2" })] });
    const a = r.log.filter((l) => /^alert .*was not saved/.test(l))[0] || "";
    assert.ok(a.indexOf("&lt;img src=x onerror=alert(1)&gt;<br>line 2".slice(0, 40)) >= 0 || a.indexOf("&lt;img") >= 0, a); assert.ok(a.indexOf("<img") < 0, a);
  });
  await it("a click while a save is running -> a warning, no SUBMIT", async () => {
    const r = await scenario({ processing: true });
    assert.strictEqual(r.submits.length, 0); assert.ok(r.log.some((l) => /^warn:/.test(l)));
  });
  console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
  process.exit(failed ? 1 : 0);
})();
