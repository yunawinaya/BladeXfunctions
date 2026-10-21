// IDA list: the gated worker kick in mounted (OFF = nothing at all), the Edit row action hidden for Processing, Delete refusing
// Processing and re-reading the stored status (the bulk Post: test_post.js).
//   node test/test_lists.js
const H = require("./harness");
const { check, same } = H;

const BASE = H.readJSON(H.FILES.listBase);
const BUILT = H.readJSON(H.FILES.list);
const T = H.TEST_IDS;
const named = (trace, name) => trace.filter((t) => t[0] === name);

const mount = async (code, o) => {
  o = o || {};
  const w = H.world({ storage: o.storage, storageThrows: o.storageThrows });
  const n = {};
  const self = H.makeThis(w, BUILT, { answer: (id) => {
    n[id] = (n[id] || 0) + 1;
    if (o.reject && o.reject(n[id])) return { reject: new Error("network") };
    return { data: { processed: o.processed ? o.processed(id, n[id]) : "0" } };
  } });
  H.compile(w, code, false).call(self, {});
  await H.drain(w);
  return w;
};

const ida = (id, status, o) => Object.assign({ id: id, stock_movement_no: "IDA-" + id, item_disassembly_status: { dict_key: status }, organization_id: "1123598813738675201",
  posted_status: { dict_key: "Unposted" } }, o || {});
const page = async (doc, handler, selected, o) => {
  o = o || {};
  const w = H.world({ db: o.db || (() => ({ data: [] })) });
  const self = H.makeThis(w, doc, {
    components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: selected, clearSelection: () => w.rec("clearSelection") } } } },
    confirm: o.confirm,
    answer: () => ({ data: {} }),
  });
  H.compile(w, H.byName(doc, handler).func, false).call(self, { row: o.row || selected[0] });
  await H.drain(w);
  return w;
};

