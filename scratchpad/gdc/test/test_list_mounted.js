// test_list_mounted.js: Goods Delivery/CompleteV2/gdc_list_mounted.js on a mock list page - 5 workers + the Picking consumer kicked once,
// each re-ticked only while it processes jobs (at most 40 rounds), the 2-minute per-browser throttle, the deep link untouched
const fs = require("fs"), assert = require("assert");
const code = fs.readFileSync(__dirname + "/../../../Goods Delivery/CompleteV2/gdc_list_mounted.js", "utf8");
const COMPLETE = "2110182645714518018", EDIT = "2110618789356687361", CREATE = "2104840667119411201", PICK = "2105134245397041153";
const CANCEL = "2112455700319932418", REVERT = "2112758130420088833"; // GD_CANCEL_WORKER (10-20), GD_REVERT_WORKER (10-21)
const run = (opts) => {
  const store = Object.assign({}, opts.store || {});
  const calls = [], views = [];
  let refreshes = 0;
  const left = Object.assign({}, opts.processed || {});
  const page = {
    runWorkflow(id, params, ok) {
      calls.push(id);
      const n = (left[id] || []).length ? left[id].shift() : 0;
      // a worker reports processed; the Picking consumer reports its route
      ok({ data: typeof n === "object" ? n : { processed: String(n) } });
    },
    refresh() { refreshes++; },
    toView(v) { views.push(v); },
  };
  const g = { window: opts.window || { location: { href: opts.href || "https://x/gd" } }, URL, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, Date: opts.Date || Date, console };
  new Function("window", "URL", "localStorage", "Date", "console", code).call(page, g.window, g.URL, g.localStorage, g.Date, g.console);
  return { calls, refreshes, views, store };
};
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };
t("all six (5 workers + the Picking consumer) kicked once when nothing is due", () => {
  const r = run({});
  assert.deepStrictEqual(r.calls, [COMPLETE, EDIT, CREATE, CANCEL, REVERT, PICK]);
  assert.strictEqual(r.refreshes, 0);
});
t("a worker that processed jobs is re-ticked until it reports none; the other is not", () => {
  const r = run({ processed: { [EDIT]: [2, 1, 0] } });
  // the mock answers synchronously, so only the count per worker is meaningful
  assert.deepStrictEqual([COMPLETE, EDIT, CREATE, CANCEL, REVERT, PICK].map((w) => r.calls.filter((c) => c === w).length), [1, 3, 1, 1, 1, 1]);
  assert.strictEqual(r.refreshes, 2);
});
t("re-ticking stops after 40 rounds per worker", () => {
  const r = run({ processed: { [COMPLETE]: Array(60).fill(1) } });
  assert.strictEqual(r.calls.filter((c) => c === COMPLETE).length, 40);
  assert.strictEqual(r.calls.filter((c) => c === EDIT).length, 1);
  assert.strictEqual(r.calls.filter((c) => c === CREATE).length, 1);
  assert.strictEqual(r.calls.filter((c) => c === PICK).length, 1);
});
t("throttled: a second open within 2 minutes kicks nothing", () => {
  const r = run({ store: { gdc_worker_kick_at: String(Date.now() - 60000) } });
  assert.deepStrictEqual(r.calls, []);
  const later = run({ store: { gdc_worker_kick_at: String(Date.now() - 130000) } });
  assert.deepStrictEqual(later.calls, [COMPLETE, EDIT, CREATE, CANCEL, REVERT, PICK]);
});
t("the Picking consumer is re-ticked while it handles one (DONE / DONE_NONE) and stops at IDLE", () => {
  const r = run({ processed: { [PICK]: [{ consumer_route: "DONE" }, { consumer_route: "DONE_NONE" }, { consumer_route: "IDLE" }, { consumer_route: "DONE" }] } });
  assert.strictEqual(r.calls.filter((c) => c === PICK).length, 3);
  assert.strictEqual(r.refreshes, 2);
  const s = run({ processed: { [PICK]: [{ consumer_route: "SKIP" }, { consumer_route: "DONE" }] } });
  assert.strictEqual(s.calls.filter((c) => c === PICK).length, 1);
});

t("the deep link (?type=&id=) still opens the drawer", () => {
  const r = run({ href: "https://x/gd?type=view&id=123" });
  assert.strictEqual(r.views.length, 1);
  assert.deepStrictEqual([r.views[0].data.id, r.views[0].viewMode], ["123", "disabled"]);
});
// BA 10-25: queued jobs waited up to 2.4 h once the page that queued them closed - the open list now re-kicks every 2 minutes
const beatWindow = (href) => {
  const w = { location: { href: href || "https://x/gd" }, beats: [], cleared: [] };
  w.setInterval = (fn, ms) => { w.beats.push({ fn, ms }); return w.beats.length; };
  w.clearInterval = (id) => { w.cleared.push(id); };
  return w;
};
t("the open list re-kicks all six every 2 minutes; the per-browser throttle still holds", () => {
  const clock = { t: 1000000000000 };
  const w = beatWindow();
  const r = run({ window: w, Date: { now: () => clock.t } });
  assert.deepStrictEqual([w.beats.length, w.beats[0].ms, r.calls.length], [1, 120000, 6]);
  clock.t += 60000;
  w.beats[0].fn();
  assert.strictEqual(r.calls.length, 6); // another tab kicked a minute ago: nothing
  clock.t += 61000;
  w.beats[0].fn();
  assert.deepStrictEqual(r.calls.slice(6), [COMPLETE, EDIT, CREATE, CANCEL, REVERT, PICK]);
});
t("a re-mounted list replaces the beat; leaving the list stops it", () => {
  const w = beatWindow("https://x/gd?type=view&id=1");
  run({ window: w });
  run({ window: w, store: {} });
  assert.deepStrictEqual([w.beats.length, w.cleared], [2, [1]]);
  const calls = run({ window: beatWindow() }).calls.length;
  w.location.href = "https://x/other";
  w.beats[1].fn();
  assert.deepStrictEqual([w.cleared, w.gdcWorkerBeat], [[1, 2], null]);
  assert.strictEqual(calls, 6);
});
console.log(n + " tests passed");
