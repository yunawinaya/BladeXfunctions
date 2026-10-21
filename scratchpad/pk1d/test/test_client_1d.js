// test_client_1d.js: Picking V2 1d clients (Task 16) run with a stubbed page (this.runWorkflow answered by a scripted backend)
// and a fake clock: the list's Force Complete (Picking/AsyncV2/pkV2_listForceComplete.js), the list's mounted nudge, the Picking
// form's job state for a force complete (Picking/PickingOnMounted.js pkV2ShowJobState) and Revert Completed's refusal.
const fs = require("fs"), path = require("path"), assert = require("assert");
const R = path.join(__dirname, "../../../");
const FC_FILE = R + "Picking/AsyncV2/pkV2_listForceComplete.js";
const REVERT_FILE = R + "Bulk Actions/Warehouse Management/Picking/RevertCompleted.js";
const FORM_FILE = R + "Picking/PickingOnMounted.js";
const WF = { SUBMIT: "2109531449614647297", WORKER: "2109531412499251201", GD_EDIT_WORKER: "2110618789356687361", LOOP: "2021065804251615233" };
let failed = 0, n = 0;
const tests = [];
const it = (name, f) => tests.push([name, f]);

// a page: the calls it makes, the messages it shows; runWorkflow answered by backend(id, params, page) after `ms` of fake time
function page(backend, opts) {
  const o = Object.assign({ selected: [], confirm: true }, opts || {});
  const clock = { now: 1790000000000, timers: [] };
  const p = {
    calls: [], messages: [], loading: [], confirms: [], refreshed: 0, clock,
    getComponent: () => ({ $refs: { crud: { tableSelect: o.selected } } }),
    getVarGlobal: (k) => ({ deptParentId: "9", nickname: "tester" })[k],
    getVarSystem: () => "9",
    showLoading: (t) => p.loading.push(t || ""), hideLoading: () => p.loading.push("<hide>"),
    refresh: () => { p.refreshed++; }, hide: () => {}, display: () => {},
    $message: { success: (m) => p.messages.push(["success", m]), error: (m) => p.messages.push(["error", m]), warning: (m) => p.messages.push(["warning", m]), info: (m) => p.messages.push(["info", m]) },
    $confirm: (text, title) => { p.confirms.push([title, text]); return o.confirm ? Promise.resolve() : Promise.reject(new Error("cancel")); },
    $alert: (text, title) => { p.messages.push(["alert", (title ? title + ": " : "") + text]); return Promise.resolve(); },
    runWorkflow: (id, params, ok, fail) => {
      p.calls.push([id, Object.assign({}, params), clock.now]);
      const r = backend(id, params, p);
      const ms = (r && r.ms) || 0;
      clock.timers.push({ at: clock.now + ms, fn: () => (r && r.error ? fail && fail(new Error(r.error)) : ok && ok({ data: r ? r.data : null })) });
    },
  };
  return p;
}
// db.collection(...).doc(id).get() for the classic path
const fakeDb = (docs) => ({ collection: () => ({ doc: (id) => ({ get: () => Promise.resolve({ data: docs[id] ? [docs[id]] : [] }) }), where: () => ({ get: () => Promise.resolve({ data: [] }) }) }) });

