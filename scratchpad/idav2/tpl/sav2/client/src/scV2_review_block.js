// scV2_onButtonReviewClick - Stock Count form, onClick of button_review: the live onButtonReviewClick (below, unchanged)
// with ONE inserted line after its confirmations (rollback = bind the button back to onButtonReviewClick).
// SC Review V2: a review that builds a Stock Adjustment (STOCK_COUNT code_review_prep: approved lines, the adjustment
// confirmed, an approved line with a variance) of more than __SC_V2_MIN_LINES__ approved variance lines goes to SA_V2_SUBMIT
// (source REVIEW). Everything else - the switch off, a workflow id not set, <= __SC_V2_MIN_LINES__ lines, a serialized line,
// a NOT_ELIGIBLE or INVALID answer, any error before SUBMIT is called - goes on with the classic review below, unchanged.
const SCR_WF = {
  SUBMIT: "__SA_V2_SUBMIT__", // SA_V2_SUBMIT
  WORKER: "__SA_V2_WORKER__", // SA_V2_WORKER
};
// Switch: false = every review runs the classic path and nothing else
const ASYNC_SC_REVIEW_ENABLED = __ASYNC_SC_REVIEW_ENABLED__;
const SC_V2_MIN_LINES = __SC_V2_MIN_LINES__;
const SC_V2_ON =
  ASYNC_SC_REVIEW_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SCR_WF.SUBMIT) && /^[1-9][0-9]{0,19}$/.test(SCR_WF.WORKER);
const SCR_POLL_MS = 2500;
const SCR_KICK_MS = 15000;
const SCR_WAIT_MS = 180000;
const SCR_KICK_MAX = 10;
const SCR_RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA"];
const SCR_TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];
// not record fields: helper models, the stock-selection dialog, badges, buttons, layout widgets (none read by STOCK_COUNT)
const SCR_NOT_RECORD = ["_data", "$_v", "_vts", "isTrusted", "error_message", "dialog_select_stock", "storage_location",
  "storage_location_id", "location", "item_balance", "batch_balance", "item_item_balance", "item_batch_balance", "selectedRowIndex",
  "draft_status", "issued_status", "processing_status", "completed_status", "cancelled_status", "to_be_reviewed_status",
  "in_review_status", "recount_status", "button_select_stock", "button_sync", "button_approve_all", "button_draft", "button_issued",
  "button_count", "button_review", "log_button"];

const scrS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const scrDigits = (v) => /^[0-9]{1,20}$/.test(scrS(v));
const scrLinked = (v) => /^[1-9][0-9]{0,19}$/.test(scrS(v));
const scrSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scrData = () => this.models["_data"] || {};
const scrStore = (patch) => {
  this.models["_data"] = { ...this.models["_data"], ...patch };
};
const scrRelease = () => {
  scrStore({ scr_submitting: 0 });
  this.hideLoading();
};
const scrClose = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};
const scrRefresh = () => {
  if (this.parentGenerateForm) this.parentGenerateForm.refresh();
};
const scrRun = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
  });
// an alert closed with its X rejects: it was still read
const scrAlert = (message, title, type) =>
  this.$alert(message, title || "", { confirmButtonText: "OK", type: type, dangerouslyUseHTMLString: false }).catch(() => {});
