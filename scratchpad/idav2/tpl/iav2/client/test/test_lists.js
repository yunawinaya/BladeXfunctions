// IA list: the gated worker kick in mounted (OFF = nothing at all), the Edit row action hidden for Processing, Delete refusing
// Processing and re-reading the stored status, and the Revert Completed routing (OFF = the base click call for call; ON:
// <= 50 live rows / NOT_ELIGIBLE / INVALID / no usable answer -> the classic IA_REVERT unchanged, > 50 -> IA_REVERT_V2_SUBMIT).
//   node test/test_lists.js
const H = require("./harness");
const { check, same } = H;

const BASE = H.readJSON(H.FILES.listBase);
const BUILT = H.readJSON(H.FILES.list);
const T = H.TEST_IDS;
const CLASSIC = "2099319746652852225";
const named = (trace, name) => trace.filter((t) => t[0] === name);
const wf = (trace, id, op) => trace.filter((t) => t[0] === "runWorkflow" && t[1] === id && (!op || t[2].operation === op));

const mount = async (code, o) => {
  o = o || {};
  const w = H.world({ storage: o.storage, storageThrows: o.storageThrows });
  const n = {};
  const self = H.makeThis(w, BUILT, { answer: (id) => {
    n[id] = (n[id] || 0) + 1;
    return { data: { processed: o.processed ? o.processed(id, n[id]) : "0" } };
  } });
  H.compile(w, code, false).call(self, {});
  await H.drain(w);
  return w;
};

const ia = (id, status, o) => Object.assign({ id: id, stock_movement_no: "IA-" + id, item_assembly_status: status, organization_id: "1996787068457861121", posted_status: { dict_key: "Unposted" },
  item_id: { material_code: "FG" } }, o || {});
const page = async (doc, handler, selected, o) => {
  o = o || {};
  const w = H.world({ db: o.db || (() => ({ data: [] })) });
  const s = o.script || {};
  const self = H.makeThis(w, doc, {
    components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: selected, clearSelection: () => w.rec("clearSelection") } } } },
    confirm: o.confirm,
    answer: (id, params) => {
      if (id === CLASSIC) {
        const a = s.classic ? s.classic(params) : { code: "200", message: "ok" };
        return a && a.reject !== undefined ? a : { data: a };
      }
      if (id === T.IA_REVERT_V2_SUBMIT) {
        const a = s.submit ? s.submit(params, w) : { route: "NOT_ELIGIBLE", code: "300", reason: "classic" };
        return a && a.reject !== undefined ? a : { data: a };
      }
      if (id === T.IA_REVERT_V2_WORKER) {
        s.ticks = (s.ticks || 0) + 1;
        return { data: { processed: s.processed ? s.processed(s.ticks) : "1" } };
      }
      return { data: {} };
    },
  });
  H.compile(w, H.byName(doc, handler).func, false).call(self, { row: o.row || selected[0] });
  await H.drain(w);
  return w;
};