const ON = (src) => src.replace("const ASYNC_FORCE_COMPLETE_ENABLED = false;", "const ASYNC_FORCE_COMPLETE_ENABLED = true;");
const OFF = (src) => src.replace("const ASYNC_FORCE_COMPLETE_ENABLED = true;", "const ASYNC_FORCE_COMPLETE_ENABLED = false;");
async function run(file, p, docs, transform) {
  let src = fs.readFileSync(file, "utf8");
  if (file === FC_FILE && transform !== "AS_SHIPPED") src = ON(src);
  if (typeof transform === "function") src = transform(src);
  const clock = p.clock;
  const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } };
  const setT = (fn, ms) => { clock.timers.push({ at: clock.now + (ms || 0), fn }); };
  new Function("db", "setTimeout", "Date", "window", src).call(p, fakeDb(docs || {}), setT, FakeDate, { location: { href: "https://dev.example/picking" }, localStorage: { getItem: () => null, setItem: () => {} } });
  for (let i = 0; i < 200000; i++) {
    for (let k = 0; k < 20; k++) await new Promise((r) => setImmediate(r));
    if (!clock.timers.length) return p;
    clock.timers.sort((a, b) => a.at - b.at);
    const t = clock.timers.shift();
    clock.now = Math.max(clock.now, t.at);
    t.fn();
  }
  throw new Error("the page did not settle");
}
const calls = (p, id) => p.calls.filter((c) => c[0] === id);
const last = (p) => p.messages[p.messages.length - 1] || [];
const IP = (id, no) => ({ id: id, to_id: no, to_status: "In Progress", organization_id: "9" });

// a scripted force complete: QUEUED -> each WORKER kick advances it; STATUS answers its state; edits named in kick until run
function fcBackend(script) {
  const st = { step: 0, workerCalls: 0, gdRuns: {}, classic: 0 };
  const b = (id, params) => {
    if (id === WF.SUBMIT && params.operation === "FORCE_COMPLETE") return { data: script.submit || { route: "QUEUED", result_code: "200", job_id: "J1", job_status: "QUEUED" } };
    if (id === WF.SUBMIT && params.operation === "STATUS") return { data: Object.assign({ route: "STATUS", job_id: "J1", operation: "FORCE_COMPLETE" }, script.states[Math.min(st.step, script.states.length - 1)]) };
    if (id === WF.WORKER) { st.workerCalls++; if (script.advanceOn === "worker") st.step++; return { data: { worker_route: "WORKED" }, ms: 500 }; }
    if (id === WF.GD_EDIT_WORKER) { st.gdRuns[params.job_id] = (st.gdRuns[params.job_id] || 0) + 1; return { data: { worker_route: "WORKED" }, ms: script.gdMs || 2000 }; }
    if (id === WF.LOOP) { st.classic++; return { data: { code: "200", success: true } }; }
    return { data: {} };
  };
  b.st = st;
  return b;
}

it("6 the confirmation text, as the spec words it", async () => {
  const b = fcBackend({ states: [{ job_status: "COMPLETED", result_message: "PI-1 force completed: 1 delivery updated, 1 line(s) reduced, 0 removed" }] });
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1"), IP("12", "PI-2")] }));
  const [title, text] = p.confirms[0];
  assert.strictEqual(title, "Picking Force Completion");
  assert.ok(text.indexOf("You've selected 2 picking(s) to force complete: PI-1, PI-2.") === 0, text);
  for (const line of ["Each picking is closed with what has already been picked:", "every delivery line is reduced to its picked quantity, taken from the picked bins, batches and handling units;",
    "lines with nothing picked are removed from the delivery;", "the reserved stock of the unpicked quantity is released;", "the sales order gets that quantity back as open.",
    "This runs in the background. Proceed?"]) assert.ok(text.indexOf(line) >= 0, "missing: " + line);
});

it("1 the switch ships ON with SUBMIT's STAGE.FORCE_COMPLETE (user 10-21): as shipped, a force complete runs in the background", async () => {
  assert.ok(/const ASYNC_FORCE_COMPLETE_ENABLED = true;/.test(fs.readFileSync(FC_FILE, "utf8")), "the list switch ships on");
  assert.ok(fs.readFileSync(R + "Picking/AsyncV2/PICKING_ASYNC_SUBMIT.json", "utf8").indexOf("FORCE_COMPLETE: true }") >= 0, "SUBMIT's STAGE.FORCE_COMPLETE ships on with it");
  const b = fcBackend({ states: [{ job_status: "COMPLETED", result_message: "PI-1 force completed: 1 delivery updated, 0 line(s) reduced, 0 removed" }] });
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1")] }), { 11: { id: "11", to_id: "PI-1" } }, "AS_SHIPPED");
  assert.strictEqual(calls(p, WF.SUBMIT).filter((c) => c[1].operation === "FORCE_COMPLETE").length, 1);
  assert.strictEqual(calls(p, WF.LOOP).length, 0);
});

