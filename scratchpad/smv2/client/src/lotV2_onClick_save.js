// __HANDLER_NAME__ - Location Transfer form, onClick of __BUTTON_MODEL__ (Save as __SAVE_AS__). The build makes one handler per
// save button from one source; each knows its own button and classic handler as constants.
// Stock Movement V2: a save of more than 50 stock lines whose action is switched on goes to LOT_V2_SUBMIT. Everything else
// (switch off, <= 50 lines, handling units / bundles, a NOT_ELIGIBLE or INVALID answer, any error before SUBMIT is called)
// runs the button's classic handler through triggerEvent, unchanged.
const LOT_WF = {
  SUBMIT: "__LOT_V2_SUBMIT__", // LOT_V2_SUBMIT
  WORKER: "__LOT_V2_WORKER__", // LOT_V2_WORKER
};
// Switch: false = every click runs the classic save
const ASYNC_LOT_ENABLED = true;
// Per action, false = the classic save. DIRECT / STAGE / DRAFT: a new or Draft transfer saved as Completed / In Progress /
// Draft; COMPLETE (_EDITED: lines changed since the form opened): In Progress -> Completed; EDIT: In Progress -> In Progress.
// CANCEL is the list's (Cancel.js has its own switch).
const LOT_V2_ACTIONS = { DIRECT: true, STAGE: true, COMPLETE: true, CANCEL: true, EDIT: true, COMPLETE_EDITED: true, DRAFT: true };
const V2_MIN_LINES = 50;
const LOT_POLL_MS = 2500;
const LOT_KICK_MS = 15000;
const LOT_WAIT_MS = 180000;
const LOT_KICK_MAX = 10;
const LOT_LINK_POLL_MS = 3000;
const LOT_LINK_WAIT_MS = 90000;
const RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_LOT"];
const TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];
// this handler's button and the classic handler it ran before
const button = { saveAs: "__SAVE_AS__", classic: "__CLASSIC__" };
const SAVE_BUTTONS = ["button_save_as_draft", "button_inprogress", "button_completed"];
// not record fields: the job's own fields, helper models, dialogs, layout / badge widgets
const NOT_RECORD = ["lot_v2_job_id", "lot_idem_key", "_data", "$_v", "_vts", "isTrusted", "error_message", "previous_material_uom", "sm_item_balance",
  "dialog_apply_location", "dialog_serial_number", "draft_status", "processing_status", "lot_processing_status", "created_status", "completed_status",
  "cancel_status", "flex_2det1nd2", "flex_t6y2yh5r"].concat(SAVE_BUTTONS);

/*@@FINGERPRINT@@*/

const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
// a job's transfer: SUBMIT answers "" (or "0") until the job is linked to the transfer it saved
const linked = (v) => /^[1-9][0-9]{0,19}$/.test(s(v));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const data_ = () => this.models["_data"] || {};
const store = (patch) => {
  this.models["_data"] = { ...this.models["_data"], ...patch };
};

const release = () => {
  store({ lot_submitting: 0 });
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
    localStorage.setItem("lot_v2_failed_seen_" + s(jobId), "1");
  } catch (e) {}
};

