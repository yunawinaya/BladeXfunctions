// The form's Post (e9ib2r8i) and the list's bulk Post (ee9v0c1h) write Pending Post only for a disassembly whose STORED status is
// Completed and whose stored posted status is Unposted / Failed Post / blank; a stale form or grid row (a background job holds it
// now, or it was posted since) is refused. A postable one is posted exactly as the base does.
//   node test/test_post.js
const H = require("./harness");
const { check, same } = H;

const F0 = H.readJSON(H.FILES.formBase);
const F1 = H.readJSON(H.FILES.form);
const L0 = H.readJSON(H.FILES.listBase);
const L1 = H.readJSON(H.FILES.list);
const ACC = "2013511169625042946";
const named = (trace, n) => trace.filter((t) => t[0] === n);
const isStoredRead = (t) => t[0] === "db.get" && t[1].collection === "sm_item_disassembly";
const withoutStoredRead = (trace) => trace.filter((t) => !isStoredRead(t));
const writes = (trace) => trace.filter((t) => t[0] === "db.update");
const accCalls = (trace) => trace.filter((t) => t[0] === "runWorkflow" && t[1] === ACC);

// db: accounting_integration (one row, or none), sm_item_disassembly = the stored rows by id (limit honoured, `clamp` rows at most)
const dbOf = (stored, accType, clamp) => (name, q) => {
  if (name === "accounting_integration") return { data: accType === null ? [] : [{ acc_integration_type: accType || "SQL Accounting V2", agent_id: "A1" }] };
  if (name === "sm_item_disassembly") {
    const ids = q.where ? [String(q.where.id)] : q.filter[0].children[0].value.map(String);
    const rows = ids.filter((id) => stored[id]).map((id) => Object.assign({ id: id }, stored[id]));
    return { data: rows.slice(0, Math.min(q.limit === undefined ? 100000 : q.limit, clamp || 100000)) };
  }
  return { data: [] };
};

const formPost = async (doc, stored, accType) => {
  const w = H.world({ db: dbOf(stored, accType) });
  const self = H.makeThis(w, doc, { values: { id: "77", stock_movement_no: "IDA-77", item_disassembly_status: "Completed", posted_status: "Unposted" } });
  await H.fire(w, H.byKey(doc, "e9ib2r8i"), self);
  return w;
};
const row = (id, status, posted) => ({ id: id, stock_movement_no: "IDA-" + id, item_disassembly_status: { dict_key: status }, posted_status: { dict_key: posted } });
const listPost = async (doc, selected, stored, accType, clamp) => {
  const w = H.world({ db: dbOf(stored, accType, clamp) });
  const self = H.makeThis(w, doc, { components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: selected, clearSelection: () => w.rec("clearSelection") } } } } });
  H.compile(w, H.byKey(doc, "ee9v0c1h").func, false).call(self, {});
  await H.drain(w);
  return w;
};
const st = (status, posted) => ({ item_disassembly_status: status, posted_status: posted });