it("1b the switch off: today's classic force complete for each Picking, nothing in the background", async () => {
  const b = fcBackend({ states: [] });
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1")] }), { 11: { id: "11", to_id: "PI-1" } }, OFF);
  assert.deepStrictEqual(calls(p, WF.SUBMIT).length, 0);
  const c = calls(p, WF.LOOP);
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual([c[0][1].isForceComplete, c[0][1].saveAs, c[0][1].arrayData[0].id], [1, "Completed", "11"]);
  assert.ok(/Warning:<\/strong> Force completing will mark all remaining items as completed/.test(p.confirms[0][1]), "the classic confirmation");
});

it("2 a Picking that is not In Progress is listed as skipped", async () => {
  const b = fcBackend({ states: [{ job_status: "COMPLETED", result_message: "PI-1 force completed: 1 delivery updated, 0 line(s) reduced, 0 removed" }] });
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1"), { id: "13", to_id: "PI-3", to_status: "Completed", organization_id: "9" }] }));
  assert.strictEqual(calls(p, WF.SUBMIT).filter((c) => c[1].operation === "FORCE_COMPLETE").length, 1);
  assert.ok(/Skipped \(not In Progress\): PI-3/.test(last(p)[1]), JSON.stringify(last(p)));
});

it("3 QUEUED: the worker kicked, STATUS every 3 s, kicked edits run (each once, then the worker again), a re-kick every 15 s, still running at 180 s", async () => {
  const b = fcBackend({ states: [{ job_status: "READY_TO_COMMIT", result_message: "Preparing the deliveries: 0 of 2 ready", kick: ["E1", "E2"] }] });
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1")] }));
  const st = calls(p, WF.SUBMIT).filter((c) => c[1].operation === "STATUS").map((c) => c[2]);
  const t0 = calls(p, WF.SUBMIT)[0][2];
  assert.ok(st.length >= 55 && st.length <= 61, "STATUS polls: " + st.length);
  assert.ok(st.slice(1).every((t, i) => t - st[i] >= 3000), "every 3 s");
  assert.ok(st[st.length - 1] - t0 <= 180000 + 3000, "stops by 180 s");
  assert.deepStrictEqual(Object.keys(b.st.gdRuns).sort(), ["E1", "E2"]);
  const w = calls(p, WF.WORKER).map((c) => c[2] - t0);
  assert.ok(w[0] === 0 || w[0] < 1000, "the worker kicked at once");
  assert.ok(w.length >= 12, "re-kicks: " + w.length);
  assert.ok(/PI-1: still being saved in the background/.test(last(p)[1]), JSON.stringify(last(p)));
  assert.ok(p.loading.some((t) => /PI-1: Preparing the deliveries: 0 of 2 ready/.test(t)), "progress shown");
});

it("3b an edit's worker run in flight is not started again", async () => {
  const b = fcBackend({ states: [{ job_status: "COMMITTING_PICKING", result_message: "Updating delivery 1 of 1", kick: ["E1"] }], gdMs: 60000 });
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1")] }));
  const starts = calls(p, WF.GD_EDIT_WORKER).map((c) => c[2]);
  assert.ok(starts.length >= 2 && starts.every((t, i) => i === 0 || t - starts[i - 1] >= 60000), "overlapping runs: " + JSON.stringify(starts.map((t) => t - starts[0])));
});

it("3e a long edit run counts as progress: followed while it runs, past 180 s", async () => {
  const b = fcBackend({ states: [{ job_status: "COMMITTING_PICKING", result_message: "Updating delivery 1 of 1", kick: ["E1"] }], gdMs: 300000 });
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1")] }));
  const t = calls(p, WF.SUBMIT).map((c) => c[2]);
  assert.ok(t.some((x) => x - t[0] > 250000), "stopped following during the 300 s run: last poll at " + (t[t.length - 1] - t[0]));
});

