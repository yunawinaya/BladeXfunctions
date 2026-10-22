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
  // the workers' own cases: the reservation kicks (MIN-03 / MIN-05, below) off (no IA_HOLD id)
  const RES_ON = "const IA_RES_ENABLED = true;";
  const HOLD_LINE = 'const RES_HOLD = "' + String(require("../../../iasc/ids.json").IA_HOLD) + '"; // IA_HOLD';
  check("list mounted: the reservation kick ships ON, with the IA_HOLD id", m1.func.split(RES_ON).length === 2 && m1.func.split(HOLD_LINE).length === 2);
  const wk = m1.func.replace(HOLD_LINE, 'const RES_HOLD = "0"; // IA_HOLD');
  let w = await mount(H.variant(wk, { master: false, revert: false }, T), { storage: { ia_v2_worker_kick_at: "0" } });
  check("list mounted OFF: no call, no browser storage", w.trace.length === 0, w.trace);
  w = await mount(H.variant(wk, { master: true, revert: true }, H.OFF_IDS));
  check("list mounted ON with worker ids 0: no call", w.trace.length === 0, w.trace);
  const both = H.variant(wk, { master: true, revert: true }, T);
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
  w = await mount(H.variant(wk, { master: true, revert: false }, T));
  check("list mounted, revert switch off: only the completion worker", same(w.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]), [T.IA_V2_WORKER]));
  w = await mount(H.variant(wk, { master: false, revert: true }, T));
  check("list mounted, completion switch off: only the revert worker", same(w.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]), [T.IA_REVERT_V2_WORKER]));

  // ---- the Edit row action: hidden for Pending Post (as before) and for Processing
  {
    const ra = BUILT.list[0].options.customProps.rowActions[1];
    const expr = ra.hidden.replace(/^\{\{|\}\}$/g, "");
    const hidden = (row) => Function("arguments", "return " + expr)([{ row: row }]);
    check("Edit hidden: the base expression extended (Processing; Cancelled: user 10-22)", ra.title === "Edit" &&
      ra.hidden === "{{arguments[0].row.posted_status.dict_key == 'Pending Post' || arguments[0].row.item_assembly_status === 'Processing' || arguments[0].row.item_assembly_status === 'Cancelled'}}");
    check("Edit hidden: Processing / Cancelled -> hidden, Pending Post -> hidden, Draft / Created / Completed -> shown", hidden(ia("1", "Processing")) === true &&
      hidden(ia("1", "Cancelled")) === true && hidden(ia("1", "Draft", { posted_status: { dict_key: "Pending Post" } })) === true &&
      hidden(ia("1", "Draft")) === false && hidden(ia("1", "Created")) === false && hidden(ia("1", "Completed")) === false);
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
      same(reread[0][1], { collection: "sm_item_assembly", where: { id: "5", is_deleted: 0 }, field: "item_assembly_status,material_hold_status,organization_id" }) &&
      same(b.trace.filter((x) => !(x[0] === "db.get" && x[1].collection === "sm_item_assembly")), a.trace) && b.trace.filter((x) => x[0] === "db.update").length === 3 &&
      b.trace.findIndex((x) => x[0] === "$confirm") < b.trace.indexOf(reread[0]), { a: a.trace.map((x) => x[0]), b: b.trace.map((x) => x[0]) });
    for (const now of ["Processing", "Completed", "Fully Posted", null]) {
      const t = await page(BUILT, "delete", [ia("5", "Draft")], { db: stored(now) });
      check("Delete of a stale Draft row now " + (now || "gone") + ": refused after the re-read, no write, list refreshed", !t.trace.some((x) => x[0] === "db.update") &&
        named(t.trace, "$message.error").some((x) => (now ? x[1] === "Item Assembly IA-5 is " + now + " and cannot be deleted." : /no longer available/.test(x[1]))) && named(t.trace, "refresh").length === 1);
    }
    // RES-01 Cancel (user 10-22): Delete is for Draft and Cancelled IAs; a Created IA is cancelled first (Cancel releases its reservation)
    const cr = await page(BUILT, "delete", [ia("5", "Created")], { db: stored("Created") });
    check("Delete of a Created row: refused at once (cancel it first), no confirm, no read, no write", named(cr.trace, "$message.error").some((x) => x[1] === "Item Assembly IA-5 is Created: cancel it first (Cancel releases its reserved materials).") &&
      named(cr.trace, "$confirm").length === 0 && !cr.trace.some((x) => x[0] === "db.get" || x[0] === "db.update"), named(cr.trace, "$message.error"));
    const sc = await page(BUILT, "delete", [ia("5", "Draft")], { db: stored("Created") });
    check("Delete of a stale Draft row now Created: refused after the re-read (cancel it first), no write", !sc.trace.some((x) => x[0] === "db.update") &&
      named(sc.trace, "$message.error").some((x) => x[1] === "Item Assembly IA-5 is Created: cancel it first (Cancel releases its reserved materials)."), named(sc.trace, "$message.error"));
    const c = await page(BUILT, "delete", [ia("5", "Draft")], { db: stored("Draft"), confirm: () => "cancel" });
    check("Delete cancelled: nothing read or written", !c.trace.some((x) => x[0] === "db.get" || x[0] === "db.update"));
  }
  // ---- Delete, RES-01 R5: an IA that reserves (its stored hold status, whatever the switch: review I4) releases its holds first
  // (IA_HOLD RELEASE_ALL); refused if they stay held
  {
    const HOLD = String(require("../../../iasc/ids.json").IA_HOLD);
    const on = BUILT;
    const del = H.byName(on, "delete");
    check("Delete: no switch decides the release (the stored hold status does)", del.func.indexOf("RES_ENABLED") < 0);
    const storedHold = (hold) => (name, q) => (name === "sm_item_assembly" && q.where && q.where.id === "5" ? { data: [{ id: "5", item_assembly_status: "Draft", material_hold_status: hold,
      organization_id: "1996787068457861121" }] } : name === "sm_item_assembly_tlm8ve69_sub" ? { data: [{ id: "L1" }] } : { data: [] });
    const run = async (hold, answer) => {
      const w = H.world({ db: storedHold(hold) });
      const self = H.makeThis(w, on, { components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: [ia("5", "Draft")], clearSelection: () => {} } } } },
        answer: (id, params) => (id === HOLD ? answer(params) : { data: {} }) });
      H.compile(w, del.func, false).call(self, { row: ia("5", "Draft") });
      await H.drain(w);
      return w;
    };
    const released = () => ({ data: { code: "200", message: "Released: this Item Assembly holds no material now.", result_json: JSON.stringify({ status: "NONE" }) } });
    const ups = (w) => w.trace.filter((x) => x[0] === "db.update");
    let w = await run("FULL", released);
    const calls = wf(w.trace, HOLD);
    const u = ups(w);
    // review M4: the header first (IA_HOLD refuses a deleted IA, so no reservation can start for it any more), then the release, then the lines
    check("Delete, an IA that reserves: the header deleted, then RELEASE_ALL (source LIST), then its lines", calls.length === 1 && same(calls[0][2], { ia_id: "5",
      organization_id: "1996787068457861121", operation: "RELEASE_ALL", source: "LIST" }) && u.length === 2 && u[0][1].collection === "sm_item_assembly" && same(u[0][2], { is_deleted: 1 }) &&
      w.trace.indexOf(u[0]) < w.trace.indexOf(calls[0]) && w.trace.indexOf(calls[0]) < w.trace.indexOf(u[1]) && u[1][1].collection === "sm_item_assembly_tlm8ve69_sub",
      w.trace.filter((x) => x[0] === "db.update" || x[0] === "runWorkflow").map((x) => [x[0], x[1].collection || x[1]]));
    check("Delete: the stored read also reads the hold status and the organisation", w.trace.some((x) => x[0] === "db.get" && x[1].collection === "sm_item_assembly" &&
      x[1].field === "item_assembly_status,material_hold_status,organization_id"));
    // RES-01 Cancel (user 10-22): a Cancelled IA (its hold status NONE) is deleted: RELEASE_ALL finds nothing (NONE), then its lines
    {
      const storedAs = (name, q) => (name === "sm_item_assembly" && q.where && q.where.id === "5" ? { data: [{ id: "5", item_assembly_status: "Cancelled", material_hold_status: "NONE",
        organization_id: "1996787068457861121" }] } : name === "sm_item_assembly_tlm8ve69_sub" ? { data: [{ id: "L1" }] } : { data: [] });
      const wc = H.world({ db: storedAs });
      const self = H.makeThis(wc, on, { components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: [ia("5", "Cancelled")], clearSelection: () => {} } } } },
        answer: (id) => (id === HOLD ? released() : { data: {} }) });
      H.compile(wc, del.func, false).call(self, { row: ia("5", "Cancelled") });
      await H.drain(wc);
      const uc = ups(wc);
      check("Delete of a Cancelled IA: the header deleted, RELEASE_ALL (nothing held, NONE), then its lines", wf(wc.trace, HOLD).length === 1 && uc.length === 2 &&
        same(uc[0][2], { is_deleted: 1 }) && uc[1][1].collection === "sm_item_assembly_tlm8ve69_sub", uc.map((x) => [x[1].collection, x[2]]));
    }
    const busy = () => ({ data: { code: "409", message: "Another reservation of this Item Assembly is running: try again in a moment." } });
    for (const [label, answer, tries] of [["left for review", () => ({ data: { code: "200", message: "Needs review: x.", result_json: JSON.stringify({ status: "REVIEW" }) } }), 1],
      ["busy every time", busy, 4], ["no answer", () => ({ reject: new Error("down") }), 1],
      ["not 200 (its result never trusted)", () => ({ data: { code: "500", message: "x", result_json: JSON.stringify({ status: "NONE" }) } }), 1]]) {
      w = await run("PARTIAL", answer);
      const v = ups(w);
      check("Delete, the release " + label + ": refused, the IA restored, no line deleted (" + tries + " release call(s))", v.length === 2 && v.every((x) => x[1].collection === "sm_item_assembly") &&
        same(v[0][2], { is_deleted: 1 }) && same(v[1][2], { is_deleted: 0 }) && wf(w.trace, HOLD).length === tries &&
        named(w.trace, "$message.error").some((x) => /could not be released/.test(x[1])), [v.map((x) => [x[1].collection, x[2]]), wf(w.trace, HOLD).length, named(w.trace, "$message.error")]);
    }
    let n = 0;
    w = await run("FULL", () => (++n < 3 ? busy() : released()));
    check("Delete, a reservation still running: waited for (two 409s), then released and deleted", wf(w.trace, HOLD).length === 3 && ups(w).length === 2 &&
      same(ups(w)[0][2], { is_deleted: 1 }) && ups(w)[1][1].collection === "sm_item_assembly_tlm8ve69_sub", [wf(w.trace, HOLD).length, ups(w).map((x) => [x[1].collection, x[2]])]);
    w = await run("", released);
    check("Delete, an IA that never reserved: no release, the base's deletes", wf(w.trace, HOLD).length === 0 && named(w.trace, "db.update").length === 2);
  }

  // ---- MIN-03 (BA 10-22): reservations that still need work are found on the list, not by guessing which IA to reopen: a Reservation
  // column; Retry Reservation runs, for the selected IAs, the IA_HOLD operation each one's stored status needs; a reservation left pending
  // (a closed browser after a Created save) is finished when the list opens (at most every 2 minutes per browser, 10 IAs)
  {
    const HOLD = String(require("../../../iasc/ids.json").IA_HOLD);
    const cp = BUILT.list[0].options.customProps;
    const cols = cp.columns;
    const ci = cols.findIndex((c) => c.name === "material_hold_status");
    const col = cols[ci];
    check("Reservation column: right after Status, the IA's material_hold_status (key wsldpopa), a custom badge", ci === 2 && cols[1].name === "item_assembly_status" && !!col &&
      col.key === "wsldpopa" && col.title === "Reservation" && col.description === "Reservation" && col.showType === "Custom" && col.bsonType === "string", col && [col.key, col.title]);
    const labels = {};
    ((col && col.configCustom.content) || "").replace(/v-if="scope\.value==='([A-Z]+)'"[^>]*>\s*([^<]+?)\s*</g, (m, k, v) => (labels[k] = v));
    check("Reservation column: a label for every hold status", same(labels, { RESERVING: "Pending", FULL: "Fully reserved", PARTIAL: "Partially reserved",
      SHORT: "Nothing reserved", NONE: "None", REVIEW: "Needs review", CLOSED: "Closed" }), labels);
    const tb = cp.toolbar;
    const ti = tb.findIndex((x) => x.title === "Retry Reservation");
    const rr = H.byName(BUILT, "onItemAssemblyRetryReservation");
    check("toolbar: Retry Reservation right after Revert Completed, a custom button bound to its handler", ti > 0 && tb[ti - 1].title === "Revert Completed" && tb[ti].type === "custom" &&
      !!rr && rr.type === "js" && same(tb[ti].events, [{ key: rr.key, name: "onItemAssemblyRetryReservation" }]), [ti, tb[ti] && tb[ti].events]);
    check("Retry Reservation: no switch decides it (finishing a reservation is never switched off), the IA_HOLD id filled", !!rr && rr.func.indexOf("RES_ENABLED") < 0 &&
      rr.func.indexOf('const RES_HOLD = "' + HOLD + '"') >= 0);

    const stored = (rows) => (name, q) => (name === "sm_item_assembly" ? { data: rows.filter((r) => !q.filter || JSON.stringify(q.filter).indexOf('"' + r.id + '"') >= 0) } : { data: [] });
    const retry = async (selected, rows, answer, o) => {
      o = o || {};
      const w = H.world({ db: o.db || stored(rows) });
      const self = H.makeThis(w, BUILT, { components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: selected, clearSelection: () => w.rec("clearSelection") } } } },
        answer: (id, params) => (id === HOLD ? answer(params) : { data: {} }) });
      H.compile(w, rr.func, false).call(self, {});
      await H.drain(w);
      return w;
    };
    const head = (id, status, hold) => ({ id: id, stock_movement_no: "IA-" + id, item_assembly_status: status, material_hold_status: hold, organization_id: "1996787068457861121" });
    const ok = (params) => ({ data: { code: "200", message: params.operation + " done", result_json: JSON.stringify({ status: "FULL" }) } });
    const sel = [["1", "Created", "PARTIAL"], ["2", "Completed", "FULL"], ["3", "Draft", "PARTIAL"], ["4", "Cancelled", "FULL"], ["5", "Processing", "FULL"], ["6", "Completed", "CLOSED"],
      ["7", "Draft", "NONE"], ["8", "Created", "REVIEW"], ["9", "Fully Posted", "REVIEW"]];
    // the list rows say Draft everywhere: the stored status decides (a stale row is never trusted)
    let w = await retry(sel.map(([id]) => ia(id, "Draft")), sel.map((x) => head(x[0], x[1], x[2])), ok);
    const ops = wf(w.trace, HOLD).map((x) => [x[2].ia_id, x[2].operation, x[2].source, x[2].organization_id]);
    check("Retry Reservation: by the stored status - Created RECONCILE, a completed IA still holding CLOSE, a Draft still marked RECONCILE (gives it back), " +
      "Cancelled RELEASE_ALL; Processing, closed, nothing marked: not sent; one at a time, in order, source LIST",
      same(ops, [["1", "RECONCILE", "LIST", "1996787068457861121"], ["2", "CLOSE", "LIST", "1996787068457861121"], ["3", "RECONCILE", "LIST", "1996787068457861121"],
        ["4", "RELEASE_ALL", "LIST", "1996787068457861121"], ["8", "RECONCILE", "LIST", "1996787068457861121"], ["9", "CLOSE", "LIST", "1996787068457861121"]]), ops);
    const reads = w.trace.filter((x) => x[0] === "db.get" && x[1].collection === "sm_item_assembly");
    check("Retry Reservation: one field-limited read of the selected IAs' stored status, hold status and organisation", reads.length === 1 &&
      reads[0][1].field === "id,stock_movement_no,item_assembly_status,material_hold_status,organization_id" && Number(reads[0][1].limit) === 9, reads.map((x) => x[1]));
    const alert = named(w.trace, "$alert")[0];
    check("Retry Reservation: one summary of every selected IA, the answer's message or why nothing was sent, then the list refreshed",
      !!alert && /IA-1: RECONCILE done/.test(alert[1]) && /IA-5: being completed in the background/.test(alert[1]) && /IA-6: nothing to retry/.test(alert[1]) &&
      /IA-7: nothing to retry/.test(alert[1]) && alert[2] === "Retry Reservation" && named(w.trace, "refresh").length === 1, alert && alert[1]);
    w = await retry([ia("1", "Created")], [head("1", "Created", "PARTIAL")], () => ({ reject: new Error("down") }));
    check("Retry Reservation: no answer -> said so for that IA", /IA-1: no answer: try again/.test((named(w.trace, "$alert")[0] || [])[1] || ""), named(w.trace, "$alert"));
    w = await retry([ia("1", "Created"), ia("2", "Created")], [head("2", "Created", "PARTIAL")], ok);
    check("Retry Reservation: an IA gone since the list loaded -> no longer available, nothing sent for it", same(wf(w.trace, HOLD).map((x) => x[2].ia_id), ["2"]) &&
      /IA-1: no longer available/.test((named(w.trace, "$alert")[0] || [])[1] || ""), named(w.trace, "$alert"));
    w = await retry([], [], ok);
    check("Retry Reservation: nothing selected -> an error, no read, no call", named(w.trace, "$message.error").length === 1 && !w.trace.some((x) => x[0] === "db.get") &&
      wf(w.trace, HOLD).length === 0);
    w = await retry([ia("1", "Created")], [], ok, { db: () => ({ data: null }) });
    check("Retry Reservation: the stored read fails -> an error, nothing sent", named(w.trace, "$message.error").length === 1 && wf(w.trace, HOLD).length === 0, named(w.trace, "$message.error"));

    // ---- bulk Cancel (user 10-22 evening, like the GD list's): the selected Created IAs cancelled one at a time (IA_HOLD CANCEL, source LIST),
    // by their stored status (a list row can be stale); IA_HOLD releases what each holds and only then sets it Cancelled; one summary
    const tc = tb.findIndex((x) => x.title === "Cancel");
    const cx = H.byName(BUILT, "onItemAssemblyCancel");
    check("toolbar: Cancel right after Retry Reservation, the form Cancel's permission (ia_save_draft), bound to its handler, the IA_HOLD id filled", tc === ti + 1 &&
      tb[tc].type === "custom" && tb[tc].permission === "ia_save_draft" && !!cx && cx.type === "js" && same(tb[tc].events, [{ key: cx.key, name: "onItemAssemblyCancel" }]) &&
      cx.func.indexOf('const RES_HOLD = "' + HOLD + '"') >= 0, [tc, tb[tc]]);
    const ORGX = "1996787068457861121";
    const cancel = async (selected, rows, answer, o) => {
      o = o || {};
      const w = H.world({ db: o.db || stored(rows) });
      const asked = [];
      const self = H.makeThis(w, BUILT, { components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: selected } } } },
        confirm: (m, t) => (asked.push([t, m]), o.decline ? "cancel" : "confirm"), answer: (id, params) => (id === HOLD ? answer(params) : { data: {} }) });
      H.compile(w, cx.func, false).call(self, {});
      await H.drain(w);
      w.asked = asked;
      return w;
    };
    const cancelled = () => ({ data: { code: "200", message: "Cancelled: this Item Assembly's reserved materials are released.", result_json: JSON.stringify({ status: "NONE", cancelled: true }) } });
    const csel = [["1", "Created"], ["2", "Draft"], ["3", "Completed"], ["4", "Cancelled"], ["5", "Processing"], ["6", "Created"], ["7", "Fully Posted"]];
    // every row on the list says Created: the stored status decides
    w = await cancel(csel.map(([id]) => ia(id, "Created")), csel.map((x) => head(x[0], x[1], "FULL")), cancelled);
    check("Cancel: only the stored Created ones sent, one at a time, in order, CANCEL, source LIST, their organisation",
      same(wf(w.trace, HOLD).map((x) => [x[2].ia_id, x[2].operation, x[2].source, x[2].organization_id]), [["1", "CANCEL", "LIST", ORGX], ["6", "CANCEL", "LIST", ORGX]]),
      wf(w.trace, HOLD).map((x) => x[2]));
    const ca = (named(w.trace, "$alert")[0] || [])[1] || "";
    check("Cancel: one summary naming each selected IA (cancelled, or why not), then the list refreshed", /IA-1: cancelled/.test(ca) && /IA-6: cancelled/.test(ca) &&
      /IA-2: a Draft is deleted, not cancelled/.test(ca) && /IA-3: completed: revert it instead/.test(ca) && /IA-4: already cancelled/.test(ca) &&
      /IA-5: being completed in the background/.test(ca) && /IA-7: completed: revert it instead/.test(ca) && (named(w.trace, "$alert")[0] || [])[2] === "Cancel Item Assemblies" &&
      named(w.trace, "refresh").length === 1, ca);
    check("Cancel: asked once first, naming how many and what happens", w.asked.length === 1 && w.asked[0][0] === "Cancel Item Assemblies" &&
      /^Cancel 2 Item Assemblies\? Their reserved materials are released and they can no longer be changed\. 5 of the selected are not Created and are left as they are\.$/.test(w.asked[0][1]),
      w.asked);
    w = await cancel([ia("1", "Created")], [head("1", "Created", "FULL")], cancelled, { decline: true });
    check("Cancel: declined -> nothing sent, nothing refreshed", wf(w.trace, HOLD).length === 0 && named(w.trace, "refresh").length === 0 && named(w.trace, "$alert").length === 0);
    w = await cancel([ia("2", "Created"), ia("3", "Created")], [head("2", "Draft", ""), head("3", "Completed", "CLOSED")], cancelled);
    check("Cancel: none of them Created -> said so, nothing asked or sent", wf(w.trace, HOLD).length === 0 && w.asked.length === 0 &&
      /only a Created Item Assembly can be cancelled/.test(((named(w.trace, "$message.warning")[0] || [])[1]) || ""), named(w.trace, "$message.warning"));
    let n409 = 0;
    w = await cancel([ia("1", "Created")], [head("1", "Created", "FULL")], () => (++n409 <= 2 ? { data: { code: "409", message: "busy" } } : cancelled()));
    check("Cancel: a reservation still running is waited for (two 409s, then cancelled)", wf(w.trace, HOLD).length === 3 &&
      /IA-1: cancelled/.test(((named(w.trace, "$alert")[0] || [])[1]) || ""), wf(w.trace, HOLD).length);
    w = await cancel([ia("1", "Created")], [head("1", "Created", "FULL")], () => ({ data: { code: "200", message: "Needs review: the reserved stock could not be released (X). The Item Assembly was not cancelled: try again.",
      result_json: JSON.stringify({ status: "REVIEW", cancelled: false }) } }));
    check("Cancel: a release that did not finish -> its message, not cancelled", /IA-1: Needs review: .*not cancelled/.test(((named(w.trace, "$alert")[0] || [])[1]) || ""),
      named(w.trace, "$alert"));
    w = await cancel([ia("1", "Created")], [head("1", "Created", "FULL")], () => ({ reject: new Error("down") }));
    check("Cancel: no answer -> said so for that IA", /IA-1: no answer: try again/.test(((named(w.trace, "$alert")[0] || [])[1]) || ""), named(w.trace, "$alert"));
    w = await cancel([ia("1", "Created"), ia("9", "Created")], [head("1", "Created", "FULL")], cancelled);
    check("Cancel: an IA gone since the list loaded -> no longer available", same(wf(w.trace, HOLD).map((x) => x[2].ia_id), ["1"]) &&
      /IA-9: no longer available/.test(((named(w.trace, "$alert")[0] || [])[1]) || ""), named(w.trace, "$alert"));
    w = await cancel([], [], cancelled);
    check("Cancel: nothing selected -> an error, no read, no call", named(w.trace, "$message.error").length === 1 && !w.trace.some((x) => x[0] === "db.get") &&
      wf(w.trace, HOLD).length === 0);
    w = await cancel([ia("1", "Created")], [], cancelled, { db: () => ({ data: null }) });
    check("Cancel: the stored read fails -> an error, nothing sent", named(w.trace, "$message.error").length === 1 && wf(w.trace, HOLD).length === 0);

    // the pending ones finished when the list opens
    const m1 = H.byName(BUILT, "mounted");
    const pending = [head("11", "Created", "RESERVING"), head("12", "Created", "RESERVING")];
    const mountRes = async (code, rows, answer, o) => {
      o = o || {};
      const w = H.world({ storage: o.storage, db: (name, q) => (name === "sm_item_assembly" ? { data: rows } : { data: [] }) });
      const self = H.makeThis(w, BUILT, { answer: (id, params) => (id === HOLD ? answer(params) : { data: { processed: "0" } }) });
      H.compile(w, code, false).call(self, {});
      await H.drain(w);
      return w;
    };
    const noSweep = { ia_res_sweep_at: String(1800000000000) };
    w = await mountRes(m1.func, pending, ok, { storage: Object.assign({}, noSweep) });
    const kr = w.trace.filter((x) => x[0] === "db.get" && x[1].collection === "sm_item_assembly");
    check("list mounted: one read of the IAs still Reserving (Created, not deleted, at most 10, field-limited)", kr.length === 1 && Number(kr[0][1].limit) === 10 &&
      kr[0][1].field === "id,organization_id" && /"material_hold_status".*"RESERVING"/.test(JSON.stringify(kr[0][1].filter)) && /"item_assembly_status".*"Created"/.test(JSON.stringify(kr[0][1].filter)),
      kr.map((x) => x[1]));
    check("list mounted: each pending one RECONCILE (source LIST), one at a time; the list refreshed once they answered", same(wf(w.trace, HOLD).map((x) => [x[2].ia_id, x[2].operation, x[2].source]),
      [["11", "RECONCILE", "LIST"], ["12", "RECONCILE", "LIST"]]) && named(w.trace, "refresh").length === 1 && !!w.storage.ia_res_kick_at, [wf(w.trace, HOLD).length, named(w.trace, "refresh").length]);
    w = await mountRes(m1.func, pending, ok, { storage: Object.assign({ ia_res_kick_at: String(1800000000000 - 60000) }, noSweep) });
    check("list mounted: kicked 1 min ago -> no read, no call", !w.trace.some((x) => x[0] === "db.get" && x[1].collection === "sm_item_assembly") && wf(w.trace, HOLD).length === 0);
    w = await mountRes(m1.func, [], ok, { storage: Object.assign({}, noSweep) });
    check("list mounted: nothing pending -> no call, no refresh", wf(w.trace, HOLD).length === 0 && named(w.trace, "refresh").length === 0);
    const still = () => ({ data: { code: "200", message: "Being reserved right now.", result_json: "" } });
    w = await mountRes(m1.func, pending, still, { storage: Object.assign({}, noSweep) });
    check("list mounted: answers that changed nothing -> no refresh", wf(w.trace, HOLD).length === 2 && named(w.trace, "refresh").length === 0);
    const offRes = m1.func.replace("const IA_RES_ENABLED = true;", "const IA_RES_ENABLED = false;");
    w = await mountRes(offRes, pending, ok, { storage: Object.assign({}, noSweep) });
    check("list mounted, the reservation switch off: no pending read, no call", !w.trace.some((x) => x[0] === "db.get" && x[1].collection === "sm_item_assembly") &&
      wf(w.trace, HOLD).length === 0);
    // MIN-05 (BA 10-22): the IAs deleted while still holding (a delete interrupted between its header write and its release): SWEEP, then
    // RELEASE_ALL for each, at most every 10 minutes per browser, whatever the switch
    const swept = (ias, code) => (params) => (params.operation === "SWEEP" ? { data: { code: code || "200", message: "x", result_json: JSON.stringify({ ias: ias }) } }
      : { data: { code: "200", message: "Released: this Item Assembly holds no material now.", result_json: JSON.stringify({ status: "NONE" }) } });
    const gone = [{ id: "21", org: "1996787068457861121", no: "IA-21" }, { id: "22", org: "1996787068457861122", no: "IA-22" }];
    const noPending = { ia_res_kick_at: String(1800000000000) };
    w = await mountRes(m1.func, [], swept(gone), { storage: Object.assign({}, noPending) });
    check("list mounted: SWEEP (ia 0, LIST), then RELEASE_ALL (LIST) for each deleted IA still holding, in order; the sweep time stored",
      same(wf(w.trace, HOLD).map((x) => [x[2].ia_id, x[2].organization_id, x[2].operation, x[2].source]), [["0", "0", "SWEEP", "LIST"],
        ["21", "1996787068457861121", "RELEASE_ALL", "LIST"], ["22", "1996787068457861122", "RELEASE_ALL", "LIST"]]) && w.storage.ia_res_sweep_at === String(1800000000000),
      wf(w.trace, HOLD).map((x) => x[2]));
    w = await mountRes(m1.func, [], swept(gone), { storage: Object.assign({ ia_res_sweep_at: String(1800000000000 - 300000) }, noPending) });
    check("list mounted: swept 5 min ago -> no sweep", wf(w.trace, HOLD).length === 0);
    w = await mountRes(m1.func, [], swept(gone, "400"), { storage: Object.assign({}, noPending) });
    check("list mounted: a sweep not answered 200 -> nothing released", same(wf(w.trace, HOLD).map((x) => x[2].operation), ["SWEEP"]));
    w = await mountRes(m1.func, [], () => ({ reject: new Error("down") }), { storage: Object.assign({}, noPending) });
    check("list mounted: a failed sweep -> nothing released", same(wf(w.trace, HOLD).map((x) => x[2].operation), ["SWEEP"]));
    w = await mountRes(m1.func, [], swept([{ id: "1) OR 1=1", org: "1" }, { id: "23", org: "" }, gone[0]]), { storage: Object.assign({}, noPending) });
    check("list mounted: a malformed id or organisation skipped", same(wf(w.trace, HOLD).map((x) => x[2].ia_id), ["0", "21"]));
    w = await mountRes(offRes, [], swept(gone), { storage: {} });
    check("list mounted, the reservation switch off: no pending read, the sweep still runs (finishing holds is never switched off)",
      !w.trace.some((x) => x[0] === "db.get" && x[1].collection === "sm_item_assembly") && same(wf(w.trace, HOLD).map((x) => x[2].operation), ["SWEEP", "RELEASE_ALL", "RELEASE_ALL"]));
    w = await mountRes(m1.func.replace(HOLD_LINE, 'const RES_HOLD = "0"; // IA_HOLD'), pending, swept(gone), { storage: {} });
    check("list mounted, no IA_HOLD id: no IA read, no IA_HOLD call, no reservation storage (the workers' kicks are theirs)",
      !w.trace.some((x) => x[0] === "db.get" && x[1].collection === "sm_item_assembly") && wf(w.trace, HOLD).length === 0 && !w.storage.ia_res_sweep_at &&
      !w.storage.ia_res_kick_at, w.trace.filter((x) => x[0] !== "runWorkflow"));
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
  // RES-01 Cancel (user 10-22): a Cancelled IA is read-only: no Edit action
  {
    const edit = BUILT.list[0].options.customProps.rowActions[1];
    check("list: Edit hidden for a Cancelled row (as for Processing)", edit.type === "editBtn" && /arguments\[0\]\.row\.item_assembly_status === 'Cancelled'/.test(edit.hidden) &&
      /arguments\[0\]\.row\.item_assembly_status === 'Processing'/.test(edit.hidden), edit.hidden);
  }
  // RES-01 Created (BA, 10-22): the status column shows a Created badge (the Purchase Order's Created colours) right after the Draft one
  {
    const col = BUILT.list[0].options.customProps.columns.find((c) => c.name === "item_assembly_status");
    const content = col.configCustom.content;
    const badges = (content.match(/scope\.value==='[^']+'/g) || []).map((x) => x.slice(15, -1));
    check("list: a Created badge right after Draft's, in Created's colours", same(badges, ["Pending Approval", "Fully Posted", "Issued", "Draft", "Created", "Completed", "Processing", "Cancelled"]) &&
      /<div v-if="scope\.value==='Created'" style="[^"]*border: 2px solid #036DF8; background-color: #C6DFFF;[^"]*">\{\{scope\.value\}\}<\/div>/.test(content), badges);
  }
  H.done("lists");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("lists");
});
