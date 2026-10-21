// __HANDLER_NAME__ - Item Disassembly form, onClick of __BUTTON_MODEL__ (one source for Completed and Complete & Post).
// IDA V2 (CONTRACT section 12): more than IDA_V2_MIN_MOVES moves, no handling unit, no serial pick -> IDA_V2_SUBMIT; anything
// else, a NOT_ELIGIBLE / INVALID answer or an error before SUBMIT -> the classic handler through triggerEvent, once.
const IDA_WF = {
  SUBMIT: "__IDA_V2_SUBMIT__", // IDA_V2_SUBMIT
  WORKER: "__IDA_V2_WORKER__", // IDA_V2_WORKER
};
const ASYNC_IDA_ENABLED = __ASYNC_IDA_ENABLED__;
// with COMPLETE_POST off, a big Complete & Post completes in the background (COMPLETE on) and is posted from the list
const IDA_V2_ACTIONS = { COMPLETE: __IDA_V2_COMPLETE__, COMPLETE_POST: __IDA_V2_COMPLETE_POST__ };
// rollback = bind the button back to this classic handler
const IDA_CLASSIC = "__CLASSIC__";
const IDA_BUTTON_POSTS = __BUTTON_POSTS__;
const IDA_POLL_MS = 2500;
const IDA_KICK_MS = 15000;
const IDA_WAIT_MS = 420000;
const IDA_LINK_POLL_MS = 3000;
const IDA_LINK_WAIT_MS = 90000;
const IDA_KICK_MAX = 10;
const IDA_RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"];
const IDA_TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];
// not record fields (every dialog_* key too): the job's fields, the stock dialog, buttons, badges, layout, platform keys
const IDA_NOT_RECORD = ["ida_v2_job_id", "ida_idem_key", "_data", "$_v", "_vts", "isTrusted", "sm_item_balance", "button_draft",
  "button_completed", "comp_post_button", "button_post", "button_kdsxzl2q", "draft_status", "issued_status", "completed_status",
  "fullyposted_status", "processing_status", "flex_2det1nd2", "flex_t6y2yh5r", "ida_source_stock_mode", "item_display_table"];

/*@@IDA_SHARED@@*/

const idaOn = () => ASYNC_IDA_ENABLED === true && [IDA_WF.SUBMIT, IDA_WF.WORKER].every((id) => /^[1-9][0-9]{0,19}$/.test(id));
// COMPLETE for the Completed button; COMPLETE_POST (or, when it is off, COMPLETE) for Complete & Post
const modeOf = () => {
  if (!IDA_BUTTON_POSTS) return IDA_V2_ACTIONS.COMPLETE === true ? "COMPLETE" : "";
  if (IDA_V2_ACTIONS.COMPLETE_POST === true) return "POST";
  return IDA_V2_ACTIONS.COMPLETE === true ? "POST_LATER" : "";
};

const digits = (v) => /^[0-9]{1,20}$/.test(idaS(v));
// SUBMIT answers "" (or "0") until the job is linked to the disassembly it saved
const linked = (v) => /^[1-9][0-9]{0,19}$/.test(idaS(v));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const data_ = () => this.models["_data"] || {};
const store = (patch) => {
  this.models["_data"] = { ...this.models["_data"], ...patch };
};

const release = () => {
  store({ ida_submitting: 0 });
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

// settles on the callback or on the promise runWorkflow returns, whichever comes first
const run = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });

// an alert closed with its X rejects: it was still read
const alertBox = (message, title, type) =>
  this.$alert(message, title || "", { confirmButtonText: "OK", type: type, dangerouslyUseHTMLString: false }).catch(() => {});

const markSeen = (jobId) => {
  try {
    localStorage.setItem("ida_v2_failed_seen_" + idaS(jobId), "1");
  } catch (e) {}
};

let handedOver = false;
let touched = false;
const classic = async (why) => {
  if (handedOver) return;
  handedOver = true;
  console.log("Item Disassembly V2: classic handler -", why);
  if (touched) release();
  try {
    await this.triggerEvent(IDA_CLASSIC);
  } catch (e) {
    console.error("Item Disassembly V2: classic handler failed", e);
  }
};