it("4 NOT_ELIGIBLE with classic_ok 1 -> the classic force complete; with classic_ok 0 -> its message, no classic call", async () => {
  const b1 = fcBackend({ submit: { route: "NOT_ELIGIBLE", result_code: "300", result_message: "Full Picking uses the classic save", classic_ok: "1" }, states: [] });
  const p1 = await run(FC_FILE, page(b1, { selected: [IP("11", "PI-1")] }), { 11: { id: "11", to_id: "PI-1" } });
  assert.deepStrictEqual([b1.st.classic, calls(p1, WF.LOOP)[0][1].isForceComplete], [1, 1]);
  const b0 = fcBackend({ submit: { route: "NOT_ELIGIBLE", result_code: "300", result_message: "too big for the classic force complete", classic_ok: "0" }, states: [] });
  const p0 = await run(FC_FILE, page(b0, { selected: [IP("11", "PI-1")] }));
  assert.strictEqual(b0.st.classic, 0);
  assert.ok(/PI-1: too big for the classic force complete/.test(last(p0)[1]), JSON.stringify(last(p0)));
});

it("4b a Picking that falls back to the classic force complete says so: its sales order is not given the quantity back", async () => {
  const b1 = fcBackend({ submit: { route: "NOT_ELIGIBLE", result_code: "300", result_message: "Full Picking uses the classic force complete", classic_ok: "1" }, states: [] });
  const p1 = await run(FC_FILE, page(b1, { selected: [IP("11", "PI-1")] }), { 11: { id: "11", to_id: "PI-1" } });
  assert.ok(/PI-1: completed by the classic force complete \(Full Picking uses the classic force complete\): the sales order was not given the unpicked quantity back/.test(last(p1)[1]),
    JSON.stringify(last(p1)));
});

it("3c steady progress: followed past 180 s to the end (180 s without progress stops it, 15 min in all)", async () => {
  // a step every 20 s: 12 deliveries, then COMPLETED - about 4 minutes
  const states = Array.from({ length: 12 }, (x, i) => ({ job_status: "COMMITTING_PICKING", result_message: "Updating delivery " + (i + 1) + " of 12", kick: [] }))
    .concat([{ job_status: "COMPLETED", result_message: "PI-1 force completed: 12 deliveries updated, 12 line(s) reduced, 0 removed" }]);
  let t0 = null;
  const b = (id, params, p) => {
    if (id === WF.SUBMIT && params.operation === "FORCE_COMPLETE") { t0 = p.clock.now; return { data: { route: "QUEUED", result_code: "200", job_id: "J1", job_status: "QUEUED" } }; }
    if (id === WF.SUBMIT) return { data: Object.assign({ route: "STATUS", job_id: "J1" }, states[Math.min(states.length - 1, Math.floor((p.clock.now - t0) / 20000))]) };
    return { data: {} };
  };
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1")] }));
  assert.deepStrictEqual(last(p), ["success", "PI-1 force completed: 12 deliveries updated, 12 line(s) reduced, 0 removed"]);
  const t = calls(p, WF.SUBMIT).map((c) => c[2]);
  assert.ok(t[t.length - 1] - t[0] > 180000, "followed past 180 s");
});

it("3d endless progress: stops after 15 minutes, telling the user how to let it finish", async () => {
  let k = 0;
  const b = (id, params) => (id === WF.SUBMIT && params.operation === "FORCE_COMPLETE" ? { data: { route: "QUEUED", result_code: "200", job_id: "J1", job_status: "QUEUED" } }
    : id === WF.SUBMIT ? { data: { route: "STATUS", job_id: "J1", job_status: "COMMITTING_PICKING", result_message: "step " + (++k), kick: [] } } : { data: {} });
  const p = await run(FC_FILE, page(b, { selected: [IP("11", "PI-1")] }));
  const t = calls(p, WF.SUBMIT).map((c) => c[2]);
  assert.ok(t[t.length - 1] - t[0] <= 900000 + 3000 && t[t.length - 1] - t[0] >= 900000 - 3000, "stopped at " + (t[t.length - 1] - t[0]) + " ms");
  assert.ok(/still being saved in the background: keep this list open, or open it again, to let it finish/.test(last(p)[1]), JSON.stringify(last(p)));
});

