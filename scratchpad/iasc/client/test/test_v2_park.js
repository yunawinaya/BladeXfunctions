// IA V2 one stock call per run (10-27, the stock-lock fix in prod-hotfix/2026-10-27-ia-output-split): the worker issues the components
// in one run and parks the job at 75 % (due now, no lease); the receipt is the next run's. The Completed / Complete & Post wait
// kicks the worker once as soon as it sees the park instead of at its next 15 s kick; any other state keeps the 15 s cadence.
//   node scratchpad/iasc/client/test/test_v2_park.js
const H = require("./harness");
const F = require("./fixture");
const { check } = H;

const ON = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const SUBMIT = "2112141238600376321";
const WORKER = "2112141277456408577";
const ACC = "2013511169625042946";

const big = [];
for (let i = 0; i < 60; i++) {
  big.push({ item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 1, total_quantity: 1,
    temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", balance_id: "BL2", sm_quantity: 1, category: "Unrestricted" }]), temp_hu_data: "" });
}
const draft = F.header({ id: "4001", page_status: "Edit", stock_movement: big });
const tables = () => F.tables({ extra: {
  accounting_integration: [{ id: "AI1", organization_id: "1001", acc_integration_type: "SQL Accounting V2", agent_id: "A1" }],
  sm_item_assembly: [{ id: "4001", item_assembly_status: "Completed", posted_status: "Unposted", is_deleted: 0 }],
} });
const job = (status, pct) => ({ route: "STATUS", code: "200", job_id: "7001", ia_id: "4001", job_status: status, progress_percent: String(pct),
  terminal: ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"].indexOf(status) >= 0 ? "YES" : "NO" });
// each worker kick is one run; after[k] = the job after k runs (the last one repeats)
const scenario = (after, name) => {
  const w = H.world({ db: H.tableDb(tables()) });
  const rec0 = w.rec;
  w.rec = (...a) => {
    rec0(...a);
    w.trace[w.trace.length - 1].at = w.now;
  };
  const kicks = [];
  const now = () => after[Math.min(kicks.length, after.length - 1)];
  const answer = (id, params) => {
    if (id === SUBMIT && params.operation === "SUBMIT") return { data: { route: "QUEUED", code: "200", job_id: "7001", ia_id: "4001", job_status: "QUEUED" } };
    if (id === SUBMIT && params.operation === "STATUS") return { data: now() };
    if (id === WORKER) {
      kicks.push(w.now);
      return { data: { worker_route: "WORKED", processed: "1", job_id: "7001", job_status: now().job_status } };
    }
    return { data: { code: "200", message: "ok" } };
  };
  const self = H.makeThis(w, ON, { values: H.clone(draft), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, answer), confirm: () => "confirm" });
  const e = H.byName(ON, name);
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self, { field: name === "iaV2_onClick_completed" ? "button_completed" : "comp_post_button",
    fieldNode: name === "iaV2_onClick_completed" ? "button_completed" : "comp_post_button", currentRef: {}, $eventArgs: [] });
  return { w, kicks };
};
// the wait's kicks (the worker calls before the trace entry that ended it, not the after-close kick loop's), relative to the first
const waitKicks = (w, end) => {
  const i = w.trace.indexOf(end);
  const at = w.trace.slice(0, i < 0 ? w.trace.length : i).filter((t) => t[0] === "runWorkflow" && t[1] === WORKER).map((t) => t.at);
  return at.map((t) => t - at[0]);
};
const moved = (w) => w.trace.find((t) => t[0] === "$message.success" && /the stock has moved/.test(t[1]));

(async () => {
  // ---- Completed: run 1 parks; the wait kicks once at the park and closes when the receipt moved (80 %)
  {
    const { w, kicks } = scenario([job("QUEUED", 0), job("COMMITTING_IA", 75), job("COMMITTING_IA", 80), job("COMPLETED", 100)], "iaV2_onClick_completed");
    await H.drain(w);
    const done = moved(w);
    const at = done ? done.at - kicks[0] : null;
    check("Completed, parked after run 1: the wait kicks again at the first status that shows the park (2.5 s), not at 15 s",
      !!done && JSON.stringify(waitKicks(w, done)) === JSON.stringify([0, 2500]), waitKicks(w, done));
    check("Completed, parked after run 1: closed once the receipt moved, 5 s after the click's first kick", at === 5000, at);
  }
  // ---- Completed: the receipt run waits (a stock-lock wait keeps it at 75 %): one park kick, then the 15 s cadence again
  {
    const { w, kicks } = scenario([job("QUEUED", 0), job("COMMITTING_IA", 75), job("COMMITTING_IA", 75), job("COMMITTING_IA", 80), job("COMPLETED", 100)],
      "iaV2_onClick_completed");
    await H.drain(w);
    const done = moved(w);
    check("Completed, the receipt run still at 75 %: kicked once at the park, then 15 s after that kick (not at every status)",
      !!done && JSON.stringify(waitKicks(w, done)) === JSON.stringify([0, 2500, 17500]), waitKicks(w, done));
  }
  // ---- Completed: run 1 still running (70 %, leased): no early kick, the 15 s cadence
  {
    const { w, kicks } = scenario([job("QUEUED", 0), job("COMMITTING_IA", 70), job("COMMITTING_IA", 80), job("COMPLETED", 100)], "iaV2_onClick_completed");
    await H.drain(w);
    const done = moved(w);
    check("Completed, run 1 still running (70 %): no early kick, the next one at 15 s",
      !!done && JSON.stringify(waitKicks(w, done)) === JSON.stringify([0, 15000]), waitKicks(w, done));
  }
  // ---- Complete & Post: parked after run 1; kicked at the park, posted once COMPLETED
  {
    const { w, kicks } = scenario([job("QUEUED", 0), job("COMMITTING_IA", 75), job("COMPLETED", 100)], "iaV2_onClick_completed_post");
    await H.drain(w);
    const post = w.trace.find((t) => t[0] === "runWorkflow" && t[1] === ACC);
    check("Complete & Post, parked after run 1: kicked at the park (2.5 s), posted at 5 s",
      !!post && JSON.stringify(waitKicks(w, post)) === JSON.stringify([0, 2500]) && post.at - kicks[0] === 5000,
      { kicks: waitKicks(w, post), postAt: post ? post.at - kicks[0] : null });
  }
  H.done("test_v2_park");
})();
