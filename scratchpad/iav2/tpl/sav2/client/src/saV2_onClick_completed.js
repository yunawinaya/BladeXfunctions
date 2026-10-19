// __HANDLER_NAME__ - Stock Adjustment form, onClick of __BUTTON_MODEL__. One source for the Completed and the
// Completed & Post buttons; each knows its classic handler as a constant (rollback = bind the button back to it).
// SA V2: a completion of more than __SA_V2_MIN_ENTRIES__ stock entries (balance entries with sa_quantity > 0) without a
// serialized line goes to SA_V2_SUBMIT. Everything else - the switch off, a workflow id not set, a View page, a stored
// status other than Draft, <= __SA_V2_MIN_ENTRIES__ entries, a serialized line, a NOT_ELIGIBLE or INVALID answer, any error
// before SUBMIT is called - runs the classic handler through triggerEvent, unchanged.
const SA_WF = {
  SUBMIT: "__SA_V2_SUBMIT__", // SA_V2_SUBMIT
  WORKER: "__SA_V2_WORKER__", // SA_V2_WORKER
};
// Switch: false = every click runs the classic handler and nothing else
const ASYNC_SA_ENABLED = __ASYNC_SA_ENABLED__;
const SA_V2_MIN_ENTRIES = __SA_V2_MIN_ENTRIES__;
// the classic handler this button ran before
const SA_CLASSIC = "__CLASSIC__";
const SA_POLL_MS = 2500;
const SA_KICK_MS = 15000;
const SA_WAIT_MS = 180000;
const SA_LINK_POLL_MS = 3000;
const SA_LINK_WAIT_MS = 90000;
const SA_KICK_MAX = 10;
const SA_RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA"];
const SA_TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];
// not record fields: the job's own fields, helper models, the item-balance dialog, badges, buttons, layout widgets
const SA_NOT_RECORD = ["sa_v2_job_id", "sa_idem_key", "_data", "$_v", "_vts", "isTrusted", "error_message", "previous_material_uom",
  "sa_batch_no_map", "sa_item_balance", "table_item_balance", "table_item_balance_raw", "search_batch", "material_uom",
  "current_table_uom", "row_index", "is_serialized", "draft_status", "completed_status", "fullyposted_status", "processing_status",
  "cancel_status", "button_save_as_draft", "button_completed", "button_completed_posted", "button_posted", "confirm_search",
  "reset_search", "flex_tp9swgvv", "flex_shjmh0gq", "flex_palvd55h", "stock_adjustment_tittle"];

const saOn = () => ASYNC_SA_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SA_WF.SUBMIT) && /^[1-9][0-9]{0,19}$/.test(SA_WF.WORKER);

const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
// a job's Stock Adjustment: SUBMIT answers "" (or "0") until the job is linked to the adjustment it saved
const linked = (v) => /^[1-9][0-9]{0,19}$/.test(s(v));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const data_ = () => this.models["_data"] || {};
const store = (patch) => {
  this.models["_data"] = { ...this.models["_data"], ...patch };
};

const release = () => {
  store({ sa_submitting: 0 });
  this.hideLoading();
};

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const refreshList = () => {
  if (this.parentGenerateForm) this.parentGenerateForm.refresh();
};

const run = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
  });

// an alert closed with its X rejects: it was still read
const alertBox = (message, title, type) =>
  this.$alert(message, title || "", { confirmButtonText: "OK", type: type, dangerouslyUseHTMLString: false }).catch(() => {});

const markSeen = (jobId) => {
  try {
    localStorage.setItem("sa_v2_failed_seen_" + s(jobId), "1");
  } catch (e) {}
};

// the classic handler, exactly as the button ran it before (once per click)
let handedOver = false;
let touched = false;
const classic = async (why) => {
  if (handedOver) return;
  handedOver = true;
  console.log("Stock Adjustment V2: classic handler -", why);
  if (touched) release();
  try {
    await this.triggerEvent(SA_CLASSIC);
  } catch (e) {
    console.error("Stock Adjustment V2: classic handler failed", e);
  }
};

const listOf = (v) => {
  if (Array.isArray(v)) return v;
  const t = s(v);
  if (!t) return [];
  try {
    const p = JSON.parse(t);
    return Array.isArray(p) ? p : null;
  } catch (e) {
    return null;
  }
};
const isSerialized = (line) => line.is_serialized_item === 1 || line.is_serialized_item === true || s(line.is_serialized_item) === "1";

