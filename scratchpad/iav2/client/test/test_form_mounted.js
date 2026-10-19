// IA form mounted: OFF = the base v32 mounted for every status it knew; Processing = its badge, read-only, no save / post
// button (OFF too); ON = STATUS + a worker kick every 15 s (the completion worker for a completion, the revert worker for a
// revert), a FAILED job shown once per browser.
//   node test/test_form_mounted.js
const H = require("./harness");
const { check, same } = H;

const BASE = H.readJSON(H.FILES.formBase);
const BUILT = H.readJSON(H.FILES.form);
const T = H.TEST_IDS;
const mountedOf = (sw, wf) => H.variant(H.byName(BUILT, "mounted").func, sw, wf);
const OFF = mountedOf({ master: false, revert: false }, H.OFF_IDS);
const ON = mountedOf({ master: true, revert: true }, T);
const ON_COMPLETE_ONLY = mountedOf({ master: true, revert: false }, T);
const ON_REVERT_ONLY = mountedOf({ master: false, revert: true }, T);
const ON_IDS_0 = mountedOf({ master: true, revert: true }, H.OFF_IDS);
const BUTTONS4 = ["button_draft", "button_completed", "comp_post_button", "button_post"];

const values = (status, o) => Object.assign({ id: "77", stock_movement_no: "IA-77", item_assembly_status: status, inventory_category: "Unrestricted", item_id: "P1",
  batch_no: "", manufacturing_date: null, expired_date: null, organization_id: "1001", ia_v2_job_id: "", stock_movement: [] }, o || {});
