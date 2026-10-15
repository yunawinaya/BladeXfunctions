// test_mounted.js: the GD form's mounted (Goods Delivery/GDonMounted.js) on a mock form - the Processing view (a delivery
// saved in the background: read-only, its worker started again, its job followed) - and the form wiring in GDfullJSON.json
// (the mirror, gde_onClick_save_as_created on the Created button, the Processing badge). Each scenario scripts the STATUS
// answers in order; db reads answer empty; setTimeout / Date run on a virtual clock.
const fs = require("fs"), assert = require("assert");
const ROOT = __dirname + "/../../../Goods Delivery/";
const SUBMIT = "2110618741159940097", EDIT_WORKER = "2110618789356687361", COMPLETE_WORKER = "2110182645714518018";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = {
  no_readonly: ['if (status === "Completed" || status === "Processing") {', 'if (status === "Completed") {'],
  no_kick: ["kick(s);", ";"],
  no_stop: ['if (st === "COMPLETED") {', "if (false) {"],
  no_rekick: ["Date.now() - kickedAt >= GD_BG_KICK_MS", "!kickedAt"],
  every_status: ['      status === "Processing"\n    )\n      followBackgroundSave(', '      status\n    )\n      followBackgroundSave('],
};
const ERR = { error: "network" };

async function scenario(o) {
  let code = fs.readFileSync(ROOT + "GDonMounted.js", "utf8");
  if (mutate) { if (code.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant " + mutate + " does not apply"); code = code.split(MUT[mutate][0]).join(MUT[mutate][1]); }
  const log = [], statuses = [], workers = [], reads = [], errors = [], shown = [], hidden = [], disabled = [], messages = [], alerts = [], events = [];
  let now = 1000000, queue = [], refreshed = 0, closed = 0;
  const fakeSetTimeout = (fn, ms) => { queue.push({ at: now + (ms || 0), fn }); return queue.length; };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
  const states = (o.statuses || []).slice();
  const values = Object.assign({ id: "2110639610487418882", delivery_no: "GD/20261015/018", gd_status: "Processing", picking_status: "", so_id: ["2110000000000000001"],
    plant_id: "2105190589240086530", organization_id: "2105190589240086530", from_convert: "", all_item: "", gd_delivery_method: "",
    table_gd: [{ id: "l1", material_id: "m1", so_line_item_id: "s1", gd_qty: 2 }, { id: "l2", material_id: "m2", so_line_item_id: "s2", gd_qty: 1 }] }, o.values || {});
  const list = (x) => (Array.isArray(x) ? x : [x]);
  const chain = (name) => { const c = { where: () => c, filter: () => c, field: () => c, limit: () => c, orderBy: () => c, doc: () => ({ get: () => { reads.push(name + ".doc"); return Promise.resolve({ data: [{ delivered_qty: 0, so_quantity: 5 }] }); } }), get: () => { reads.push(name); return Promise.resolve({ data: [] }); } }; return c; };
  const db = { collection: (name) => chain(name) };
  const quiet = { log: () => {}, warn: () => {}, error: (...a) => errors.push(a.map(String).join(" ").slice(0, 200)) };
  const form = {
    isAdd: false, isEdit: !o.view, isView: !!o.view, isCopy: false,
    models: { _data: {} },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => closed++ } }, refresh: () => refreshed++ },
    getValue: (k) => values[k], getValues: () => values, setData: (x) => Object.assign(values, x),
    getVarGlobal: (k) => (k === "deptParentId" ? "2105190589240086530" : "admin"), getVarSystem: (k) => (k === "tenantId" ? o.tenant || "711077" : "2105190589240086530"),
    display: (x) => shown.push(...list(x)), hide: (x) => hidden.push(...list(x)), disabled: (x, f) => disabled.push({ fields: list(x), flag: f }),
    getComponent: () => ({ hideChildRecord: () => {}, options: {} }), getParamsVariables: () => "", triggerEvent: async (n) => events.push(n),
    onDropdownVisible: () => Promise.resolve([]), getOptionData: () => [], setOptionData: () => {},
    runWorkflow: (id, params, ok, fail) => {
      if (id === EDIT_WORKER || id === COMPLETE_WORKER) { workers.push({ id, params }); return; }
      if (id !== SUBMIT || params.operation !== "STATUS") throw new Error("unexpected workflow " + id + " " + JSON.stringify(params));
      statuses.push(params);
      const s = states.length > 1 ? states.shift() : states[0];
      fakeSetTimeout(() => (s === ERR ? fail(new Error("network")) : ok({ code: 200, data: s || null })), 0);
    },
    $message: { success: (m) => messages.push("success: " + m), warning: (m) => messages.push("warning: " + m), error: (m) => messages.push("error: " + m), info: (m) => messages.push("info: " + m) },
    $alert: (m, t, opt) => { alerts.push(((opt && opt.type) || "") + " | " + (t || "") + " | " + m); return Promise.resolve(); },
  };
  new Function("setTimeout", "Date", "db", "console", code).call(form, fakeSetTimeout, FakeDate, db, quiet);
  for (let k = 0; k < 5000; k++) {
    await new Promise((r) => setImmediate(r));   // every pending promise chain runs first
    if (!queue.length) break;
    queue.sort((a, b) => a.at - b.at);
    const t = queue.shift();
    now = Math.max(now, t.at);
    await t.fn();
  }
  const readOnly = disabled.some((d) => d.flag === true && d.fields.indexOf("order_remark") >= 0) && !disabled.some((d) => d.flag === false && d.fields.indexOf("order_remark") >= 0);
  return { log, statuses, workers, reads, errors, shown, hidden, disabled, messages, alerts, events, refreshed, closed, readOnly, elapsed: now - 1000000 };
}