// the action of this click (CONTRACT sections 2 and 12), or why it stays with the classic handler
const routeOf = (v) => {
  const page = s(v.page_status);
  const isNew = page === "Add" || page === "Clone" || page === "Copy";
  if (!isNew && page !== "Edit") return { why: "page " + (page || "unknown") };
  if (!isNew && !digits(v.id)) return { why: "no document id" };
  if (!isNew && s(v.stock_adjustment_status) !== "Draft") return { why: "stored " + (s(v.stock_adjustment_status) || "no status") };
  const lines = Array.isArray(v.stock_adjustment) ? v.stock_adjustment : [];
  let entries = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || {};
    if (isSerialized(line)) return { why: "serialized line " + (i + 1) };
    const list = listOf(line.balance_index);
    if (list === null) return { why: "unreadable balance_index on line " + (i + 1) };
    for (const e of list) {
      if (e && s(e.serial_number) !== "") return { why: "serial numbers on line " + (i + 1) };
      if (e && parseFloat(e.sa_quantity) > 0) entries++;
    }
  }
  if (entries <= SA_V2_MIN_ENTRIES) return { why: entries + " entries" };
  return { isNew: isNew, page: page, entries: entries };
};

const canon = (v) => {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
};
const hash16 = (text) => {
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

const orgOf = (record) => {
  const own = s(record.organization_id);
  if (own) return own;
  let org = this.getVarGlobal("deptParentId");
  if (org === "0") org = this.getVarSystem("deptIds").split(",")[0];
  return s(org);
};

// one key per click and content: a lost answer re-sent with the same key finds the same job; new content or a FAILED job gets
// the next generation (a new key, a new job). After an answer that leaves it open whether anything was written (no answer,
// STOP 500), or while a new adjustment's job is not linked yet, the next click re-uses the key whatever the content - on a
// new adjustment whichever of the two buttons is clicked (only the key's own job can save it).
const pinSlot = (ctx) => (ctx.isNew ? "sa_pinned_new" : "sa_pinned_edit");
const idemKey = (ctx) => {
  const pinned = s(data_()[pinSlot(ctx)]);
  if (pinned) return pinned;
  let token = s(data_().sa_page_token);
  if (!token) {
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store({ sa_page_token: token });
  }
  const doc = ctx.isNew ? "new-" + token : s(ctx.record.id);
  const hash = hash16(canon({ saveAs: "Completed", pageStatus: ctx.page, record: ctx.record }));
  return ("SA:" + ctx.org + ":" + doc + ":" + hash + ":" + ctx.gen).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
};
const pin = (ctx, on) => store({ [pinSlot(ctx)]: on ? ctx.key : "" });
// a new adjustment that SUBMIT may have saved: Save as Draft would add a second one (the Completed buttons re-send the key)
const keepKey = (ctx) => {
  pin(ctx, true);
  if (ctx.isNew) this.hide(["button_save_as_draft"]);
};

// CONTRACT section 7: every request key is sent (strings except form)
const request = (ctx, operation, saId) => ({
  operation: operation,
  source: "FORM",
  saveAs: "Completed",
  pageStatus: operation === "STATUS" ? "Edit" : ctx.page,
  sa_id: s(saId),
  sc_id: "",
  idempotency_key: ctx.key,
  form: operation === "STATUS" ? {} : ctx.record,
  organization_id: ctx.org,
  nickname: "",
  adjustment_date: "",
  create_adjustment: "",
});

const nameOf = (ctx, r) => ("Stock Adjustment " + (s(r && r.sa_no) || s(ctx.record.adjustment_no))).trim();

const statusOf = (w, jobId) => {
  if (!w) return "";
  if (s(w.job_id) === s(jobId)) return s(w.job_status);
  const jobs = listOf(w.jobs) || [];
  const mine = jobs.find((j) => j && s(j.job_id) === s(jobId));
  return mine ? s(mine.job_status) : "";
};

const kick = (jobId) => {
  try {
    this.runWorkflow(SA_WF.WORKER, { job_id: s(jobId) }, () => {}, (e) => console.error("Stock Adjustment V2: worker start failed", e));
  } catch (e) {
    console.error("Stock Adjustment V2: worker could not be started", e);
  }
};

// after the stock moved: the worker finishes the job (at most SA_KICK_MAX calls); the form is closed by then
const kickLoop = async (job, name) => {
  for (let n = 1; n <= SA_KICK_MAX; n++) {
    let w = null;
    try {
      const res = await run(SA_WF.WORKER, { job_id: s(job.jobId) });
      w = (res && res.data) || null;
    } catch (e) {
      console.error("Stock Adjustment V2: worker call failed - the list starts it again", e);
    }
    const st = statusOf(w, job.jobId);
    if (SA_TERMINAL.indexOf(st) >= 0) {
      refreshList();
      if (st === "COMPLETED") return;
      markSeen(job.jobId);
      await alertBox("It stopped half-way and is under review: please contact support. " + s(w && w.result_message), name + " needs a review", "warning");
      return;
    }
    if (Number((w && w.processed) || 0) > 0) refreshList();
    else await sleep(3000);
  }
};

const finish = (job, name, text, moving) => {
  release();
  store({ sa_page_token: null, sa_gen: 1 });
  this.$message.success(text);
  closeDialog();
  if (moving) kickLoop(job, name);
};

// wait for the verdict: a terminal job, or the stock moved (COMMITTING_SA at 80 %)
const follow = async (ctx, q) => {
  const name = nameOf(ctx, q);
  const job = { jobId: s(q.job_id), saId: linked(q.sa_id) ? s(q.sa_id) : s(ctx.record.id) };
  this.showLoading("Completing " + name + "...");
  kick(job.jobId);
  let kickedAt = Date.now();
  const deadline = Date.now() + SA_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(SA_POLL_MS);
    if (Date.now() - kickedAt >= SA_KICK_MS) {
      kickedAt = Date.now();
      kick(job.jobId);
    }
    let st = null;
    try {
      const res = await run(SA_WF.SUBMIT, request(ctx, "STATUS", job.saId));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Stock Adjustment V2: status check failed - trying again", e);
    }
    if (st && (s(st.job_status) === "NONE" || (s(st.terminal) === "YES" && !s(st.job_id)))) {
      // no job any more: the form is out of date - close it so the adjustment is opened again from the list
      release();
      this.$message.warning(name + " is not being completed in the background any more. Open it again to see its current state.");
      closeDialog();
      return;
    }
    if (!st || s(st.job_id) !== job.jobId) continue;
    const js = s(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // nothing moved and the adjustment is a Draft again: an edit keeps the form and its content; the next click is a new job
      release();
      store({ sa_gen: ctx.gen + 1 });
      markSeen(job.jobId);
      await alertBox(s(st.error_message) || s(st.error_code) || "The Stock Adjustment could not be completed.", name + " was not completed", "error");
      // a new adjustment that failed is a saved Draft now: never stay in Add mode (a second click would save a second one)
      if (ctx.isNew) closeDialog();
      return;
    }
    if (js === "COMPLETED") return finish(job, name, name + " completed.", false);
    if (js === "REQUIRES_REVIEW") {
      release();
      markSeen(job.jobId);
      await alertBox("It stopped half-way and is under review: please contact support. " + s(st.error_message), name + " needs a review", "warning");
      closeDialog();
      return;
    }
    if (js === "COMMITTING_SA" && Number(st.progress_percent) >= 80) {
      return finish(job, name, name + ": the stock has been adjusted; it is being finished in the background.", true);
    }
  }
  release();
  this.$message.info(name + " is still being completed in the background.");
  closeDialog();
};