/*@@VALIDATE_FOR_SAVE@@*/

// the BOM-variance dialog renders HTML: names go in escaped
const idaEscHtml = (value) =>
  String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/*@@CONFIRM_BOM_VARIANCE@@*/

/*@@CLASSIC_POST@@*/

// the organization the classic Complete & Post posts with
const postOrg = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

// the route of this click, or why it stays with the classic handler
const routeOf = (v) => {
  const page = idaS(v.page_status);
  const isNew = page === "Add" || page === "Clone" || page === "Copy";
  if (!isNew && page !== "Edit") return { why: "page " + (page || "unknown") };
  if (!isNew && !digits(v.id)) return { why: "no document id" };
  if (!isNew && idaS(v.item_disassembly_status) !== "Draft") return { why: "stored " + (idaS(v.item_disassembly_status) || "no status") };
  if (idaHasHu(v)) return { why: "handling units" };
  if (idaPickHasSerial(v)) return { why: "serial numbers" };
  const moves = idaMoveCount(v, v.stock_movement);
  if (moves <= IDA_V2_MIN_MOVES) return { why: moves + " moves" };
  return { isNew: isNew, page: page, moves: moves };
};

const canon = (v) => {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
};
// FNV-1a 32 + djb2 32
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
  const own = idaS(record.organization_id);
  if (own) return own;
  let org = this.getVarGlobal("deptParentId");
  if (org === "0") org = this.getVarSystem("deptIds").split(",")[0];
  return idaS(org);
};

// one key per content (both buttons share it); a FAILED job moves to the next generation. After an answer that leaves it open
// whether anything was written, or while a new disassembly's job is not linked yet, the next click re-uses the key.
const pinSlot = (ctx) => (ctx.isNew ? "ida_pinned_new" : "ida_pinned_edit");
const idemKey = (ctx) => {
  const pinned = idaS(data_()[pinSlot(ctx)]);
  if (pinned) return pinned;
  let token = idaS(data_().ida_page_token);
  if (!token) {
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store({ ida_page_token: token });
  }
  const doc = ctx.isNew ? "new-" + token : idaS(ctx.record.id);
  const hash = hash16(canon({ saveAs: "Completed", pageStatus: ctx.page, record: ctx.record }));
  return ("IDA:" + ctx.org + ":" + doc + ":" + hash + ":" + ctx.gen).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
};
const pin = (ctx, on) => store({ [pinSlot(ctx)]: on ? ctx.key : "" });
// a new disassembly SUBMIT may have saved: Save as Draft would add a second one
const keepKey = (ctx) => {
  pin(ctx, true);
  if (ctx.isNew) this.hide(["button_draft"]);
};

// CONTRACT section 7: every request key is sent (strings except form)
const request = (ctx, operation, idaId) => ({
  operation: operation,
  saveAs: "Completed",
  pageStatus: operation === "STATUS" ? "Edit" : ctx.page,
  ida_id: idaS(idaId),
  idempotency_key: ctx.key,
  source: "FORM",
  form: operation === "STATUS" ? {} : ctx.record,
});

// the text of the platform's error envelope ({ code 400, data null, msg }) without 执行工作流节点[<node>]报错[...]
const envelopeText = (x) => {
  let raw = "";
  if (typeof x === "string") raw = idaS(x);
  else if (x && typeof x === "object") {
    const env = x instanceof Error ? (x.response && x.response.data) || {} : x;
    const inner = env.data && typeof env.data === "object" ? env.data : {};
    raw = idaS(env.msg) || idaS(inner.msg) || idaS(inner.message) || (x instanceof Error ? "" : idaS(env.message));
  }
  const m = raw.match(/报错\[([\s\S]*)\]\s*$/);
  return m ? idaS(m[1]) : raw;
};

const nameOf = (ctx, r) => ("Item Disassembly " + (idaS(r && r.ida_no) || idaS(ctx.record.stock_movement_no))).trim();

const statusOf = (w, jobId) => {
  if (!w) return "";
  if (idaS(w.job_id) === idaS(jobId)) return idaS(w.job_status);
  const mine = idaJsonList(w.jobs).find((j) => j && idaS(j.job_id) === idaS(jobId));
  return mine ? idaS(mine.job_status) : "";
};