let failed = 0, n = 0;
const it = async (name, f) => { n++; try { await f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 400)); } };
const ST = (command, job_status, extra) => Object.assign({ route: "STATUS", code: "200", message: "", command: command, job_id: command === "COMPLETE_GD" ? "J2" : "J1", job_status: job_status,
  gd_id: "2110639610487418882", gd_no: "GD/20261015/018", progress_message: "", error_code: "", error_message: "" }, extra || {});
const LOCKED = ["button_save_as_draft", "button_save_as_created", "button_save_as_completed", "button_created_post"];
const PER_LINE = ["Item", "item_balance", "item_batch_balance"];
const why = (r) => JSON.stringify({ statuses: r.statuses.length, workers: r.workers, messages: r.messages, alerts: r.alerts, errors: r.errors, hidden: r.hidden.filter((h) => /button/.test(h)) });

(async () => {
  await it("Edit of a delivery whose edit is running -> read-only + badge, its worker started once, followed to COMPLETED, list refreshed", async () => {
    const r = await scenario({ statuses: [ERR, ST("EDIT_GD", "VALIDATING"), ST("EDIT_GD", "COMMITTING_GD"), ST("EDIT_GD", "COMPLETED")] });
    assert.ok(r.readOnly, "not read-only " + why(r));
    for (const b of LOCKED) assert.ok(r.hidden.indexOf(b) >= 0, b + " not hidden " + why(r));
    assert.ok(r.shown.indexOf("processing_status") >= 0, "no Processing badge");
    assert.deepStrictEqual(r.statuses[0], { operation: "STATUS", gd_id: "2110639610487418882" });
    assert.deepStrictEqual(r.workers, [{ id: EDIT_WORKER, params: { job_id: "J1" } }], why(r));
    assert.strictEqual(r.statuses.length, 4, why(r));
    assert.ok(r.messages.some((m) => /^success: .*GD\/20261015\/018.*saved/.test(m)), why(r));
    assert.strictEqual(r.refreshed, 1); assert.strictEqual(r.closed, 0);
    assert.deepStrictEqual(r.reads.filter((x) => PER_LINE.indexOf(x) >= 0), [], "per-line stock reads on a read-only delivery");
    assert.deepStrictEqual(r.errors.filter((e) => !/status check failed/.test(e)), [], why(r));
  });
  await it("View of a delivery whose completion is running -> GD_COMPLETE_WORKER started with its job", async () => {
    const r = await scenario({ view: true, statuses: [ST("COMPLETE_GD", "READY_TO_COMMIT"), ST("COMPLETE_GD", "COMPLETED")] });
    assert.deepStrictEqual(r.workers, [{ id: COMPLETE_WORKER, params: { job_id: "J2" } }], why(r));
    assert.ok(r.shown.indexOf("processing_status") >= 0); assert.ok(r.messages.some((m) => /^success: /.test(m)), why(r));
    assert.deepStrictEqual(r.errors, [], why(r));
  });
  await it("the job fails while the form is open -> the reason once, polling stops, list refreshed", async () => {
    const r = await scenario({ statuses: [ST("EDIT_GD", "VALIDATING"), ST("EDIT_GD", "FAILED", { error_code: "GDE_STOCK", error_message: "Not enough stock for line 3" })] });
    assert.strictEqual(r.alerts.length, 1, why(r)); assert.ok(/^error \|.*Not enough stock for line 3\. Reopen it to continue\.$/.test(r.alerts[0]), why(r));
    assert.strictEqual(r.statuses.length, 2, why(r)); assert.strictEqual(r.refreshed, 1); assert.ok(r.elapsed < 10000, "elapsed " + r.elapsed);
  });
  await it("a job under review -> one warning, no worker start, no polling", async () => {
    const r = await scenario({ statuses: [ST("EDIT_GD", "REQUIRES_REVIEW", { error_message: "E3: a reservation changed" })] });
    assert.strictEqual(r.alerts.length, 1, why(r)); assert.ok(/^warning \|/.test(r.alerts[0]), why(r));
    assert.deepStrictEqual(r.workers, []); assert.strictEqual(r.statuses.length, 1); assert.ok(r.readOnly);
  });
  await it("Processing without a job (another process) -> read-only, a notice, no worker, no polling", async () => {
    const r = await scenario({ statuses: [Object.assign(ST("", ""), { job_id: "" })] });
    assert.ok(r.readOnly); assert.deepStrictEqual(r.workers, []); assert.strictEqual(r.statuses.length, 1); assert.strictEqual(r.messages.length, 1, why(r));
  });
  await it("still running after 180 s -> polling stops with a notice (bounded STATUS calls and kicks)", async () => {
    const r = await scenario({ statuses: [ST("EDIT_GD", "COMMITTING_GD")] });
    assert.ok(r.elapsed >= 180000 && r.elapsed < 185000, "elapsed " + r.elapsed); assert.ok(r.statuses.length <= 62, "STATUS x" + r.statuses.length);
    assert.ok(r.workers.length >= 2 && r.workers.length <= 13, "kicks x" + r.workers.length); assert.ok(r.messages.some((m) => /still/.test(m)), why(r));
    assert.strictEqual(r.messages.filter((m) => /^info: .*in the background\. It is read-only/.test(m)).length, 1, "the notice repeats on a re-kick " + why(r));
  });
  await it("a job waiting in a retry backoff -> its worker is started again every ~15 s until it moves", async () => {
    const waiting = []; for (let i = 0; i < 14; i++) waiting.push(ST("EDIT_GD", "QUEUED"));
    const r = await scenario({ statuses: waiting.concat([ST("EDIT_GD", "COMMITTING_GD"), ST("EDIT_GD", "COMPLETED")]) });
    assert.ok(r.workers.length >= 3, "kicks x" + r.workers.length + " " + why(r));
    assert.ok(r.workers.every((w) => w.id === EDIT_WORKER && w.params.job_id === "J1"));
    assert.ok(r.messages.some((m) => /^success: /.test(m)), why(r));
  });
  await it("a Created delivery -> today's form: no STATUS, no badge, Created stays", async () => {
    const r = await scenario({ values: { gd_status: "Created" } });
    assert.strictEqual(r.statuses.length, 0); assert.deepStrictEqual(r.workers, []);
    assert.ok(r.shown.indexOf("created_status") >= 0); assert.ok(r.shown.indexOf("processing_status") < 0);
    assert.ok(r.hidden.indexOf("button_save_as_created") < 0, why(r)); assert.ok(!r.readOnly);
    assert.deepStrictEqual(r.errors, [], why(r));
  });
  await it("tenant 128671 -> no Created-and-Post button on a Processing delivery", async () => {
    const r = await scenario({ tenant: "128671", statuses: [ST("EDIT_GD", "COMPLETED")] });
    assert.ok(r.shown.indexOf("button_created_post") < 0, why(r)); assert.ok(r.hidden.indexOf("button_created_post") >= 0);
  });
  await it("a converted delivery that is Processing -> its lines are not re-built from the conversion", async () => {
    const r = await scenario({ values: { from_convert: "Yes", all_item: JSON.stringify([{ material_id: "m1", altUOM: 1 }]) }, statuses: [ST("EDIT_GD", "COMPLETED")] });
    assert.deepStrictEqual(r.events, [], why(r));
  });

  // the form definition: what the designer paste must carry
  if (!mutate) {
    const form = JSON.parse(fs.readFileSync(ROOT + "GDfullJSON.json", "utf8"));
    const es = form.config.eventScript;
    const find = (o, model) => { let hit = null; const walk = (x, parent) => { if (hit || !x || typeof x !== "object") return; if (x.model === model) { hit = { node: x, parent: parent }; return; } for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, x); }; walk(o, null); return hit; };
    await it("form: mounted = GDonMounted.js", async () => {
      assert.strictEqual(es.filter((x) => x.key === "mounted")[0].func, fs.readFileSync(ROOT + "GDonMounted.js", "utf8"));
    });
    await it("form: gde_onClick_save_as_created = the .js, on the Created button; today's handlers stay", async () => {
      const e = es.filter((x) => x.name === "gde_onClick_save_as_created");
      assert.strictEqual(e.length, 1); assert.strictEqual(e[0].type, "js"); assert.ok(/^[a-z0-9]{8}$/.test(e[0].key)); assert.strictEqual(es.filter((x) => x.key === e[0].key).length, 1);
      assert.strictEqual(e[0].func, fs.readFileSync(ROOT + "EditV2/gde_onClick_save_as_created.js", "utf8"));
      assert.strictEqual(find(form.list, "button_save_as_created").node.events.onClick, e[0].key);
      assert.strictEqual(es.filter((x) => x.name === "gdV2_onClick_save_as_created").length, 1); assert.strictEqual(es.filter((x) => x.name === "onClick_save_as_created").length, 1);
    });
    await it("form: a hidden Processing badge next to the other status badges, its own key", async () => {
      const p = find(form.list, "processing_status"), c = find(form.list, "created_status");
      assert.ok(p, "no processing_status"); assert.strictEqual(p.parent, c.parent);
      assert.strictEqual(p.node.type, "html"); assert.strictEqual(p.node.options.hidden, true); assert.strictEqual(p.node.options.dataBind, false);
      assert.ok(/>Processing<\/div>/.test(p.node.options.defaultValue)); assert.ok(/^[a-z0-9]{8}$/.test(p.node.key));
      const keys = []; const walk = (x) => { if (!x || typeof x !== "object") return; if (typeof x.key === "string" && x.model) keys.push(x.key); for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v); }; walk(form.list);
      assert.strictEqual(keys.filter((k) => k === p.node.key).length, 1);
    });
  }
  console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
  process.exit(failed ? 1 : 0);
})();