// a new adjustment's job answered before SUBMIT linked it to its adjustment (a same-key retry or a double click while the
// first SUBMIT still runs): the form stays and keeps the SAME key; STATUS of that key until the job shows its adjustment
const awaitLink = async (ctx, q) => {
  keepKey(ctx);
  this.showLoading("Saving Stock Adjustment as Completed...");
  const deadline = Date.now() + SA_LINK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(SA_LINK_POLL_MS);
    let st = null;
    try {
      const res = await run(SA_WF.SUBMIT, request(ctx, "STATUS", "0"));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Stock Adjustment V2: status check failed - trying again", e);
    }
    if (!st || s(st.route) !== "STATUS") continue;
    const js = s(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // the job ended without completing: tell why; the next click is a new job (a new key)
      pin(ctx, false);
      release();
      store({ sa_gen: ctx.gen + 1 });
      markSeen(st.job_id);
      await alertBox(s(st.error_message) || s(st.progress_message) || "The completion did not finish.", "Stock Adjustment was not completed", "error");
      // a failed new adjustment that was linked is a saved Draft now: never stay in Add mode
      if (linked(st.sa_id)) closeDialog();
      return;
    }
    if (linked(st.sa_id) && (SA_RUNNING.indexOf(js) >= 0 || js === "COMPLETED" || js === "REQUIRES_REVIEW")) {
      pin(ctx, false);
      return queued(ctx, { ...q, ...st });
    }
    // no job of this key (NONE), or under review before it was linked: stop asking; the key stays for the next click
    if (js === "NONE" || js === "REQUIRES_REVIEW" || (s(st.terminal) === "YES" && !s(st.job_id))) break;
  }
  release();
  this.$message.warning("The completion is still being prepared - check the Stock Adjustment list before saving again.");
};

