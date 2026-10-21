// IA V2 Complete & Post (bladexfunctions-8c, 10-21): a second click while the first one validates or reads the BOM is refused
// (it used to start a twin flow on the same job key, and both posted on COMPLETED); a job is posted once, and only while the
// stored assembly is Completed and not posted yet. A Cancel at the BOM check or the classic route leaves the next click free.
//   node scratchpad/iasc/client/test/test_v2_double.js
const H = require("./harness");
const F = require("./fixture");
const { check } = H;

const ON = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const SUBMIT = "2112141238600376321";
const ACC = "2013511169625042946";

const big = [];
for (let i = 0; i < 60; i++) {
  big.push({ item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 1, total_quantity: 1,
    temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", balance_id: "BL2", sm_quantity: 1, category: "Unrestricted" }]), temp_hu_data: "" });
}
const draft = F.header({ id: "4001", page_status: "Edit", stock_movement: big });
const answer = (id, params) => {
  if (id === SUBMIT && params.operation === "SUBMIT") return { data: { route: "QUEUED", code: "200", job_id: "7001", ia_id: "4001", job_status: "QUEUED" } };
  if (id === SUBMIT && params.operation === "STATUS") return { data: { route: "STATUS", code: "200", job_id: "7001", ia_id: "4001", job_status: "COMPLETED", terminal: "YES", progress_percent: 100 } };
  return { data: { code: "200", message: "ok" } };
};
const tables = (posted) => F.tables({ extra: {
  accounting_integration: [{ id: "AI1", organization_id: "1001", acc_integration_type: "SQL Accounting V2", agent_id: "A1" }],
  sm_item_assembly: [{ id: "4001", item_assembly_status: "Completed", posted_status: posted === undefined ? "Unposted" : posted, is_deleted: 0 }],
} });
const tab = (w, o) => H.makeThis(w, ON, Object.assign({ values: H.clone(draft), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, answer), confirm: () => "confirm" }, o || {}));
const click = (w, self, name) => {
  const e = H.byName(ON, name || "iaV2_onClick_completed_post");
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self, { field: "comp_post_button", fieldNode: "comp_post_button", currentRef: {}, $eventArgs: [] });
};
const count = (w) => ({
  submits: w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === SUBMIT && t[2].operation === "SUBMIT").length,
  posts: w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === ACC).length,
  pending: w.trace.filter((t) => t[0] === "db.update" && t[2] && t[2].posted_status === "Pending Post").length,
  busy: w.trace.filter((t) => t[0] === "$message.warning" && /already in progress/.test(t[1])).length,
  classic: w.trace.filter((t) => t[0] === "triggerEvent" && t[1] === "onClick_saveAsCompletedPost").length,
});

(async () => {
  // ---- a double click: the second click lands while the first awaits validate() / the BOM check
  {
    const w = H.world({ db: H.tableDb(tables()) });
    const self = tab(w);
    click(w, self);
    click(w, self);
    await H.drain(w);
    const c = count(w);
    check("double click on Complete & Post: one SUBMIT, the second click told to wait", c.submits === 1 && c.busy === 1, c);
    check("double click on Complete & Post: posted once (one Pending Post, one agent task)", c.posts === 1 && c.pending === 1, c);
  }
  // ---- two flows following the same job (another tab of the same browser): the job is posted once
  {
    const w = H.world({ db: H.tableDb(tables()) });
    click(w, tab(w));
    click(w, tab(w));
    await H.drain(w);
    const c = count(w);
    check("two tabs following one job: posted once", c.posts === 1 && c.pending === 1, c);
  }
  // ---- the stored assembly is not postable any more (posted from another device meanwhile): no post
  for (const posted of ["Pending Post", "Posted"]) {
    const w = H.world({ db: H.tableDb(tables(posted)) });
    click(w, tab(w));
    await H.drain(w);
    const c = count(w);
    check("stored posted status " + posted + ": not posted again", c.posts === 0 && c.pending === 0, c);
  }
  // ---- one click: posted once, after one field-limited read of the stored assembly
  {
    const w = H.world({ db: H.tableDb(tables()) });
    click(w, tab(w));
    await H.drain(w);
    const c = count(w);
    const reads = w.trace.filter((t) => t[0] === "db.get" && t[1].collection === "sm_item_assembly");
    check("one click: posted once", c.submits === 1 && c.posts === 1 && c.pending === 1, c);
    check("one click: the stored status read before the post (field-limited)", reads.length === 1 && reads[0][1].field === "item_assembly_status,posted_status" &&
      String(reads[0][1].where.id) === "4001", reads.map((t) => t[1]));
  }
  // ---- localStorage blocked (a private window): still posted once
  {
    const w = H.world({ db: H.tableDb(tables()), storageThrows: true });
    click(w, tab(w));
    await H.drain(w);
    check("localStorage blocked: posted once", count(w).posts === 1, count(w));
  }
  // ---- a Cancel at the BOM check frees the next click
  {
    const w = H.world({ db: H.tableDb(tables()) });
    let n = 0;
    const self = tab(w, { confirm: () => (n++ === 0 ? "cancel" : "confirm") });
    click(w, self);
    await H.drain(w);
    click(w, self);
    await H.drain(w);
    const c = count(w);
    check("Cancel at the BOM check, then click again: the second click submits", c.submits === 1 && c.busy === 0 && c.posts === 1, c);
  }
  // ---- the classic route (validation failed) frees the next click: both clicks reach the classic handler
  {
    const w = H.world({ db: H.tableDb(tables()) });
    const self = tab(w, { invalid: new Error("required") });
    click(w, self);
    await H.drain(w);
    click(w, self);
    await H.drain(w);
    const c = count(w);
    check("validation failed twice: the classic handler runs for each click, nothing submitted", c.classic === 2 && c.submits === 0 && c.busy === 0, c);
  }
  H.done("test_v2_double");
})();