const kick = (jobId) => {
  try {
    const p = this.runWorkflow(IDA_WF.WORKER, { job_id: idaS(jobId) }, () => {}, (e) => console.error("Item Disassembly V2: worker start failed", e));
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    console.error("Item Disassembly V2: worker could not be started", e);
  }
};

// after the stock moved the worker finishes the job (at most IDA_KICK_MAX calls); the form is closed by then
const kickLoop = async (job, name) => {
  for (let n = 1; n <= IDA_KICK_MAX; n++) {
    let w = null;
    try {
      const res = await run(IDA_WF.WORKER, { job_id: idaS(job.jobId) });
      w = (res && res.data) || null;
    } catch (e) {
      console.error("Item Disassembly V2: worker call failed - the list starts it again", e);
    }
    const st = statusOf(w, job.jobId);
    if (IDA_TERMINAL.indexOf(st) >= 0) {
      refreshList();
      if (st === "COMPLETED") return;
      markSeen(job.jobId);
      await alertBox("It stopped half-way and is under review: please contact support. " + idaS(w && w.result_message), name + " needs a review", "warning");
      return;
    }
    if (Number((w && w.processed) || 0) > 0) refreshList();
    else await sleep(3000);
  }
};

const finish = (job, text, moving, name) => {
  release();
  store({ ida_page_token: null, ida_gen: 1 });
  this.$message.success(text);
  closeDialog();
  if (moving) kickLoop(job, name);
};

// Complete & Post on a COMPLETED job: the classic posting code, unchanged, once per job - this browser's mark first, then the
// stored row (another tab or browser may follow the same job, or the list may have posted it)
const postCompleted = async (job, name) => {
  release();
  store({ ida_page_token: null, ida_gen: 1 });
  let again = false;
  try {
    const mark = "ida_v2_posted_" + idaS(job.jobId);
    again = localStorage.getItem(mark) === "1";
    if (!again) localStorage.setItem(mark, "1");
  } catch (e) {}
  if (again) {
    this.$message.success(name + " completed; its posting was already started.");
    closeDialog();
    return;
  }
  let stored = null;
  try {
    const res = await db
      .collection("sm_item_disassembly")
      .where({ id: job.idaId, is_deleted: 0 })
      .field("item_disassembly_status,posted_status")
      .get();
    stored = (res && res.data && res.data[0]) || null;
  } catch (e) {
    console.error("Item Disassembly V2: stored status read failed", e);
  }
  const dictKey = (v) => idaS(v && typeof v === "object" ? v.dict_key : v);
  const status = stored ? dictKey(stored.item_disassembly_status) : "";
  const posted = stored ? dictKey(stored.posted_status) : "";
  if (status !== "Completed" || ["Unposted", "Failed Post", ""].indexOf(posted) < 0) {
    this.$message.warning(stored ? name + " completed; not posted from here (" + [status || "no status", posted].filter((x) => x).join(", ") + ")."
      : "Item Disassembly completed, but posting could not be started. Please post it from the Item Disassembly list.");
    closeDialog();
    return;
  }
  try {
    await idaClassicPost(job.idaId, postOrg());
  } catch (e) {
    console.error("Item Disassembly V2: posting could not be started", e);
    this.$message.warning("Item Disassembly completed, but posting could not be started. Please post it from the Item Disassembly list.");
    closeDialog();
  }
};

const completedText = (ctx, name) =>
  ctx.mode === "COMPLETE" ? name + " completed." : name + " completed. Post it from the Item Disassembly list.";