(async () => {
  // ---- the form's Post
  for (const [what, stored] of [["Unposted", st("Completed", "Unposted")], ["Failed Post", st("Completed", "Failed Post")], ["blank", st("Completed", "")],
    ["null", st("Completed", null)], ["dict objects", st({ dict_key: "Completed" }, { dict_key: "Unposted" })]]) {
    for (const acc of ["SQL Accounting V2", "AutoCount Accounting V2", "No Accounting Integration"]) {
      const a = await formPost(F0, { 77: stored }, acc);
      const b = await formPost(F1, { 77: stored }, acc);
      const reads = b.trace.filter(isStoredRead);
      check("form Post, stored Completed + " + what + ", " + acc + ": the base's calls + one stored read (field-limited, with the accounting read)", reads.length === 1 &&
        same(reads[0][1], { collection: "sm_item_disassembly", where: { id: "77", is_deleted: 0 }, field: "item_disassembly_status,posted_status" }) &&
        same(withoutStoredRead(b.trace), a.trace) && accCalls(b.trace).length === (acc === "No Accounting Integration" ? 0 : 1), { a: a.trace.map((t) => t[0]), b: b.trace.map((t) => t[0]) });
    }
  }
  for (const [what, stored, text] of [["Processing", { 77: st("Processing", "") }, "This Item Disassembly cannot be posted (Processing)."],
    ["Pending Post", { 77: st("Completed", "Pending Post") }, "This Item Disassembly cannot be posted (Completed, Pending Post)."],
    ["Posted", { 77: st("Completed", "Posted") }, "This Item Disassembly cannot be posted (Completed, Posted)."],
    ["Fully Posted", { 77: st("Fully Posted", "Posted") }, "This Item Disassembly cannot be posted (Fully Posted, Posted)."],
    ["Draft", { 77: st("Draft", "") }, "This Item Disassembly cannot be posted (Draft)."],
    ["no status", { 77: st("", "") }, "This Item Disassembly cannot be posted (no status)."],
    ["gone", {}, "This Item Disassembly is no longer available."]]) {
    for (const acc of ["SQL Accounting V2", "No Accounting Integration"]) {
      const b = await formPost(F1, stored, acc);
      check("form Post, stored " + what + ", " + acc + ": refused before anything is written", writes(b.trace).length === 0 && accCalls(b.trace).length === 0 &&
        named(b.trace, "$message.error").some((t) => t[1] === text) && named(b.trace, "hideLoading").length === 1 && named(b.trace, "dialog.hide").length === 0,
        b.trace.map((t) => t[0] + ":" + JSON.stringify(t[1] || "").slice(0, 60)));
    }
  }

  // ---- the list's bulk Post
  {
    const sel = [row("1", "Completed", "Unposted"), row("2", "Completed", "Unposted"), row("3", "Processing", ""), row("4", "Completed", "Failed Post"), row("5", "Completed", "Unposted")];
    const stored = { 1: st("Completed", "Unposted"), 2: st("Processing", "Unposted"), 3: st("Processing", ""), 4: st("Completed", { dict_key: "Failed Post" }) };
    const b = await listPost(L1, sel, stored);
    const reads = b.trace.filter(isStoredRead);
    check("list Post: one stored read of the rows the grid allows (field-limited, limited), then one re-ask for the id it left out (5, gone)",
      reads.length === 2 && same(reads[0][1].filter[0].children[0].value, ["1", "2", "4", "5"]) && reads[0][1].field === "item_disassembly_status,posted_status" &&
      reads[0][1].limit === 4 && same(reads[1][1].filter[0].children[0].value, ["5"]) && reads[1][1].limit === 1, reads.map((t) => t[1].filter[0].children[0].value));
    check("list Post: Pending Post written for the stored-postable rows only; ACC_PRODUCER with those ids", same(writes(b.trace).map((t) => [t[1].doc, t[2]]), [["1", { posted_status: "Pending Post" }], ["4", { posted_status: "Pending Post" }]]) &&
      accCalls(b.trace).length === 1 && same(accCalls(b.trace)[0][2].payload, ["1", "4"]), writes(b.trace));
    check("list Post: the changed rows named in a warning", named(b.trace, "$message.warning").some((t) => t[1] === "Not posted, changed since the list loaded: IDA-2 (Processing, Unposted); IDA-5 (no longer available)"),
      named(b.trace, "$message.warning"));
    const all = await listPost(L1, [row("2", "Completed", "Unposted")], { 2: st("Processing", "") });
    check("list Post: every row changed -> nothing written, the warning, the list refreshed", writes(all.trace).length === 0 && accCalls(all.trace).length === 0 &&
      named(all.trace, "$message.warning").length === 1 && named(all.trace, "refresh").length === 1 && named(all.trace, "hideLoading").length === 1);
    for (const acc of ["SQL Accounting V2", "AutoCount Accounting V2", "No Accounting Integration", null]) {
      const rows = [row("1", "Completed", "Unposted"), row("4", "Completed", "Failed Post"), row("6", "Draft", ""), row("7", "Completed", null)];
      const sto = { 1: st("Completed", "Unposted"), 4: st("Completed", "Failed Post"), 6: st("Draft", ""), 7: st("Completed", null) };
      const a = await listPost(L0, rows, sto, acc);
      const c = await listPost(L1, rows, sto, acc);
      check("list Post, nothing changed, " + (acc || "no accounting row") + ": the base's calls + the stored read", same(withoutStoredRead(c.trace), a.trace) && c.trace.filter(isStoredRead).length === 1,
        { a: a.trace.map((t) => t[0]), c: c.trace.map((t) => t[0]) });
    }
    const none = await listPost(L1, [row("6", "Draft", "")], {});
    const none0 = await listPost(L0, [row("6", "Draft", "")], {});
    check("list Post, no row the grid allows: the base's alert, no read", same(none.trace, none0.trace) && none.trace.filter(isStoredRead).length === 0);
    // 600 rows under a 100-row clamp: chunks of 500, the clamp re-read; every one posted
    const many = Array.from({ length: 600 }, (_, i) => row(String(1000 + i), "Completed", "Unposted"));
    const sto = {};
    many.forEach((r) => (sto[r.id] = st("Completed", "Unposted")));
    const big = await listPost(L1, many, sto, "SQL Accounting V2", 100);
    check("list Post, 600 rows, a 100-row clamp: every row read back (500-id chunks, re-asked), every one written", writes(big.trace).length === 600 &&
      big.trace.filter(isStoredRead).every((t) => t[1].filter[0].children[0].value.length <= 500) && named(big.trace, "$message.warning").length === 0);
    // a stored read that fails: nothing written (the base's catch)
    const failing = H.world({ db: dbOf(sto), dbThrows: (name) => name === "sm_item_disassembly" });
    const self = H.makeThis(failing, L1, { components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: [row("1", "Completed", "Unposted")], clearSelection: () => {} } } } } });
    H.compile(failing, H.byKey(L1, "ee9v0c1h").func, false).call(self, {});
    await H.drain(failing);
    check("list Post, the stored read failing: nothing written, the error shown", writes(failing.trace).length === 0 && named(failing.trace, "$message.error").length === 1);
  }
  H.done("posting guards");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("posting guards");
});