const st = (job_status, o) => Object.assign({ route: "STATUS", code: "200", job_id: "J1", job_status: job_status,
  terminal: ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED", "NONE"].indexOf(job_status) >= 0 ? "YES" : "NO", ia_id: "77", action: "DIRECT", progress_percent: "10" }, o || {});

const mount = async (code, vals, flags, o) => {
  o = o || {};
  const w = H.world({ storage: o.storage, storageThrows: o.storageThrows, db: (name) => (name === "item" ? { data: [{ id: "P1", item_batch_management: 0 }] } : { data: [] }) });
  let n = 0;
  const self = H.makeThis(w, BASE, Object.assign({ values: vals, answer: (id, p) => {
    if (id === T.IA_V2_SUBMIT || id === T.IA_REVERT_V2_SUBMIT) {
      const list = o.status || [st("COMPLETED")];
      return { data: list[Math.min(n++, list.length - 1)] };
    }
    return { data: { processed: "0" } };
  } }, flags));
  H.compile(w, code, false).call(self, {});
  await H.drain(w);
  const wf = (id, op) => w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === id && (!op || t[2].operation === op));
  return { w: w, trace: w.trace, wf: wf };
};
const named = (trace, name) => trace.filter((t) => t[0] === name);
const noBg = (trace) => !trace.some((t) => t[0] === "runWorkflow" || t[0].indexOf("localStorage") === 0);

(async () => {
  const m0 = H.byName(BASE, "mounted").func;
  // ---- OFF = base for the statuses the base knew, in Edit and View; Add / Clone too
  for (const status of ["Draft", "Issued", "Completed", "Fully Posted", ""]) {
    for (const flags of [{ isEdit: true }, { isView: true }]) {
      const a = await mount(m0, values(status), flags);
      const b = await mount(OFF, values(status, { ia_v2_job_id: "5001" }), flags);
      check("mounted OFF " + (status || "blank") + " " + Object.keys(flags)[0] + ": identical to base", same(a.trace, b.trace), { a: a.trace.slice(0, 10), b: b.trace.slice(0, 10) });
      // the ids still 0 behave as OFF
      const c = await mount(ON_IDS_0, values(status, { ia_v2_job_id: "5001" }), flags);
      check("mounted ON with ids 0, " + (status || "blank") + " " + Object.keys(flags)[0] + ": identical to base", same(a.trace, c.trace));
    }
  }
  for (const flags of [{ isAdd: true }, { isCopy: true }]) {
    const a = await mount(m0, values(""), flags);
    const b = await mount(OFF, values(""), flags);
    const c = await mount(ON, values(""), flags);
    check("mounted OFF " + Object.keys(flags)[0] + ": identical to base", same(a.trace, b.trace));
    check("mounted ON " + Object.keys(flags)[0] + ": identical to base", same(a.trace, c.trace));
  }
  // ON, an assembly no V2 job ever held: the base plus one read of ia_v2_job_id, no workflow, no storage
  for (const status of ["Draft", "Completed"]) {
    const a = await mount(m0, values(status), { isEdit: true });
    const c = await mount(ON, values(status), { isEdit: true });
    const extra = c.trace.filter((t) => !a.trace.some((x) => same(x, t)));
    check("mounted ON " + status + " without a job: base + getValue(ia_v2_job_id) only", same(extra, [["getValue", "ia_v2_job_id"]]) && noBg(c.trace) &&
      same(c.trace.filter((t) => !(t[0] === "getValue" && t[1] === "ia_v2_job_id")), a.trace));
  }

  // ---- Processing (OFF): the badge, read-only, no save / post button, a message; no workflow, no storage
  for (const flags of [{ isEdit: true }, { isView: true }]) {
    const b = await mount(OFF, values("Processing", { ia_v2_job_id: "J1" }), flags);
    const shown = named(b.trace, "display").map((t) => JSON.stringify(t[1])).join(" ");
    const hidden = named(b.trace, "hide").map((t) => JSON.stringify(t[1])).join(" ");
    check("mounted OFF Processing " + Object.keys(flags)[0] + ": the Processing badge, components locked, no button shown, a message, nothing else",
      named(b.trace, "display").some((t) => same(t[1], ["processing_status"])) && BUTTONS4.every((x) => shown.indexOf(x) < 0) &&
      named(b.trace, "disabled").some((t) => same(t[1], ["stock_movement"]) && t[2] === true) && named(b.trace, "$message.warning").some((t) => /being processed in the background/.test(t[1])) &&
      noBg(b.trace) && (flags.isView || BUTTONS4.every((x) => hidden.indexOf(x) >= 0)), b.trace.map((t) => t[0] + " " + JSON.stringify(t[1] || "")));
    // the base (no Processing case) showed the Completed buttons for it: the change
    const a = await mount(m0, values("Processing"), flags);
    if (flags.isEdit) check("base mounted Processing (Edit) displayed button_completed / comp_post_button (now hidden)", named(a.trace, "display").some((t) => same(t[1], ["button_completed", "comp_post_button"])));
  }

  // ---- ON: Processing follows its job
  let r = await mount(ON, values("Processing", { ia_v2_job_id: "J1" }), { isEdit: true }, { status: [st("VALIDATING"), st("COMMITTING_IA", { progress_percent: "75" }), st("COMPLETED")] });
  check("mounted ON Processing (completion): STATUS by ia_id on IA_V2_SUBMIT, the completion worker kicked, completed message", r.wf(T.IA_V2_SUBMIT, "STATUS").length === 3 &&
    r.wf(T.IA_V2_SUBMIT, "STATUS").every((t) => same(t[2], { operation: "STATUS", saveAs: "Completed", pageStatus: "Edit", ia_id: "77", idempotency_key: "", source: "FORM", form: {} })) &&
    r.wf(T.IA_V2_WORKER).length >= 1 && r.wf(T.IA_V2_WORKER).every((t) => same(t[2], { job_id: "J1" })) && r.wf(T.IA_REVERT_V2_WORKER).length === 0 &&
    named(r.trace, "$message.success").some((t) => /has been completed/.test(t[1])), r.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]));
  r = await mount(ON, values("Processing", { ia_v2_job_id: "J1" }), { isEdit: true }, { status: [st("VALIDATING")] });
  check("mounted ON Processing: re-kicks every 15 s, gives up after 420 s with a message", r.wf(T.IA_V2_WORKER).length >= 28 && r.wf(T.IA_V2_WORKER).length <= 30 &&
    r.wf(T.IA_V2_SUBMIT, "STATUS").length >= 135 && named(r.trace, "$message.info").some((t) => /still being processed/.test(t[1])), { kicks: r.wf(T.IA_V2_WORKER).length, status: r.wf(T.IA_V2_SUBMIT, "STATUS").length });
  r = await mount(ON, values("Processing", { ia_v2_job_id: "J1" }), { isEdit: true }, { status: [st("COMMITTING_REVERT", { action: "REVERT" }), st("COMPLETED", { action: "REVERT" })] });
  check("mounted ON Processing (revert): the revert worker kicked (not the completion worker), reverted message", r.wf(T.IA_REVERT_V2_WORKER).length >= 1 && r.wf(T.IA_V2_WORKER).length === 0 &&
    named(r.trace, "$message.info").some((t) => /being reverted in the background/.test(t[1])) && named(r.trace, "$message.success").some((t) => /reverted to Draft/.test(t[1])));
  r = await mount(ON_COMPLETE_ONLY, values("Processing"), { isEdit: true }, { status: [st("COMMITTING_REVERT", { action: "REVERT" }), st("COMPLETED", { action: "REVERT" })] });
  check("mounted, revert switch off: a revert job is followed but its worker is not kicked", r.wf(T.IA_REVERT_V2_WORKER).length === 0 && r.wf(T.IA_V2_WORKER).length === 0 && r.wf(T.IA_V2_SUBMIT, "STATUS").length === 2);
  r = await mount(ON_REVERT_ONLY, values("Processing"), { isEdit: true }, { status: [st("COMMITTING_REVERT", { action: "REVERT" }), st("COMPLETED", { action: "REVERT" })] });
  check("mounted, only the revert switch on: STATUS on IA_REVERT_V2_SUBMIT (RV4 request), the revert worker kicked", r.wf(T.IA_V2_SUBMIT).length === 0 &&
    r.wf(T.IA_REVERT_V2_SUBMIT, "STATUS").length === 2 && same(r.wf(T.IA_REVERT_V2_SUBMIT)[0][2], { operation: "STATUS", ia_id: "77", idempotency_key: "", source: "FORM", min_picks: "", form: {} }) &&
    r.wf(T.IA_REVERT_V2_WORKER).length >= 1 && r.wf(T.IA_V2_WORKER).length === 0);
  r = await mount(ON_REVERT_ONLY, values("Processing"), { isEdit: true }, { status: [st("VALIDATING"), st("COMPLETED")] });
  check("mounted, only the revert switch on: a completion job is not kicked", r.wf(T.IA_V2_WORKER).length === 0 && r.wf(T.IA_REVERT_V2_WORKER).length === 0);
  // NONE while Processing (an Add whose SUBMIT stopped before the link): its job kicked by id, a warning
  r = await mount(ON, values("Processing", { ia_v2_job_id: "5005" }), { isEdit: true }, { status: [{ route: "STATUS", code: "200", job_id: "", job_status: "NONE", terminal: "YES" }] });
  check("mounted ON Processing, no job any more: the record's job kicked, a warning", same(r.wf(T.IA_V2_WORKER).map((t) => t[2]), [{ job_id: "5005" }]) &&
    named(r.trace, "$message.warning").some((t) => /not being processed in the background any more/.test(t[1])));
  // FAILED: once per browser; REQUIRES_REVIEW every time
  const storage = {};
  r = await mount(ON, values("Processing", { ia_v2_job_id: "J1" }), { isEdit: true }, { storage: storage, status: [st("FAILED", { error_message: "Insufficient quantity - line 4" })] });
  const r2 = await mount(ON, values("Processing", { ia_v2_job_id: "J1" }), { isEdit: true }, { storage: storage, status: [st("FAILED", { error_message: "Insufficient quantity - line 4" })] });
  check("mounted ON Processing, FAILED: shown once per browser", named(r.trace, "$alert").length === 1 && /Insufficient quantity - line 4\. Reopen it to continue\./.test(named(r.trace, "$alert")[0][1]) &&
    named(r2.trace, "$alert").length === 0 && storage["ia_v2_failed_seen_J1"] === "1");
  r = await mount(ON, values("Processing"), { isEdit: true }, { status: [st("REQUIRES_REVIEW", { error_message: "IA_RECEIPT_TIMEOUT" })] });
  check("mounted ON Processing, REQUIRES_REVIEW: a review warning", named(r.trace, "$alert").length === 1 && /needs a review/.test(named(r.trace, "$alert")[0][2]));
  r = await mount(ON, values("Processing"), { isEdit: true }, { storageThrows: true, status: [st("FAILED", { error_message: "x" })] });
  check("mounted ON Processing, browser storage blocked: still shown, no error", named(r.trace, "$alert").length === 1);

  // ---- ON: an assembly a job once held and released
  const s2 = {};
  r = await mount(ON, values("Draft", { ia_v2_job_id: "5001" }), { isEdit: true }, { storage: s2, status: [st("FAILED", { job_id: "5001", error_message: "Insufficient quantity" })] });
  const again = await mount(ON, values("Draft", { ia_v2_job_id: "5001" }), { isEdit: true }, { storage: s2, status: [st("FAILED", { job_id: "5001", error_message: "Insufficient quantity" })] });
  check("mounted ON Draft after a FAILED completion: shown once per browser (then not asked again)", named(r.trace, "$message.warning").filter((t) => /last background completion failed - Insufficient quantity/.test(t[1])).length === 1 &&
    named(again.trace, "$message.warning").length === 0 && again.trace.filter((t) => t[0] === "runWorkflow").length === 0);
  const s3 = {};
  r = await mount(ON, values("Completed", { ia_v2_job_id: "6001" }), { isEdit: true }, { storage: s3, status: [st("FAILED", { job_id: "6001", action: "REVERT", error_message: "Revert blocked: the assembled item has been used" })] });
  check("mounted ON Completed after a FAILED revert: shown once", named(r.trace, "$message.warning").some((t) => /last background revert failed - Revert blocked/.test(t[1])));
  const s4 = {};
  r = await mount(ON, values("Completed", { ia_v2_job_id: "7001" }), { isEdit: true }, { storage: s4, status: [st("COMPLETED", { job_id: "7001" })] });
  const r4 = await mount(ON, values("Completed", { ia_v2_job_id: "7001" }), { isEdit: true }, { storage: s4, status: [st("COMPLETED", { job_id: "7001" })] });
  check("mounted ON Completed by V2: nothing shown, not asked again in this browser", named(r.trace, "$message.warning").length === 0 && r.trace.filter((t) => t[0] === "runWorkflow").length === 1 &&
    r4.trace.filter((t) => t[0] === "runWorkflow").length === 0);
  r = await mount(ON, values("Fully Posted", { ia_v2_job_id: "7001" }), { isEdit: true });
  check("mounted ON Fully Posted with a job id: no STATUS", r.trace.filter((t) => t[0] === "runWorkflow").length === 0);
  H.done("form mounted");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("form mounted");
});