const queued = (ctx, r) => {
  if (ctx.isNew && !linked(r.sa_id)) return awaitLink(ctx, r);
  return follow(ctx, r);
};

const submit = async (ctx) => {
  this.showLoading("Saving Stock Adjustment as Completed...");
  const params = request(ctx, "SUBMIT", ctx.isNew ? "" : ctx.record.id);
  let res = null;
  try {
    res = await run(SA_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("Stock Adjustment V2: submit failed, repeating once with the same key", e);
    try {
      res = await run(SA_WF.SUBMIT, params);
    } catch (again) {
      console.error("Stock Adjustment V2: submit failed twice", again);
    }
  }
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    release();
    keepKey(ctx);
    this.$message.error("No response from workflow. Please try again - the same completion is sent again.");
    return;
  }
  const message = s(r.message);
  const st = s(r.job_status);
  if (r.route === "STOP" && s(r.code) === "500") {
    release();
    keepKey(ctx);
    this.$message.error(message || "The completion could not be queued: please try again.");
    return;
  }
  pin(ctx, false);
  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") return classic(r.route + ": " + (s(r.reason) || message));
  if (r.route === "STATUS" && (st === "NONE" || !s(r.job_id))) {
    release();
    this.$message.warning(message || "No background completion was found for this Stock Adjustment. Please try again.");
    return;
  }
  if (r.route === "QUEUED" || (r.route === "STATUS" && SA_RUNNING.indexOf(st) >= 0)) return queued(ctx, r);
  if (r.route === "STATUS" && st === "COMPLETED") {
    release();
    this.$message.success(nameOf(ctx, r) + " is already completed.");
    closeDialog();
    return;
  }
  if (r.route === "STATUS" && (st === "FAILED" || st === "CANCELLED" || st === "REQUIRES_REVIEW")) {
    // the same content failed before: tell why; the next click tries again with a new key (a new adjustment's job under review
    // before it was linked keeps its key: only that job can save it)
    release();
    if (st !== "REQUIRES_REVIEW") store({ sa_gen: ctx.gen + 1 });
    else if (ctx.isNew && !linked(r.sa_id)) keepKey(ctx);
    markSeen(r.job_id);
    await alertBox(s(r.error_message) || s(r.progress_message) || "The previous completion of this Stock Adjustment did not finish.", nameOf(ctx, r),
      st === "REQUIRES_REVIEW" ? "warning" : "error");
    // a failed new adjustment is a saved Draft now: never stay in Add mode
    if (ctx.isNew && linked(r.sa_id)) closeDialog();
    return;
  }
  release();
  if (r.route === "BUSY" || r.route === "STALE") {
    this.$message.warning(message || "This Stock Adjustment is being processed - please wait for it to finish.");
    return;
  }
  this.$message.error(message || "Failed to save Stock Adjustment");
};

(async () => {
  // switched off (or a workflow id not set): the classic handler and nothing else
  if (!saOn()) return classic("switched off (ASYNC_SA_ENABLED)");
  let submitting = false;
  try {
    const d = data_();
    if (d.sa_submitting === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    // a classic save running or failed on this form: the classic handler answers as before
    if (d.is_processing === 1 || d.is_error === 1) return classic("classic save state");
    const values = this.getValues();
    const route = routeOf(values);
    if (route.why) return classic(route.why);
    const record = { ...values };
    SA_NOT_RECORD.forEach((k) => delete record[k]);
    Object.keys(record).forEach((k) => {
      if (k.indexOf("dialog_") === 0) delete record[k];
    });
    const ctx = { isNew: route.isNew, page: route.page, record: record, org: orgOf(record), gen: Number(data_().sa_gen) || 1 };
    ctx.key = idemKey(ctx);
    touched = true;
    store({ sa_submitting: 1 });
    submitting = true;
    await submit(ctx);
  } catch (error) {
    if (!submitting) {
      console.error("Stock Adjustment V2: error before SUBMIT - classic handler", error);
      await classic("error before SUBMIT");
      return;
    }
    release();
    console.error("Stock Adjustment V2 error:", error);
    this.$message.error(error.message || "Failed to save Stock Adjustment");
  }
})();