(async () => {
  // ---- mounted: both workers, each on its own switch, throttled 2 minutes per worker
  const m0 = H.byName(BASE, "mounted");
  const m1 = H.byName(BUILT, "mounted");
  check("list: the base mounted is empty, the built one is the kick (type js)", m0.func === "" && m1.type === "js");
  check("list mounted: shipped " + (H.EXPECT_ON ? "ON" : "OFF") + " with the ids.json worker ids", same(H.shippedState(m1.func).switches, { ASYNC_IA_ENABLED: H.EXPECT_ON, ASYNC_IA_REVERT_ENABLED: H.EXPECT_ON }) &&
    same(H.shippedState(m1.func).ids, { IA_V2_WORKER: H.IDS.IA_V2_WORKER, IA_REVERT_V2_WORKER: H.IDS.IA_REVERT_V2_WORKER }), H.shippedState(m1.func));
  let w = await mount(H.variant(m1.func, { master: false, revert: false }, T), { storage: { ia_v2_worker_kick_at: "0" } });
  check("list mounted OFF: no call, no browser storage", w.trace.length === 0, w.trace);
  w = await mount(H.variant(m1.func, { master: true, revert: true }, H.OFF_IDS));
  check("list mounted ON with worker ids 0: no call", w.trace.length === 0, w.trace);
  const both = H.variant(m1.func, { master: true, revert: true }, T);
  w = await mount(both, { processed: (id, n) => (n < 3 ? "2" : "0") });
  const calls = w.trace.filter((t) => t[0] === "runWorkflow");
  check("list mounted ON: both workers kicked { job_id: \"\" }, chained while processed > 0, refreshed", calls.filter((t) => t[1] === T.IA_V2_WORKER).length === 3 &&
    calls.filter((t) => t[1] === T.IA_REVERT_V2_WORKER).length === 3 && calls.every((t) => same(t[2], { job_id: "" })) && named(w.trace, "refresh").length === 4 &&
    w.storage.ia_v2_worker_kick_at === String(1800000000000) && w.storage.ia_rv_worker_kick_at === String(1800000000000), calls.map((t) => t[1]));
  w = await mount(both, { processed: () => "1" });
  check("list mounted ON: at most 40 rounds per worker", w.trace.filter((t) => t[0] === "runWorkflow").length === 80);
  w = await mount(both, { storage: { ia_v2_worker_kick_at: String(1800000000000 - 60000) } });
  check("list mounted ON: the completion worker kicked 1 min ago -> only the revert worker", same(w.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]), [T.IA_REVERT_V2_WORKER]));
  w = await mount(both, { storage: { ia_v2_worker_kick_at: String(1800000000000 - 121000), ia_rv_worker_kick_at: String(1800000000000 - 30000) } });
  check("list mounted ON: 2 min passed for one worker only -> that one", same(w.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]), [T.IA_V2_WORKER]));
  w = await mount(both, { storageThrows: true });
  check("list mounted ON: browser storage blocked -> still kicks each once", w.trace.filter((t) => t[0] === "runWorkflow").length === 2);
  w = await mount(H.variant(m1.func, { master: true, revert: false }, T));
  check("list mounted, revert switch off: only the completion worker", same(w.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]), [T.IA_V2_WORKER]));
  w = await mount(H.variant(m1.func, { master: false, revert: true }, T));
  check("list mounted, completion switch off: only the revert worker", same(w.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]), [T.IA_REVERT_V2_WORKER]));

  // ---- the Edit row action: hidden for Pending Post (as before) and for Processing
  {
    const ra = BUILT.list[0].options.customProps.rowActions[1];
    const expr = ra.hidden.replace(/^\{\{|\}\}$/g, "");
    const hidden = (row) => Function("arguments", "return " + expr)([{ row: row }]);
    check("Edit hidden: the base expression extended", ra.title === "Edit" && ra.hidden === "{{arguments[0].row.posted_status.dict_key == 'Pending Post' || arguments[0].row.item_assembly_status === 'Processing'}}");
    check("Edit hidden: Processing -> hidden, Pending Post -> hidden, Draft / Completed -> shown", hidden(ia("1", "Processing")) === true && hidden(ia("1", "Draft", { posted_status: { dict_key: "Pending Post" } })) === true &&
      hidden(ia("1", "Draft")) === false && hidden(ia("1", "Completed")) === false);
  }

  // ---- Delete
  const stored = (status) => (name, q) => (name === "sm_item_assembly" && q.where && q.where.id === "5" ? { data: status === null ? [] : [{ id: "5", item_assembly_status: status }] } :
    name === "sm_item_assembly_tlm8ve69_sub" ? { data: [{ id: "L1" }, { id: "L2" }] } : { data: [] });
  for (const status of ["Processing", "Completed", "Fully Posted"]) {
    const t = await page(BUILT, "delete", [ia("5", status)], { db: stored(status) });
    check("Delete of a " + status + " row: refused at once, no confirm, no read, no write", named(t.trace, "$message.error").some((x) => x[1] === "Item Assembly IA-5 is " + status + " and cannot be deleted.") &&
      named(t.trace, "$confirm").length === 0 && !t.trace.some((x) => x[0] === "db.get" || x[0] === "db.update"));
  }
  {
    const a = await page(BASE, "delete", [ia("5", "Draft")], { db: stored("Draft") });
    const b = await page(BUILT, "delete", [ia("5", "Draft")], { db: stored("Draft") });
    const reread = b.trace.filter((x) => x[0] === "db.get" && x[1].collection === "sm_item_assembly");
    check("Delete of a Draft (stored Draft): one status re-read (field-limited) after the confirm, then the base's deletes", reread.length === 1 &&
      same(reread[0][1], { collection: "sm_item_assembly", where: { id: "5", is_deleted: 0 }, field: "item_assembly_status" }) &&
      same(b.trace.filter((x) => !(x[0] === "db.get" && x[1].collection === "sm_item_assembly")), a.trace) && b.trace.filter((x) => x[0] === "db.update").length === 3 &&
      b.trace.findIndex((x) => x[0] === "$confirm") < b.trace.indexOf(reread[0]), { a: a.trace.map((x) => x[0]), b: b.trace.map((x) => x[0]) });
    for (const now of ["Processing", "Completed", "Fully Posted", null]) {
      const t = await page(BUILT, "delete", [ia("5", "Draft")], { db: stored(now) });
      check("Delete of a stale Draft row now " + (now || "gone") + ": refused after the re-read, no write, list refreshed", !t.trace.some((x) => x[0] === "db.update") &&
        named(t.trace, "$message.error").some((x) => (now ? x[1] === "Item Assembly IA-5 is " + now + " and cannot be deleted." : /no longer available/.test(x[1]))) && named(t.trace, "refresh").length === 1);
    }
    const c = await page(BUILT, "delete", [ia("5", "Draft")], { db: stored("Draft"), confirm: () => "cancel" });
    check("Delete cancelled: nothing read or written", !c.trace.some((x) => x[0] === "db.get" || x[0] === "db.update"));
  }

  // ---- Revert Completed: OFF = the base click, call for call
  const sel = (ids) => ids.map(([id, status]) => ia(id, status));
  const offDoc = H.clone(BUILT);
  H.byName(offDoc, "IArevertCompleted").func = H.variant(H.byName(BUILT, "IArevertCompleted").func, { revert: false }, H.OFF_IDS);
  const classicAnswers = [["200", () => ({ code: "200", message: "Item Assembly reverted to Draft successfully." })],
    ["409", () => ({ code: "409", message: "The assembled item has already been used.", conflicts: [{ message: "FG used by GD-1" }] })],
    ["500", () => ({ code: "500", message: "Revert stopped part way through." })], ["400", () => ({ code: "400", message: "This Item Assembly is too large to revert here (300 stock rows; at most 250). Revert it from the Item Assembly list." })],
    ["rejected", () => ({ reject: new Error("network") })]];
  for (const [what, ids] of [["2 Completed", [["1", "Completed"], ["2", "Completed"]]], ["mixed", [["1", "Completed"], ["3", "Draft"], ["4", "Processing"]]], ["none revertable", [["3", "Draft"]]]]) {
    for (const [aw, ans] of classicAnswers) {
      const a = await page(BASE, "IArevertCompleted", sel(ids), { script: { classic: ans } });
      const b = await page(offDoc, "IArevertCompleted", sel(ids), { script: { classic: ans } });
      check("Revert OFF " + what + " / classic " + aw + ": exactly the base", same(a.trace, b.trace) && wf(b.trace, T.IA_REVERT_V2_SUBMIT).length === 0, { a: a.trace.map((x) => x[0]), b: b.trace.map((x) => x[0]) });
    }
    const c = await page(offDoc, "IArevertCompleted", sel(ids), { confirm: () => "cancel" });
    const d = await page(BASE, "IArevertCompleted", sel(ids), { confirm: () => "cancel" });
    check("Revert OFF " + what + " cancelled: exactly the base", same(c.trace, d.trace));
  }
  {
    const shipped = H.shippedState(H.byName(BUILT, "IArevertCompleted").func);
    check("Revert: shipped " + (H.EXPECT_ON ? "ON" : "OFF") + " with the ids.json ids", same(shipped.switches, { ASYNC_IA_REVERT_ENABLED: H.EXPECT_ON }) && same(shipped.ids, { IA_REVERT_V2_SUBMIT: H.IDS.IA_REVERT_V2_SUBMIT, IA_REVERT_V2_WORKER: H.IDS.IA_REVERT_V2_WORKER }), shipped);
  }

  // ---- Revert Completed ON
  const onDoc = H.clone(BUILT);
  H.byName(onDoc, "IArevertCompleted").func = H.variant(H.byName(BUILT, "IArevertCompleted").func, { revert: true }, T);
  const KEY = /^IAV:1996787068457861121:[0-9]+:[a-z0-9]+$/;
  {
    // NOT_ELIGIBLE (<= 50 live rows) for every row: the classic call for each, exactly the base's params; one SUBMIT each
    const a = await page(BASE, "IArevertCompleted", sel([["1", "Completed"], ["2", "Completed"]]));
    const b = await page(onDoc, "IArevertCompleted", sel([["1", "Completed"], ["2", "Completed"]]));
    const subs = wf(b.trace, T.IA_REVERT_V2_SUBMIT, "SUBMIT");
    check("Revert ON, every row NOT_ELIGIBLE: one SUBMIT per row (RV4 request), then the classic call unchanged", subs.length === 2 && subs.every((t, i) => same(Object.keys(t[2]).sort(), ["form", "ia_id", "idempotency_key", "min_picks", "operation", "source"]) &&
      t[2].ia_id === String(i + 1) && KEY.test(t[2].idempotency_key) && t[2].source === "LIST" && t[2].min_picks === "50" &&
      same(t[2].form, { id: String(i + 1), item_assembly_status: "Completed", stock_movement_no: "IA-" + (i + 1), organization_id: "1996787068457861121" })) &&
      same(wf(b.trace, CLASSIC).map((t) => t[2]), wf(a.trace, CLASSIC).map((t) => t[2])) && wf(b.trace, T.IA_REVERT_V2_WORKER).length === 0 &&
      same(named(b.trace, "$message.success"), named(a.trace, "$message.success")), subs.map((t) => t[2]));
    const keys = subs.map((t) => t[2].idempotency_key);
    check("Revert ON: one click token for the click, one key per assembly", keys[0].split(":")[3] === keys[1].split(":")[3] && keys[0] !== keys[1]);
  }
  for (const [what, submit] of [["no usable answer (transport failure twice)", () => ({ reject: new Error("network") })], ["no route", () => ({ code: "200" })], ["INVALID", () => ({ route: "INVALID", code: "400", message: "bad key" })]]) {
    const b = await page(onDoc, "IArevertCompleted", sel([["1", "Completed"]]), { script: { submit: submit } });
    check("Revert ON, " + what + ": the classic call for that row", wf(b.trace, CLASSIC).length === 1 && wf(b.trace, T.IA_REVERT_V2_SUBMIT, "SUBMIT").length === (/twice/.test(what) ? 2 : 1) &&
      named(b.trace, "$message.success").some((x) => /All 1 Item Assembly reverted to Draft successfully/.test(x[1])));
  }
  {
    // a mixed selection: 1 classic-sized, 2 big (one fails in the background), 1 Draft skipped, 1 refused by the classic
    const submit = (p) => (p.ia_id === "2" || p.ia_id === "5" ? { route: "QUEUED", code: "200", job_id: "J" + p.ia_id, job_status: "QUEUED", ia_id: p.ia_id } : { route: "NOT_ELIGIBLE", code: "300", reason: "classic" });
    const status = { "2": ["VALIDATING", "COMPLETED"], "5": ["VALIDATING", "FAILED"] };
    const n = {};
    const b = await page(onDoc, "IArevertCompleted", sel([["1", "Completed"], ["2", "Completed"], ["3", "Draft"], ["4", "Completed"], ["5", "Completed"]]), { script: {
      submit: (p) => {
        if (p.operation === "SUBMIT") return submit(p);
        n[p.ia_id] = (n[p.ia_id] || 0) + 1;
        const js = status[p.ia_id][Math.min(n[p.ia_id] - 1, 1)];
        return { route: "STATUS", code: "200", job_id: "J" + p.ia_id, job_status: js, ia_id: p.ia_id, terminal: js === "VALIDATING" ? "NO" : "YES",
          error_message: js === "FAILED" ? "Revert blocked: the assembled item has been used or its stock has moved on. FG-01 used by GD-9" : "" };
      },
      classic: (p) => (p.ia_id === "4" ? { code: "409", message: "The assembled item has already been used.", conflicts: [] } : { code: "200", message: "ok" }),
      processed: (t) => (t < 3 ? "1" : "0") } });
    check("Revert ON mixed: classic for 1 and 4 only, V2 for 2 and 5", same(wf(b.trace, CLASSIC).map((t) => t[2].ia_id), ["1", "4"]) && same(wf(b.trace, T.IA_REVERT_V2_SUBMIT, "SUBMIT").map((t) => t[2].ia_id), ["1", "2", "4", "5"]));
    check("Revert ON mixed: the summary counts the background ones", named(b.trace, "$message").some((x) => /^1 reverted, 2 being reverted in the background, 2 failed:/.test(x[1].message)), named(b.trace, "$message"));
    const ticks = wf(b.trace, T.IA_REVERT_V2_WORKER);
    check("Revert ON mixed: the revert worker drained { job_id: \"\" }; STATUS of the queued ones after each tick; the background failure reported once", ticks.length === 2 && ticks.every((t) => same(t[2], { job_id: "" })) &&
      wf(b.trace, T.IA_REVERT_V2_SUBMIT, "STATUS").length === 4 && named(b.trace, "$alert").filter((x) => x[2] === "Revert did not finish").length === 1 &&
      /IA-5: Revert blocked: the assembled item has been used or its stock has moved on\. FG-01 used by GD-9/.test(named(b.trace, "$alert").find((x) => x[2] === "Revert did not finish")[1]) &&
      named(b.trace, "refresh").length >= 3, { ticks: ticks.length, status: wf(b.trace, T.IA_REVERT_V2_SUBMIT, "STATUS").map((t) => t[2].ia_id), alerts: named(b.trace, "$alert") });
  }
  {
    const b = await page(onDoc, "IArevertCompleted", sel([["2", "Completed"]]), { script: {
      submit: (p) => (p.operation === "SUBMIT" ? { route: "QUEUED", code: "200", job_id: "J2", job_status: "QUEUED", ia_id: "2" } : { route: "STATUS", code: "200", job_id: "J2", job_status: "VALIDATING", ia_id: "2", terminal: "NO" }),
      processed: () => "1" } });
    check("Revert ON: the drain stops after 10 worker calls; the success message", wf(b.trace, T.IA_REVERT_V2_WORKER).length === 10 && named(b.trace, "$message.success").some((x) => x[1] === "1 Item Assembly is being reverted to Draft in the background") &&
      wf(b.trace, CLASSIC).length === 0);
  }
  for (const [route, code, js] of [["BUSY", "409", ""], ["STALE", "409", ""], ["STOP", "400", ""], ["STATUS", "200", "FAILED"], ["STATUS", "200", "COMPLETED"]]) {
    const b = await page(onDoc, "IArevertCompleted", sel([["2", "Completed"]]), { script: { submit: () => ({ route: route, code: code, job_status: js, job_id: js ? "J2" : "", message: "the " + route + " text",
      error_message: js === "FAILED" ? "the earlier failure" : "" }) } });
    const expected = js === "COMPLETED" ? "All 1 Item Assembly reverted to Draft successfully" : js === "FAILED" ? "the earlier failure" : "the " + route + " text";
    check("Revert ON, " + route + (js ? " " + js : "") + ": that row's message, no classic call, no worker", wf(b.trace, CLASSIC).length === 0 && wf(b.trace, T.IA_REVERT_V2_WORKER).length === 0 &&
      (named(b.trace, "$message.success").some((x) => x[1] === expected) || named(b.trace, "$message").some((x) => x[1].message.indexOf(expected) >= 0)), b.trace.filter((x) => /message/.test(x[0])));
  }
  // the bulk Post toolbar action (stored-status re-read, review R3): test_post.js
  H.done("lists");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("lists");
});