(async () => {
  // ---- mounted: the worker on its switch, throttled 2 minutes per browser
  const m0 = H.byName(BASE, "mounted");
  const m1 = H.byName(BUILT, "mounted");
  check("list: the base mounted is empty, the built one is the kick (type js)", m0.func === "" && m0.type === undefined && m1.type === "js");
  check("list mounted: shipped " + (H.EXPECT_ON ? "ON" : "OFF") + " with the ids.json worker id", same(H.shippedState(m1.func).switches, { ASYNC_IDA_ENABLED: H.EXPECT_ON }) &&
    same(H.shippedState(m1.func).ids, { IDA_V2_WORKER: H.IDS.IDA_V2_WORKER }), H.shippedState(m1.func));
  let w = await mount(H.variant(m1.func, { master: false }, T), { storage: { ida_v2_worker_kick_at: "0" } });
  check("list mounted OFF (real-looking id): no call, no browser storage", w.trace.length === 0, w.trace);
  w = await mount(H.variant(m1.func, { master: false }, H.OFF_IDS));
  check("list mounted OFF: no call, no browser storage", w.trace.length === 0, w.trace);
  w = await mount(H.variant(m1.func, { master: true }, H.OFF_IDS));
  check("list mounted ON with worker id 0: no call", w.trace.length === 0, w.trace);
  const on = H.variant(m1.func, { master: true }, T);
  w = await mount(on, { processed: (id, n) => (n < 3 ? "2" : "0") });
  const calls = w.trace.filter((t) => t[0] === "runWorkflow");
  check("list mounted ON: the worker kicked { job_id: \"\" }, chained while processed > 0, refreshed", calls.length === 3 && calls.every((t) => t[1] === T.IDA_V2_WORKER && same(t[2], { job_id: "" })) &&
    named(w.trace, "refresh").length === 2 && w.storage.ida_v2_worker_kick_at === String(1800000000000), calls.map((t) => t[1]));
  w = await mount(on, { processed: () => "1" });
  check("list mounted ON: at most 40 rounds", w.trace.filter((t) => t[0] === "runWorkflow").length === 40);
  w = await mount(on, { storage: { ida_v2_worker_kick_at: String(1800000000000 - 60000) } });
  check("list mounted ON: kicked 1 min ago in this browser -> no call", w.trace.filter((t) => t[0] === "runWorkflow").length === 0);
  w = await mount(on, { storage: { ida_v2_worker_kick_at: String(1800000000000 - 121000) } });
  check("list mounted ON: 2 min passed -> kicked, the time stamped", w.trace.filter((t) => t[0] === "runWorkflow").length === 1 && w.storage.ida_v2_worker_kick_at === String(1800000000000));
  w = await mount(on, { storage: { ida_v2_worker_kick_at: "garbage" } });
  check("list mounted ON: an unreadable stamp -> kicked", w.trace.filter((t) => t[0] === "runWorkflow").length === 1);
  w = await mount(on, { storageThrows: true });
  check("list mounted ON: browser storage blocked -> still kicks once", w.trace.filter((t) => t[0] === "runWorkflow").length === 1);
  w = await mount(on, { reject: () => true });
  check("list mounted ON: a failed tick ends the chain quietly", w.trace.filter((t) => t[0] === "runWorkflow").length === 1 && named(w.trace, "uncaught").length === 0);

  // ---- the Edit row action: hidden for Processing (tested first) and, as before, for Pending Post
  {
    const ra = BUILT.list[0].options.customProps.rowActions[1];
    const evalOf = (text) => (row) => {
      try {
        return Function("arguments", "return " + text.replace(/^\{\{|\}\}$/g, ""))([{ row: row }]);
      } catch (e) {
        return "THROWS";
      }
    };
    const hidden = evalOf(ra.hidden);
    const baseHidden = evalOf(BASE.list[0].options.customProps.rowActions[1].hidden);
    check("Edit hidden: the Processing test first, then the base expression (CONTRACT section 12 test)", ra.title === "Edit" &&
      ra.hidden === "{{arguments[0].row.item_disassembly_status.dict_key == 'Processing' || arguments[0].row.posted_status.dict_key == 'Pending Post'}}");
    check("Edit hidden: Processing -> hidden (with a NULL posted_status too), Pending Post -> hidden, Draft / Completed -> shown", hidden(ida("1", "Processing")) === true &&
      hidden(ida("1", "Processing", { posted_status: null })) === true && hidden(ida("1", "Processing", { posted_status: undefined })) === true &&
      hidden(ida("1", "Draft", { posted_status: { dict_key: "Pending Post" } })) === true && hidden(ida("1", "Draft")) === false && hidden(ida("1", "Completed")) === false);
    const rows = [ida("1", "Draft"), ida("1", "Draft", { posted_status: null }), ida("1", "Draft", { posted_status: { dict_key: "" } }), ida("1", "Completed", { posted_status: { dict_key: "Pending Post" } }),
      ida("1", "Completed", { posted_status: { dict_key: "Posted" } }), ida("1", "Fully Posted", { posted_status: null }), ida("1", "", { posted_status: { dict_key: "Unposted" } })];
    check("Edit hidden: every other row keeps the base result (a NULL posted_status throws in both)", rows.every((row) => same(hidden(row), baseHidden(row))) &&
      hidden(ida("1", "Draft", { posted_status: null })) === "THROWS", rows.map((row) => [hidden(row), baseHidden(row)]));
    const others = H.clone(BUILT.list[0].options.customProps.rowActions);
    others[1].hidden = BASE.list[0].options.customProps.rowActions[1].hidden;
    check("row actions: only the Edit hidden changed (Delete keeps its Completed rule)", same(others, BASE.list[0].options.customProps.rowActions));
  }

  // ---- Delete
  const stored = (status) => (name, q) => (name === "sm_item_disassembly" && q.where && q.where.id === "5" ? { data: status === null ? [] : [{ id: "5", item_disassembly_status: status }] } :
    name === "sm_item_disassembly_tlm8ve69_sub" ? { data: [{ id: "L1" }, { id: "L2" }] } : name === "sm_item_disassembly_mw10kf66_sub" ? { data: [{ id: "D1" }] } : { data: [] });
  for (const status of ["Processing", "Completed", "Fully Posted"]) {
    const t = await page(BUILT, "delete", [ida("5", status)], { db: stored(status) });
    check("Delete of a " + status + " row: refused at once, no confirm, no read, no write", named(t.trace, "$message.error").some((x) => x[1] === "Item Disassembly IDA-5 is " + status + " and cannot be deleted.") &&
      named(t.trace, "$confirm").length === 0 && !t.trace.some((x) => x[0] === "db.get" || x[0] === "db.update"));
  }
  {
    const t = await page(BUILT, "delete", [ida("5", "Processing", { item_disassembly_status: "Processing" })], { db: stored("Processing") });
    check("Delete of a Processing row given as a plain string: refused", named(t.trace, "$message.error").length === 1 && !t.trace.some((x) => x[0] === "db.update"));
  }
  for (const status of ["Draft", "", null]) {
    const row = ida("5", status, status === null ? { item_disassembly_status: null } : {});
    const a = await page(BASE, "delete", [row], { db: stored(status === null ? "" : status) });
    const b = await page(BUILT, "delete", [row], { db: stored(status === null ? "" : status) });
    const reread = b.trace.filter((x) => x[0] === "db.get" && x[1].collection === "sm_item_disassembly");
    check("Delete of a " + (status === null ? "null-status" : status || "blank") + " row (stored the same): one status re-read (field-limited) after the confirm, then the base's deletes", reread.length === 1 &&
      same(reread[0][1], { collection: "sm_item_disassembly", where: { id: "5", is_deleted: 0 }, field: "item_disassembly_status" }) &&
      same(b.trace.filter((x) => !(x[0] === "db.get" && x[1].collection === "sm_item_disassembly")), a.trace) && b.trace.filter((x) => x[0] === "db.update").length === 4 &&
      b.trace.findIndex((x) => x[0] === "$confirm") < b.trace.indexOf(reread[0]), { a: a.trace.map((x) => x[0]), b: b.trace.map((x) => x[0]) });
  }
  for (const now of ["Processing", "Completed", "Fully Posted", { dict_key: "Processing" }, null]) {
    const t = await page(BUILT, "delete", [ida("5", "Draft")], { db: stored(now) });
    const label = now && typeof now === "object" ? now.dict_key : now;
    check("Delete of a stale Draft row now " + (label || "gone") + ": refused after the re-read, no write, list refreshed", !t.trace.some((x) => x[0] === "db.update") &&
      named(t.trace, "$message.error").some((x) => (label ? x[1] === "Item Disassembly IDA-5 is " + label + " and cannot be deleted." : /no longer available/.test(x[1]))) && named(t.trace, "refresh").length === 1);
  }
  {
    const c = await page(BUILT, "delete", [ida("5", "Draft")], { db: stored("Draft"), confirm: () => "cancel" });
    const c0 = await page(BASE, "delete", [ida("5", "Draft")], { db: stored("Draft"), confirm: () => "cancel" });
    check("Delete cancelled: nothing read or written (the base's calls)", !c.trace.some((x) => x[0] === "db.get" || x[0] === "db.update") && same(c.trace, c0.trace));
    const none = await page(BUILT, "delete", [], { row: {} });
    const none0 = await page(BASE, "delete", [], { row: {} });
    check("Delete without a row: the base's message", same(none.trace, none0.trace) && named(none.trace, "$message.error").length === 1);
  }
  H.done("lists");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("lists");
});