const scrMarkSeen = (jobId) => {
  try {
    localStorage.setItem("sa_v2_failed_seen_" + scrS(jobId), "1");
  } catch (e) {}
};
const scrCanon = (v) => {
  if (Array.isArray(v)) return "[" + v.map(scrCanon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + scrCanon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
};
const scrHash = (text) => {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  const hex = (x) => ("00000000" + x.toString(16)).slice(-8);
  return hex(h1) + hex(h2);
};
// the organization the classic review sends (its getOrgId)
const scrOrg = () => {
  let o = this.getVarGlobal("deptParentId");
  if (o === "0") o = this.getVarSystem("deptIds").split(",")[0];
  return scrS(o);
};
// one key per click and content (CONTRACT section 3); after an answer that leaves it open whether anything was written (no
// answer, STOP 500) the next click re-uses the key whatever the content; a FAILED job gets the next generation
const scrKey = (ctx) => {
  const pinned = scrS(scrData().scr_pinned);
  if (pinned) return pinned;
  const hash = scrHash(scrCanon({ createAdjustment: ctx.createAdjustment, record: ctx.record }));
  return ("SCR:" + ctx.org + ":" + ctx.scId + ":" + hash + ":" + ctx.gen).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
};
const scrPin = (ctx, on) => scrStore({ scr_pinned: on ? ctx.key : "" });
// CONTRACT section 7: every request key is sent (strings except form)
const scrRequest = (ctx, operation, saId) => ({
  operation: operation,
  source: "REVIEW",
  saveAs: "Completed",
  pageStatus: ctx.page,
  sa_id: scrS(saId),
  sc_id: ctx.scId,
  idempotency_key: ctx.key,
  form: operation === "STATUS" ? {} : ctx.record,
  organization_id: ctx.org,
  nickname: operation === "STATUS" ? "" : ctx.nickname,
  adjustment_date: operation === "STATUS" ? "" : ctx.adjustmentDate,
  create_adjustment: operation === "STATUS" ? "" : ctx.createAdjustment,
});
const scrStatusOf = (w, jobId) => {
  if (!w) return "";
  if (scrS(w.job_id) === scrS(jobId)) return scrS(w.job_status);
  let jobs = [];
  try {
    jobs = Array.isArray(w.jobs) ? w.jobs : JSON.parse(scrS(w.jobs) || "[]");
  } catch (e) {}
  const mine = (Array.isArray(jobs) ? jobs : []).find((j) => j && scrS(j.job_id) === scrS(jobId));
  return mine ? scrS(mine.job_status) : "";
};
const scrKick = (jobId) => {
  try {
    this.runWorkflow(SCR_WF.WORKER, { job_id: scrS(jobId) }, () => {}, (e) => console.error("Stock Count V2: worker start failed", e));
  } catch (e) {
    console.error("Stock Count V2: worker could not be started", e);
  }
};
// after the stock moved: the worker finishes the job (at most SCR_KICK_MAX calls); the form is closed by then
const scrKickLoop = async (jobId, name) => {
  for (let n = 1; n <= SCR_KICK_MAX; n++) {
    let w = null;
    try {
      const res = await scrRun(SCR_WF.WORKER, { job_id: scrS(jobId) });
      w = (res && res.data) || null;
    } catch (e) {
      console.error("Stock Count V2: worker call failed - the list starts it again", e);
    }
    const st = scrStatusOf(w, jobId);
    if (SCR_TERMINAL.indexOf(st) >= 0) {
      scrRefresh();
      if (st === "COMPLETED") return;
      scrMarkSeen(jobId);
      await scrAlert("It stopped half-way and is under review: please contact support. " + scrS(w && w.result_message), name + " needs a review", "warning");
      return;
    }
    if (Number((w && w.processed) || 0) > 0) scrRefresh();
    else await scrSleep(3000);
  }
};
// wait for the verdict: a terminal job, or the stock moved (COMMITTING_SA at 80 %)
const scrFollow = async (ctx, q) => {
  const job = { jobId: scrS(q.job_id), saId: scrLinked(q.sa_id) ? scrS(q.sa_id) : "0", saNo: scrS(q.sa_no) };
  const nameOf = () => ("Stock Adjustment " + job.saNo).trim();
  this.showLoading("Saving Review...");
  scrKick(job.jobId);
  let kickedAt = Date.now();
  const deadline = Date.now() + SCR_WAIT_MS;
  while (Date.now() < deadline) {
    await scrSleep(SCR_POLL_MS);
    if (Date.now() - kickedAt >= SCR_KICK_MS) {
      kickedAt = Date.now();
      scrKick(job.jobId);
    }
    let st = null;
    try {
      const res = await scrRun(SCR_WF.SUBMIT, scrRequest(ctx, "STATUS", job.saId));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Stock Count V2: status check failed - trying again", e);
    }
    if (st && (scrS(st.job_status) === "NONE" || (scrS(st.terminal) === "YES" && !scrS(st.job_id)))) {
      scrRelease();
      this.$message.warning("The review is not being processed in the background any more. Open the Stock Count again to see its current state.");
      scrClose();
      return;
    }
    if (!st || scrS(st.job_id) !== job.jobId) continue;
    if (scrLinked(st.sa_id)) job.saId = scrS(st.sa_id);
    if (scrS(st.sa_no)) job.saNo = scrS(st.sa_no);
    const js = scrS(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // no stock moved and the Stock Count was not touched: the form and its review stay; the next click is a new job
      scrRelease();
      scrStore({ scr_gen: ctx.gen + 1 });
      scrMarkSeen(job.jobId);
      await scrAlert(scrS(st.error_message) || scrS(st.error_code) || "The review could not be completed.", "The review was not saved", "error");
      return;
    }
    if (js === "REQUIRES_REVIEW") {
      scrRelease();
      scrMarkSeen(job.jobId);
      await scrAlert("It stopped half-way and is under review: please contact support. " + scrS(st.error_message), nameOf() + " needs a review", "warning");
      scrClose();
      return;
    }
    if (js === "COMPLETED" || (js === "COMMITTING_SA" && Number(st.progress_percent) >= 80)) {
      scrRelease();
      scrStore({ scr_gen: 1 });
      this.$message.success(
        js === "COMPLETED"
          ? "Review saved. " + nameOf() + " completed."
          : "Review saved. " + nameOf() + ": the stock has been adjusted; the Stock Count is updated in the background.",
      );
      scrClose();
      if (js !== "COMPLETED") scrKickLoop(job.jobId, nameOf());
      return;
    }
  }
  scrRelease();
  this.$message.info("The review is still being processed in the background.");
  scrClose();
};
// true: the click was handled here (the classic review must not run); false: go on with the classic review
const scrSubmit = async (ctx) => {
  this.showLoading("Saving Review...");
  const params = scrRequest(ctx, "SUBMIT", "");
  let res = null;
  try {
    res = await scrRun(SCR_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("Stock Count V2: submit failed, repeating once with the same key", e);
    try {
      res = await scrRun(SCR_WF.SUBMIT, params);
    } catch (again) {
      console.error("Stock Count V2: submit failed twice", again);
    }
  }
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    scrRelease();
    scrPin(ctx, true);
    this.$message.error("No response from workflow. Please try again - the same review is sent again.");
    return true;
  }
  const message = scrS(r.message);
  const st = scrS(r.job_status);
  if (r.route === "STOP" && scrS(r.code) === "500") {
    scrRelease();
    scrPin(ctx, true);
    this.$message.error(message || "The review could not be queued: please try again.");
    return true;
  }
  scrPin(ctx, false);
  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") {
    console.log("Stock Count V2: the classic review -", r.route + ": " + (scrS(r.reason) || message));
    scrRelease();
    return false;
  }
  if (r.route === "STATUS" && (st === "NONE" || !scrS(r.job_id))) {
    scrRelease();
    this.$message.warning(message || "No background review was found for this Stock Count. Please try again.");
    return true;
  }
  if (r.route === "QUEUED" || (r.route === "STATUS" && SCR_RUNNING.indexOf(st) >= 0)) {
    await scrFollow(ctx, r);
    return true;
  }
  if (r.route === "STATUS" && st === "COMPLETED") {
    scrRelease();
    this.$message.success("Review saved. " + ("Stock Adjustment " + scrS(r.sa_no)).trim() + " is already completed.");
    scrClose();
    return true;
  }
  if (r.route === "STATUS" && (st === "FAILED" || st === "CANCELLED" || st === "REQUIRES_REVIEW")) {
    // the same review failed before: tell why; the next click tries again with a new key
    scrRelease();
    if (st !== "REQUIRES_REVIEW") scrStore({ scr_gen: ctx.gen + 1 });
    scrMarkSeen(r.job_id);
    await scrAlert(scrS(r.error_message) || scrS(r.progress_message) || "The previous review of this Stock Count did not finish.", "The review was not saved",
      st === "REQUIRES_REVIEW" ? "warning" : "error");
    return true;
  }
  scrRelease();
  if (r.route === "BUSY" || r.route === "STALE") {
    this.$message.warning(message || "A Stock Adjustment from this Stock Count is being processed in the background - please wait for it to finish.");
    return true;
  }
  this.$message.error(message || "Failed to save Review. Please contact support.");
  return true;
};
// the inserted branch: called after the classic confirmations with the classic's own values (never changed here)
const scReviewV2 = async (data, items, allApproved, approved, createAdjustment) => {
  let submitting = false;
  try {
    if (scrData().scr_submitting === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return true;
    }
    const page = scrS(data.page_status) || "Edit";
    if (page !== "Edit" || !scrDigits(data.id)) return false;
    // STOCK_COUNT code_review_prep: doProcess, and an approved line with a variance (strict, on the form's values)
    const doProcess = approved.length > 0 && (allApproved || createAdjustment === "Yes");
    const withVariance = approved.filter((i) => i.variance_qty !== 0 && i.line_status === "Approved");
    if (!doProcess || withVariance.length === 0) return false;
    if (withVariance.some((i) => i.is_serialized === 1 || scrS(i.is_serialized) === "1")) return false;
    if (withVariance.length <= SC_V2_MIN_LINES) return false;
    const record = { ...data };
    SCR_NOT_RECORD.forEach((k) => delete record[k]);
    Object.keys(record).forEach((k) => {
      if (k.indexOf("dialog_") === 0) delete record[k];
    });
    const ctx = {
      scId: scrS(data.id),
      page: page,
      record: record,
      createAdjustment: createAdjustment,
      org: scrOrg(),
      nickname: scrS(this.getVarGlobal("nickname")),
      adjustmentDate: new Date().toISOString().split("T")[0],
      gen: Number(scrData().scr_gen) || 1,
    };
    ctx.key = scrKey(ctx);
    scrStore({ scr_submitting: 1 });
    submitting = true;
    return await scrSubmit(ctx);
  } catch (error) {
    if (!submitting) {
      console.error("Stock Count V2: error before SUBMIT - the classic review", error);
      return false;
    }
    scrRelease();
    console.error("Stock Count V2 error:", error);
    this.$message.error(error.message || "Failed to save Review");
    return true;
  }
};