// the verdict: a terminal job, or (no post) the stock moved (COMMITTING_IDA at 80 %); Complete & Post waits for COMPLETED
const follow = async (ctx, q) => {
  const name = nameOf(ctx, q);
  const job = { jobId: idaS(q.job_id), idaId: linked(q.ida_id) ? idaS(q.ida_id) : idaS(ctx.record.id) };
  this.showLoading("Completing " + name + "...");
  kick(job.jobId);
  let kickedAt = Date.now();
  const deadline = Date.now() + IDA_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(IDA_POLL_MS);
    if (Date.now() - kickedAt >= IDA_KICK_MS) {
      kickedAt = Date.now();
      kick(job.jobId);
    }
    let st = null;
    try {
      const res = await run(IDA_WF.SUBMIT, request(ctx, "STATUS", job.idaId));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Item Disassembly V2: status check failed - trying again", e);
    }
    if (st && (idaS(st.job_status) === "NONE" || (idaS(st.terminal) === "YES" && !idaS(st.job_id)))) {
      release();
      this.$message.warning(name + " is not being completed in the background any more. Open it again to see its current state.");
      closeDialog();
      return;
    }
    if (!st || idaS(st.job_id) !== job.jobId) continue;
    if (linked(st.ida_id)) job.idaId = idaS(st.ida_id);
    const js = idaS(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // nothing moved and it is a Draft again: an edit keeps the form; the next click is a new job
      release();
      store({ ida_gen: ctx.gen + 1 });
      markSeen(job.jobId);
      await alertBox(idaS(st.error_message) || idaS(st.error_code) || "The Item Disassembly could not be completed.", name + " was not completed", "error");
      // a new disassembly that failed is a saved Draft now: a second click in Add mode would save a second one
      if (ctx.isNew) closeDialog();
      return;
    }
    if (js === "COMPLETED") {
      if (ctx.mode === "POST") return postCompleted(job, name);
      return finish(job, completedText(ctx, name), false, name);
    }
    if (js === "REQUIRES_REVIEW") {
      release();
      markSeen(job.jobId);
      await alertBox("It stopped half-way and is under review: please contact support. " + idaS(st.error_message), name + " needs a review", "warning");
      closeDialog();
      return;
    }
    if (ctx.mode !== "POST" && js === "COMMITTING_IDA" && Number(st.progress_percent) >= 80) {
      const text = ctx.mode === "COMPLETE" ? name + ": the stock has moved; it is being finished in the background." : name + ": " + IDA_TEXT.postLater;
      return finish(job, text, true, name);
    }
  }
  release();
  if (ctx.mode === "COMPLETE") this.$message.info(name + " is still being completed in the background.");
  else this.$message.warning(name + ": " + IDA_TEXT.postLater);
  closeDialog();
};

// a new disassembly's job answered before SUBMIT linked it (a same-key retry, or a double click while the first SUBMIT runs):
// the form stays and keeps the SAME key; STATUS of that key until the job shows its disassembly
const awaitLink = async (ctx, q) => {
  keepKey(ctx);
  this.showLoading("Completing Item Disassembly...");
  const deadline = Date.now() + IDA_LINK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(IDA_LINK_POLL_MS);
    let st = null;
    try {
      const res = await run(IDA_WF.SUBMIT, request(ctx, "STATUS", "0"));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Item Disassembly V2: status check failed - trying again", e);
    }
    if (!st || idaS(st.route) !== "STATUS") continue;
    const js = idaS(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      pin(ctx, false);
      release();
      store({ ida_gen: ctx.gen + 1 });
      markSeen(st.job_id);
      await alertBox(idaS(st.error_message) || idaS(st.progress_message) || "The completion did not finish.", "Item Disassembly was not completed", "error");
      // a failed new disassembly that was linked is a saved Draft now
      if (linked(st.ida_id)) closeDialog();
      return;
    }
    if (linked(st.ida_id) && (IDA_RUNNING.indexOf(js) >= 0 || js === "COMPLETED" || js === "REQUIRES_REVIEW")) {
      pin(ctx, false);
      return queued(ctx, { ...q, ...st });
    }
    // no job of this key (NONE), or under review before it was linked: the key stays for the next click
    if (js === "NONE" || js === "REQUIRES_REVIEW" || (idaS(st.terminal) === "YES" && !idaS(st.job_id))) break;
  }
  release();
  this.$message.warning("The completion is still being prepared - check the Item Disassembly list before saving again.");
};

const queued = (ctx, r) => {
  if (ctx.isNew && !linked(r.ida_id)) return awaitLink(ctx, r);
  return follow(ctx, r);
};