// the classic save, exactly as the button ran it before (once per click)
let handedOver = false;
const classic = async (why) => {
  if (handedOver) return;
  handedOver = true;
  console.log("Location Transfer V2: classic save -", why);
  release();
  try {
    await this.triggerEvent(button.classic);
  } catch (e) {
    console.error("Location Transfer V2: classic save failed", e);
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
const isBundle = (r) => s(r.item_bundle_id) !== "" || s(r.parent_fm_key) !== "" || (Array.isArray(r.children) && r.children.length > 0);
const hasHU = (r) => {
  const hu = listOf(r.temp_hu_data);
  if (hu === null || hu.length > 0) return true;
  const qty = listOf(r.temp_qty_data);
  return qty === null || qty.some((e) => e && s(e.handling_unit_id) !== "");
};

// the action of this click (CONTRACT section 2), or why it stays with the classic save
const routeOf = (v, saveAs) => {
  const page = s(v.page_status);
  const isNew = page === "Add" || page === "Clone" || page === "Copy";
  if (!isNew && page !== "Edit") return { why: "page " + page };
  if (!isNew && !digits(v.id)) return { why: "no document id" };
  const stored = isNew ? "Draft" : s(v.stock_movement_status);
  let action = "";
  if (stored === "Draft") action = { Draft: "DRAFT", "In Progress": "STAGE", Completed: "DIRECT" }[saveAs] || "";
  else if (stored === "In Progress") action = { "In Progress": "EDIT", Completed: "COMPLETE" }[saveAs] || "";
  if (!action) return { why: (stored || "no status") + " saved as " + saveAs };
  if (action === "COMPLETE" ? LOT_V2_ACTIONS.COMPLETE !== true && LOT_V2_ACTIONS.COMPLETE_EDITED !== true : LOT_V2_ACTIONS[action] !== true) {
    return { why: action + " switched off" };
  }
  const rows = Array.isArray(v.stock_movement) ? v.stock_movement : [];
  if (rows.some(isBundle)) return { why: "item bundles" };
  if (rows.some(hasHU)) return { why: "handling units" };
  if (rows.length <= V2_MIN_LINES) return { why: rows.length + " lines" };
  if (action === "COMPLETE") {
    const atOpen = s(data_().lot_mount_fp);
    if (!atOpen || atOpen !== lotLineFingerprint(rows)) action = "COMPLETE_EDITED";
    if (LOT_V2_ACTIONS[action] !== true) return { why: action + " switched off" };
  }
  return { action: action, isNew: isNew, page: page };
};

const canon = (v) => {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
};

// one key per click and content: a lost answer re-sent with the same key finds the same job; new content or a failed job
// gets the next generation (a new key, a new job). After an answer that leaves it open whether anything was written (no
// answer, STOP 500) or while a new transfer's job is not linked yet, the next click re-uses the key whatever the content -
// on a new transfer whichever button is clicked (only the key's own job can save it)
const pinSlot = (ctx) => (ctx.isNew ? "lot_pinned_new" : "lot_pinned_" + ctx.saveAs);
const idemKey = (ctx) => {
  const pinned = s(data_()[pinSlot(ctx)]);
  if (pinned) return pinned;
  let token = s(data_().lot_page_token);
  if (!token) {
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store({ lot_page_token: token });
  }
  const doc = ctx.isNew ? "new-" + token : s(ctx.record.id);
  const hash = lotFpHash(canon({ saveAs: ctx.saveAs, pageStatus: ctx.page, record: ctx.record }));
  return ("LOT:" + s(ctx.record.organization_id) + ":" + doc + ":" + hash + ":" + ctx.gen).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
};
const pin = (ctx, on) => store({ [pinSlot(ctx)]: on ? ctx.key : "" });

const statusParams = (lotId, key, saveAs) => ({ operation: "STATUS", saveAs: saveAs, pageStatus: "Edit", lot_id: s(lotId), idempotency_key: s(key), source: "FORM", form: {} });

const statusOf = (w, jobId) => {
  if (!w) return "";
  if (s(w.job_id) === s(jobId)) return s(w.job_status);
  const jobs = listOf(w.jobs) || [];
  const mine = jobs.find((j) => j && s(j.job_id) === s(jobId));
  return mine ? s(mine.job_status) : "";
};

// the worker moves the job: one call per tick until it ends (at most LOT_KICK_MAX calls); the form is closed by then
const kickLoop = async (job, name) => {
  for (let n = 1; n <= LOT_KICK_MAX; n++) {
    let w = null;
    try {
      const res = await run(LOT_WF.WORKER, { job_id: s(job.jobId) });
      w = (res && res.data) || null;
    } catch (e) {
      console.error("Location Transfer V2: worker call failed - the list starts it again", e);
    }
    const st = statusOf(w, job.jobId);
    if (TERMINAL.indexOf(st) >= 0) {
      refreshList();
      if (st === "COMPLETED") {
        this.$message.success(name + " saved.");
        return;
      }
      let reason = s(w.result_message);
      if (linked(job.lotId)) {
        try {
          const res = await run(LOT_WF.SUBMIT, statusParams(job.lotId, job.key, job.saveAs));
          const r = (res && res.data) || {};
          if (s(r.job_id) === s(job.jobId)) reason = s(r.error_message) || reason;
        } catch (e) {
          console.error("Location Transfer V2: status check failed", e);
        }
      }
      markSeen(job.jobId);
      if (st === "REQUIRES_REVIEW") await alertBox("It stopped half-way and is under review: please contact support. " + reason, name + " needs a review", "warning");
      else await alertBox((reason || "The background save failed.") + " It was not saved; reopen it to continue.", name + " was not saved", "error");
      return;
    }
    if (Number((w && w.processed) || 0) > 0) refreshList();
    else await sleep(3000);
  }
};

const kick = (jobId) => {
  try {
    this.runWorkflow(LOT_WF.WORKER, { job_id: s(jobId) }, () => {}, (e) => console.error("Location Transfer V2: worker start failed", e));
  } catch (e) {
    console.error("Location Transfer V2: worker could not be started", e);
  }
};

// COMPLETE / EDIT: wait for the verdict - a terminal job, or the stock moved (COMMITTING_LOT at 80 %)
const follow = async (ctx, q) => {
  const name = ("Location Transfer " + (s(q.lot_no) || s(ctx.record.stock_movement_no))).trim();
  const job = { jobId: s(q.job_id), lotId: s(ctx.record.id), key: ctx.key, saveAs: ctx.saveAs };
  this.showLoading("Checking " + name + "...");
  kick(job.jobId);
  let kickedAt = Date.now();
  const deadline = Date.now() + LOT_WAIT_MS;
  const finish = (text) => {
    release();
    this.$message.success(text);
    closeDialog();
    kickLoop(job, name);
  };
  while (Date.now() < deadline) {
    await sleep(LOT_POLL_MS);
    if (Date.now() - kickedAt >= LOT_KICK_MS) {
      kickedAt = Date.now();
      kick(job.jobId);
    }
    let st = null;
    try {
      const res = await run(LOT_WF.SUBMIT, statusParams(job.lotId, job.key, job.saveAs));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Location Transfer V2: status check failed - trying again", e);
    }
    if (st && (s(st.job_status) === "NONE" || (s(st.terminal) === "YES" && !s(st.job_id)))) {
      // no job any more: the form is out of date - close it so the transfer is opened again from the list
      release();
      this.$message.warning(name + " is not being saved in the background any more. Open it again to see its current state.");
      closeDialog();
      return;
    }
    if (!st || s(st.job_id) !== job.jobId) continue;
    const js = s(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // nothing moved and the transfer is In Progress again: the form and its edits stay; the next click is a new job
      release();
      store({ lot_gen: ctx.gen + 1 });
      markSeen(job.jobId);
      await alertBox(s(st.error_message) || s(st.error_code) || "The save could not be completed.", name + " was not saved", "error");
      return;
    }
    if (js === "COMPLETED") return finish(name + " saved.");
    if (js === "REQUIRES_REVIEW") {
      release();
      markSeen(job.jobId);
      await alertBox("It stopped half-way and is under review: please contact support. " + s(st.error_message), name + " needs a review", "warning");
      closeDialog();
      return;
    }
    if (js === "COMMITTING_LOT" && Number(st.progress_percent) >= 80) return finish(name + " is being saved in the background.");
  }
  release();
  this.$message.info(name + " is still being saved in the background.");
  closeDialog();
};

// a new transfer's job answered before SUBMIT linked it to its transfer (a same-key retry or a double click while the first
// SUBMIT still runs): the form stays and keeps the SAME key; STATUS of that key until the job shows its transfer
const awaitLink = async (ctx, q) => {
  pin(ctx, true);
  this.showLoading("Saving Location Transfer as " + ctx.saveAs + "...");
  const deadline = Date.now() + LOT_LINK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(LOT_LINK_POLL_MS);
    let st = null;
    try {
      const res = await run(LOT_WF.SUBMIT, statusParams("0", ctx.key, ctx.saveAs));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Location Transfer V2: status check failed - trying again", e);
    }
    if (!st || s(st.route) !== "STATUS") continue;
    const js = s(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // the job ended without saving: tell why; the next click is a new job (a new key)
      pin(ctx, false);
      release();
      store({ lot_gen: ctx.gen + 1 });
      markSeen(st.job_id);
      await alertBox(s(st.error_message) || s(st.progress_message) || "The save did not finish.", "Location Transfer was not saved", "error");
      // a failed new transfer that was linked is a saved Draft now: never stay in Add mode
      if (linked(st.lot_id)) closeDialog();
      return;
    }
    if (linked(st.lot_id) && (RUNNING.indexOf(js) >= 0 || js === "COMPLETED" || js === "REQUIRES_REVIEW")) {
      pin(ctx, false);
      return queued(ctx, { ...q, ...st });
    }
    // no job of this key (NONE), or under review before it was linked: stop asking; the key stays for the next click
    if (js === "NONE" || js === "REQUIRES_REVIEW" || (s(st.terminal) === "YES" && !s(st.job_id))) break;
  }
  release();
  this.$message.warning("The save is still being prepared - check the Location Transfer list before saving again.");
};

const queued = (ctx, r) => {
  const name = ("Location Transfer " + (s(r.lot_no) || s(ctx.record.stock_movement_no))).trim();
  if (ctx.action === "COMPLETE" || ctx.action === "COMPLETE_EDITED" || ctx.action === "EDIT") return follow(ctx, r);
  if (ctx.isNew && !linked(r.lot_id)) return awaitLink(ctx, r);
  // the lines were saved by SUBMIT: never stay on this form (a second click would save a second transfer)
  release();
  store({ lot_page_token: null, lot_gen: 1 });
  this.hide(SAVE_BUTTONS);
  this.$message.success(name + " is being saved in the background.");
  closeDialog();
  kickLoop({ jobId: s(r.job_id), lotId: linked(r.lot_id) ? s(r.lot_id) : s(ctx.record.id), key: ctx.key, saveAs: ctx.saveAs }, name);
};

const submit = async (ctx) => {
  this.showLoading("Saving Location Transfer as " + ctx.saveAs + "...");
  const params = { operation: "SUBMIT", saveAs: ctx.saveAs, pageStatus: ctx.page, lot_id: ctx.isNew ? "" : s(ctx.record.id), idempotency_key: ctx.key, source: "FORM", form: ctx.record };
  let res = null;
  try {
    res = await run(LOT_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("Location Transfer V2: submit failed, repeating once with the same key", e);
    try {
      res = await run(LOT_WF.SUBMIT, params);
    } catch (again) {
      console.error("Location Transfer V2: submit failed twice", again);
    }
  }
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    release();
    pin(ctx, true);
    this.$message.error("No response from workflow. Please try again - the same save is sent again.");
    return;
  }
  const message = s(r.message);
  const st = s(r.job_status);
  if (r.route === "STOP" && s(r.code) === "500") {
    release();
    pin(ctx, true);
    this.$message.error(message || "The save could not be queued: please try again.");
    return;
  }
  pin(ctx, false);
  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") return classic(r.route + ": " + (s(r.reason) || message));
  if (r.route === "SAVED") {
    release();
    store({ lot_page_token: null, lot_gen: 1 });
    this.$message.success(message || ("Location Transfer " + s(r.lot_no) + " saved as Draft.").replace("  ", " "));
    closeDialog();
    return;
  }
  if (r.route === "STATUS" && (st === "NONE" || !s(r.job_id))) {
    release();
    this.$message.warning(message || "No background save was found for this transfer. Please try again.");
    return;
  }
  if (r.route === "QUEUED" || (r.route === "STATUS" && RUNNING.indexOf(st) >= 0)) return queued(ctx, r);
  if (r.route === "STATUS" && st === "COMPLETED") {
    release();
    this.$message.success(("Location Transfer " + s(r.lot_no)).trim() + " is already saved.");
    closeDialog();
    return;
  }
  if (r.route === "STATUS" && (st === "FAILED" || st === "CANCELLED" || st === "REQUIRES_REVIEW")) {
    // the same content failed before: tell why; the next click tries again with a new key
    release();
    if (st !== "REQUIRES_REVIEW") store({ lot_gen: ctx.gen + 1 });
    markSeen(r.job_id);
    await alertBox(s(r.error_message) || s(r.progress_message) || "The previous save of this transfer did not finish.", ("Location Transfer " + s(r.lot_no)).trim(),
      st === "REQUIRES_REVIEW" ? "warning" : "error");
    // a failed new transfer is a saved Draft now: never stay in Add mode
    if (ctx.isNew && linked(r.lot_id)) closeDialog();
    return;
  }
  release();
  if (r.route === "BUSY" || r.route === "STALE") {
    this.$message.warning(message || "This Location Transfer is being processed - please wait for it to finish.");
    return;
  }
  this.$message.error(message || "Failed to save Location Transfer");
};

(async () => {
  let submitting = false;
  try {
    if (data_().lot_submitting === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    if (ASYNC_LOT_ENABLED !== true || !digits(LOT_WF.SUBMIT) || !digits(LOT_WF.WORKER) || LOT_WF.SUBMIT === "0" || LOT_WF.WORKER === "0") {
      return classic("switched off (ASYNC_LOT_ENABLED)");
    }
    const values = this.getValues();
    const route = routeOf(values, button.saveAs);
    if (!route.action) return classic(route.why);
    const record = { ...values };
    NOT_RECORD.forEach((k) => delete record[k]);
    const ctx = { action: route.action, isNew: route.isNew, page: route.page, saveAs: button.saveAs, record: record, gen: Number(data_().lot_gen) || 1 };
    ctx.key = idemKey(ctx);
    store({ lot_submitting: 1 });
    submitting = true;
    await submit(ctx);
  } catch (error) {
    if (!submitting) {
      console.error("Location Transfer V2: error before SUBMIT - classic save", error);
      await classic("error before SUBMIT");
      return;
    }
    release();
    console.error("Location Transfer V2 error:", error);
    this.$message.error(error.message || "Failed to save Location Transfer");
  }
})();
