// test_list_mounted.js: Goods Delivery/CompleteV2/gdc_list_mounted.js on a mock list page - 3 workers + the Picking consumer kicked once,
// each re-ticked only while it processes jobs (at most 40 rounds), the 2-minute per-browser throttle, the deep link untouched
const fs = require("fs"), assert = require("assert");
const code = fs.readFileSync(__dirname + "/../../../Goods Delivery/CompleteV2/gdc_list_mounted.js", "utf8");
const COMPLETE = "2110182645714518018", EDIT = "2110618789356687361", CREATE = "2104840667119411201", PICK = "2105134245397041153";
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
  const g = { window: { location: { href: opts.href || "https://x/gd" } }, URL, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, Date: opts.Date || Date, console };
  new Function("window", "URL", "localStorage", "Date", "console", code).call(page, g.window, g.URL, g.localStorage, g.Date, g.console);
  return { calls, refreshes, views, store };
};
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };
t("all four (3 workers + the Picking consumer) kicked once when nothing is due", () => {
  const r = run({});
  assert.deepStrictEqual(r.calls, [COMPLETE, EDIT, CREATE, PICK]);
  assert.strictEqual(r.refreshes, 0);
});
t("a worker that processed jobs is re-ticked until it reports none; the other is not", () => {
  const r = run({ processed: { [EDIT]: [2, 1, 0] } });
  // the mock answers synchronously, so only the count per worker is meaningful
  assert.deepStrictEqual([COMPLETE, EDIT, CREATE, PICK].map((w) => r.calls.filter((c) => c === w).length), [1, 3, 1, 1]);
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
  assert.deepStrictEqual(later.calls, [COMPLETE, EDIT, CREATE, PICK]);
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
console.log(n + " tests passed");