it("5 COMPLETED / FAILED / REQUIRES_REVIEW worded as the spec", async () => {
  const done = fcBackend({ states: [{ job_status: "COMPLETED", result_message: "PI-1 force completed: 8 deliveries updated, 12 line(s) reduced, 3 removed" }] });
  const pd = await run(FC_FILE, page(done, { selected: [IP("11", "PI-1")] }));
  assert.deepStrictEqual(last(pd), ["success", "PI-1 force completed: 8 deliveries updated, 12 line(s) reduced, 3 removed"]);
  const fail = fcBackend({ states: [{ job_status: "FAILED", result_code: "PK_FC_GD_UNPICKED", result_message: "GD/2 has nothing picked: cancel it first, then force complete." }] });
  const pf = await run(FC_FILE, page(fail, { selected: [IP("11", "PI-1")] }));
  assert.ok(/PI-1: nothing was saved: GD\/2 has nothing picked/.test(last(pf)[1]) && last(pf)[0] === "error", JSON.stringify(last(pf)));
  const rev = fcBackend({ states: [{ job_status: "REQUIRES_REVIEW", result_code: "GDE_E1_REFUSED", result_message: "GD/2: refused" }] });
  const pr = await run(FC_FILE, page(rev, { selected: [IP("11", "PI-1")] }));
  assert.ok(/PI-1: stopped half-way and is under review: please contact support/.test(last(pr)[1]), JSON.stringify(last(pr)));
});

it("5b a FAILED answer that already says nothing was saved is not repeated", async () => {
  const fail = fcBackend({ states: [{ job_status: "FAILED", result_message: "GD/2 changed since the force complete was prepared: nothing was saved. Try again." }] });
  const pf = await run(FC_FILE, page(fail, { selected: [IP("11", "PI-1")] }));
  assert.strictEqual((last(pf)[1].match(/nothing was saved/g) || []).length, 1, last(pf)[1]);
});

it("7 Revert Completed: a Picking force completed in the background is refused", async () => {
  const b = (id, params) => (id === WF.SUBMIT && params.operation === "STATUS" ? { data: { route: "STATUS", job_id: "J1", job_status: "COMPLETED", operation: params.picking_id === "21" ? "FORCE_COMPLETE" : "CONFIRM" } } : { data: {} });
  const p = await run(REVERT_FILE, page(b, { selected: [{ id: "21", to_id: "PI-21", to_status: "Completed", delivery_status: "" }] }));
  assert.ok(p.messages.some(([, m]) => /This Picking was force completed: its deliveries were reduced\. Create a new delivery from the sales order for the rest\./.test(m)), JSON.stringify(p.messages));
  assert.strictEqual(p.confirms.length, 0, "no revert confirmation for it");
});

it("7b Revert Completed: a confirmed (or classic force-completed) Picking reverts as before", async () => {
  const b = (id, params) => (id === WF.SUBMIT && params.operation === "STATUS" ? { data: { route: "STATUS", job_id: "J1", job_status: "COMPLETED", operation: params.picking_id === "21" ? "FORCE_COMPLETE" : "CONFIRM" } } : { data: {} });
  const p = await run(REVERT_FILE, page(b, { selected: [{ id: "21", to_id: "PI-21", to_status: "Completed", delivery_status: "" }, { id: "22", to_id: "PI-22", to_status: "Completed", delivery_status: "" }], confirm: false }));
  assert.strictEqual(p.confirms.length, 1);
  assert.ok(/PI-22/.test(p.confirms[0][1]) && !/PI-21/.test(p.confirms[0][1]), p.confirms[0][1]);
});