const submit = async (ctx) => {
  this.showLoading("Completing Item Disassembly...");
  const params = request(ctx, "SUBMIT", ctx.isNew ? "" : ctx.record.id);
  let res = null;
  let failure = null;
  try {
    res = await run(IDA_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("Item Disassembly V2: submit failed, repeating once with the same key", e);
    try {
      res = await run(IDA_WF.SUBMIT, params);
    } catch (again) {
      failure = again;
      console.error("Item Disassembly V2: submit failed twice", again);
    }
  }
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    // no answer, or the platform's error envelope (a refusal that ended the run before anything was written)
    release();
    keepKey(ctx);
    this.$message.error(envelopeText(failure) || envelopeText(res) || "No response from workflow. Please try again - the same completion is sent again.");
    return;
  }
  const message = idaS(r.message);
  const st = idaS(r.job_status);
  if (r.route === "STOP" && idaS(r.code) === "500") {
    release();
    keepKey(ctx);
    this.$message.error(message || IDA_TEXT.queueFailed);
    return;
  }
  pin(ctx, false);
  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") return classic(r.route + ": " + (idaS(r.reason) || message));
  if (r.route === "STATUS" && (st === "NONE" || !idaS(r.job_id))) {
    release();
    this.$message.warning(message || "No background completion was found for this Item Disassembly. Please try again.");
    return;
  }
  if (r.route === "QUEUED" || (r.route === "STATUS" && IDA_RUNNING.indexOf(st) >= 0)) return queued(ctx, r);
  if (r.route === "STATUS" && st === "COMPLETED") {
    // completed by an earlier click: never posted twice from here
    release();
    this.$message.success(nameOf(ctx, r) + " is already completed." + (ctx.mode === "COMPLETE" ? "" : " Post it from the Item Disassembly list if it is not posted yet."));
    closeDialog();
    return;
  }
  if (r.route === "STATUS" && (st === "FAILED" || st === "CANCELLED" || st === "REQUIRES_REVIEW")) {
    // the same content failed before: the next click is a new key (a new disassembly's job under review before its link keeps it)
    release();
    if (st !== "REQUIRES_REVIEW") store({ ida_gen: ctx.gen + 1 });
    else if (ctx.isNew && !linked(r.ida_id)) keepKey(ctx);
    markSeen(r.job_id);
    await alertBox(idaS(r.error_message) || idaS(r.progress_message) || "The previous completion of this Item Disassembly did not finish.", nameOf(ctx, r),
      st === "REQUIRES_REVIEW" ? "warning" : "error");
    if (ctx.isNew && linked(r.ida_id)) closeDialog();
    return;
  }
  release();
  if (r.route === "BUSY" || r.route === "STALE") {
    this.$message.warning(message || IDA_TEXT.busy);
    return;
  }
  this.$message.error(message || "Failed to complete the Item Disassembly");
};

(async () => {
  const mode = modeOf();
  if (!idaOn() || !mode) return classic("switched off (ASYNC_IDA_ENABLED / IDA_V2_ACTIONS / workflow ids)");
  let submitting = false;
  try {
    if (data_().ida_submitting === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    // claimed before the first await: a second click while this one validates is refused above; every exit releases it
    touched = true;
    store({ ida_submitting: 1 });
    const values = this.getValues();
    const route = routeOf(values);
    if (route.why) return classic(route.why);
    // the classic's own checks first: a field error goes to the classic handler, which shows it; Cancel ends the click
    try {
      await validateForSave();
    } catch (invalid) {
      return classic("validation");
    }
    const record = { ...values };
    IDA_NOT_RECORD.forEach((k) => delete record[k]);
    Object.keys(record).forEach((k) => {
      if (k.indexOf("dialog_") === 0) delete record[k];
    });
    if (!(await confirmBomVariance(record))) {
      release();
      return;
    }
    const ctx = { mode: mode, isNew: route.isNew, page: route.page, record: record, org: orgOf(record), gen: Number(data_().ida_gen) || 1 };
    ctx.key = idemKey(ctx);
    submitting = true;
    await submit(ctx);
  } catch (error) {
    if (!submitting) {
      console.error("Item Disassembly V2: error before SUBMIT - classic handler", error);
      await classic("error before SUBMIT");
      return;
    }
    release();
    console.error("Item Disassembly V2 error:", error);
    this.$message.error((error && error.message) || "Failed to complete the Item Disassembly");
  }
})();
