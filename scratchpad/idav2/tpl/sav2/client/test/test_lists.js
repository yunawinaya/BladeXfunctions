// SA list + SC list: the gated worker kick in mounted (OFF = nothing at all), the status badges, and the bulk Post / Delete /
// Edit handlers (unchanged) skipping a Processing adjustment. The OFF / ON variants are derived from the shipped kick whatever
// state it ships in; the shipped state (ON, the ids.json worker id) is asserted first.
//   node test/test_lists.js
const H = require("./harness");
const { check, same, replaceOnce } = H;

const WORKER = "9002";
const LISTS = [
  ["SA list", H.readJSON(H.FILES.saListBase), H.readJSON(H.FILES.saList), "ASYNC_SA_ENABLED"],
  ["SC list", H.readJSON(H.FILES.scListBase), H.readJSON(H.FILES.scList), "ASYNC_SC_REVIEW_ENABLED"],
];

const mount = async (code, o) => {
  o = o || {};
  const w = H.world({ storage: o.storage, storageThrows: o.storageThrows });
  let n = 0;
  const self = H.makeThis(w, { config: { eventScript: [] } }, { answer: (id) => (id === WORKER ? { data: { processed: o.processed ? o.processed(++n) : "0" } } : { data: {} }) });
  H.compile(w, code, false).call(self, {});
  await H.drain(w);
  return w;
};

(async () => {
  for (const [name, base, built, sw] of LISTS) {
    const m0 = H.byName(base, "mounted");
    const m1 = H.byName(built, "mounted");
    check(name + ": the base mounted is empty, the built one is the kick (type js) on its own switch", m0.func === "" && m1.type === "js" && new RegExp("const " + sw + " = (true|false);").test(m1.func));
    check(name + ": shipped ON with the ids.json worker id", same(H.shippedState(m1.func), { on: true, SUBMIT: "", WORKER: H.REAL.WORKER }), H.shippedState(m1.func));
    check(name + ": every other event byte-identical", same(base.config.eventScript.filter((e) => e.name !== "mounted"), built.config.eventScript.filter((e) => e.name !== "mounted")));
    let w = await mount(H.variant(m1.func, false, H.OFF_IDS), { storage: { sa_v2_worker_kick_at: "0" } });
    check(name + " OFF: no call, no browser storage", w.trace.length === 0, w.trace);
    // the switch on but the worker id "0": nothing either
    w = await mount(H.variant(m1.func, true, H.OFF_IDS));
    check(name + " ON with worker id 0: no call", w.trace.length === 0, w.trace);
    // the switch off with a real worker id: nothing
    w = await mount(H.variant(m1.func, false, H.REAL));
    check(name + " OFF with the real worker id: no call", w.trace.length === 0, w.trace);
    const on = H.variant(m1.func, true, { SUBMIT: "", WORKER: WORKER });
    w = await mount(on, { processed: (n) => (n < 3 ? "2" : "0") });
    const calls = w.trace.filter((t) => t[0] === "runWorkflow");
    check(name + " ON: kicks { job_id: \"\" }, chained while processed > 0, refreshes", calls.length === 3 && calls.every((t) => t[1] === WORKER && same(t[2], { job_id: "" })) &&
      w.trace.filter((t) => t[0] === "refresh").length === 2 && w.storage.sa_v2_worker_kick_at === String(1800000000000), w.trace);
    w = await mount(on, { processed: () => "1" });
    check(name + " ON: at most 40 rounds", w.trace.filter((t) => t[0] === "runWorkflow").length === 40);
    w = await mount(on, { storage: { sa_v2_worker_kick_at: String(1800000000000 - 60000) } });
    check(name + " ON: a kick 1 min ago (any list) -> no call", w.trace.filter((t) => t[0] === "runWorkflow").length === 0);
    w = await mount(on, { storage: { sa_v2_worker_kick_at: String(1800000000000 - 121000) } });
    check(name + " ON: a kick 2 min ago -> kicks", w.trace.filter((t) => t[0] === "runWorkflow").length === 1);
    w = await mount(on, { storageThrows: true });
    check(name + " ON: browser storage blocked -> still kicks once", w.trace.filter((t) => t[0] === "runWorkflow").length === 1);
  }

  // SA list: the status badges (old content kept as the prefix) and the bulk handlers
  const [, saBase, saBuilt] = LISTS[0];
  const col = (doc, tab, i) => doc.list[0].tabs[tab].list[0].options.customProps.columns[i];
  const values = (c) => (c.configCustom.content.match(/scope\.value==='([^']+)'/g) || []).map((x) => x.split("'")[1]);
  check("SA list tab 1: Processing and Cancelled badges after the old content", col(saBuilt, 0, 4).configCustom.content.indexOf(col(saBase, 0, 4).configCustom.content) === 0 &&
    same(values(col(saBuilt, 0, 4)), ["Draft", "Completed", "Fully Posted", "Processing", "Cancelled"]));
  check("SA list tab 2 (by item): a Processing badge after the old content", col(saBuilt, 1, 1).configCustom.content.indexOf(col(saBase, 1, 1).configCustom.content.replace(/\n+$/, "")) === 0 &&
    same(values(col(saBuilt, 1, 1)), ["Created", "In Progress", "Cancelled", "Draft", "Completed", "Processing"]));
  const sa = (id, status, o) => Object.assign({ id: id, adjustment_no: "SA-" + id, stock_adjustment_status: status, posted_status: "Unposted", adjustment_type: "Stock Count" }, o || {});
  const page = async (handler, selected) => {
    const w = H.world({ db: (name) => (name === "accounting_integration" ? { data: [{ acc_integration_type: "SQL Accounting V2", agent_id: "A1" }] } : { data: [] }) });
    const self = H.makeThis(w, saBuilt, { components: { custom_y5ewf6w9: { $refs: { crud: { tableSelect: selected, clearSelection: () => w.rec("clearSelection") } } } } });
    H.compile(w, H.byName(saBuilt, handler).func, false).call(self, { row: selected[0] });
    await H.drain(w);
    return w.trace;
  };
  let t = await page("func_post", [sa("1", "Processing"), sa("2", "Completed"), sa("3", "Cancelled")]);
  const updates = t.filter((x) => x[0] === "db.update").map((x) => x[1].doc);
  const posts = t.filter((x) => x[0] === "runWorkflow").map((x) => x[2].payload);
  check("SA list bulk Post: only the Completed adjustment is posted (Processing / Cancelled skipped)", same(updates, ["2"]) && same(posts, [["2"]]), { updates: updates, posts: posts });
  t = await page("func_bulkDelete", [sa("1", "Processing"), sa("4", "Draft"), sa("5", "Cancelled")]);
  check("SA list bulk Delete: only Draft / Cancelled deleted (Processing skipped)", same(t.filter((x) => x[0] === "db.update").map((x) => [x[1].doc, x[2]]), [["4", { is_deleted: 1 }], ["5", { is_deleted: 1 }]]));
  t = await page("func_bulkDelete", [sa("1", "Processing")]);
  check("SA list bulk Delete of a Processing adjustment alone: refused", t.some((x) => x[0] === "$message.error") && !t.some((x) => x[0] === "db.update"));
  H.done("lists");
})();