it("10 the mirrors: every handler in the page / form JSON equals its .js file", async () => {
  const pageDoc = JSON.parse(fs.readFileSync(R + "Picking/PickingListPageFullJSON.json", "utf8"));
  const formDoc = JSON.parse(fs.readFileSync(R + "Picking/PickingFullJSON.json", "utf8"));
  const fn = (doc, key) => doc.config.eventScript.filter((e) => e.key === key || e.name === key)[0].func.trim();
  for (const [doc, key, file] of [[pageDoc, "lkaac27r", FC_FILE], [pageDoc, "0xheshn9", REVERT_FILE], [pageDoc, "mounted", R + "Picking Plan/PPonMountedListPage.js"], [formDoc, "mounted", FORM_FILE]]) {
    assert.strictEqual(fn(doc, key), fs.readFileSync(file, "utf8").trim(), key + " differs from " + path.basename(file));
  }
});

it("8 the Picking form: an open force complete is worded as one and its kicked edits are run", async () => {
  const src = fs.readFileSync(FORM_FILE, "utf8");
  const fn = src.slice(src.indexOf("const pkV2ShowJobState = async () => {"), src.indexOf("// Main execution function"));
  assert.ok(fn.length > 100, "pkV2ShowJobState found");
  const b = (id, params) => (id === WF.SUBMIT ? { data: { route: "STATUS", job_id: "J1", job_status: "COMMITTING_PICKING", operation: "FORCE_COMPLETE", result_message: "Updating delivery 2 of 3", kick: ["E7"] } }
    : { data: {} });
  const p = page(b);
  p.getValue = (k) => ({ id: "11", organization_id: "9" })[k];
  await run(FORM_FILE, p, {}, () => fn + "\npkV2ShowJobState();");
  assert.ok(p.messages.some(([, m]) => /being force completed in the background \(Updating delivery 2 of 3\)/.test(m)), JSON.stringify(p.messages));
  assert.deepStrictEqual(calls(p, WF.GD_EDIT_WORKER).map((c) => c[1].job_id), ["E7"]);
  assert.strictEqual(calls(p, WF.WORKER).length >= 1, true);
});

it("8b the Picking form: a failed / reviewed force complete is worded as one", async () => {
  const src = fs.readFileSync(FORM_FILE, "utf8");
  const fn = src.slice(src.indexOf("const pkV2ShowJobState = async () => {"), src.indexOf("// Main execution function"));
  for (const [st, re] of [["FAILED", /The force complete was not saved: GD\/2 changed/], ["REQUIRES_REVIEW", /The force complete stopped half-way and is under review/]]) {
    const b = () => ({ data: { route: "STATUS", job_id: "J1", job_status: st, operation: "FORCE_COMPLETE", result_message: "GD/2 changed" } });
    const p = page(b);
    p.getValue = (k) => ({ id: "11", organization_id: "9" })[k];
    await run(FORM_FILE, p, {}, () => fn + "\npkV2ShowJobState();");
    assert.ok(p.messages.some(([, m]) => re.test(m)), st + ": " + JSON.stringify(p.messages));
  }
});

it("9 the list's open starts the Picking worker and the delivery-edit worker (no job id: their due jobs)", async () => {
  const p = await run(R + "Picking Plan/PPonMountedListPage.js", page(() => ({ data: {} })));
  assert.deepStrictEqual([calls(p, WF.WORKER).map((c) => c[1].job_id), calls(p, WF.GD_EDIT_WORKER).map((c) => c[1].job_id)], [[""], [""]]);
});

(async () => {
  for (const [name, f] of tests) {
    n++;
    try { await f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0].slice(0, 300)); }
  }
  console.log(n - failed + "/" + n + " passed");
  process.exit(failed ? 1 : 0);
})();
