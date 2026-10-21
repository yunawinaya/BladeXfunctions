// __HANDLER_NAME__ - Item Assembly form, onClick of __BUTTON_MODEL__. One source for the Completed and the Complete & Post
// buttons; each knows its classic handler as a constant (rollback = bind the button back to it).
// IA V2: a completion of more than IA_V2_MIN_PICKS stock picks (temp_qty_data entries with sm_quantity > 0) without handling
// units or serial numbers goes to IA_V2_SUBMIT; Complete & Post posts with the classic posting code once the job is COMPLETED.
// Everything else - the switch or this action off, Revert V2 off, a workflow id not set, a View page, a stored status other than Draft,
// <= IA_V2_MIN_PICKS picks, handling units, serial numbers, a NOT_ELIGIBLE or INVALID answer, any error before SUBMIT is
// called - runs the classic handler through triggerEvent, unchanged.
const IA_WF = {
  SUBMIT: "__IA_V2_SUBMIT__", // IA_V2_SUBMIT
  WORKER: "__IA_V2_WORKER__", // IA_V2_WORKER
  REVERT_SUBMIT: "__IA_REVERT_V2_SUBMIT__", // IA_REVERT_V2_SUBMIT
  REVERT_WORKER: "__IA_REVERT_V2_WORKER__", // IA_REVERT_V2_WORKER
};
// Switch: false = every click runs the classic handler and nothing else
const ASYNC_IA_ENABLED = __ASYNC_IA_ENABLED__;
// the list's Revert V2 switch: a background completion only while it is on too (CONTRACT ruling 9)
const ASYNC_IA_REVERT_ENABLED = __ASYNC_IA_REVERT_ENABLED__;
// Per action, false = the classic handler. With COMPLETE_POST off, a big Complete & Post still completes in the background
// (when COMPLETE is on) and is posted from the list.
const IA_V2_ACTIONS = { COMPLETE: __IA_V2_COMPLETE__, COMPLETE_POST: __IA_V2_COMPLETE_POST__ };
// the classic handler this button ran before, and whether this button posts
const IA_CLASSIC = "__CLASSIC__";
const IA_BUTTON_POSTS = __BUTTON_POSTS__;
const IA_POLL_MS = 2500;
const IA_KICK_MS = 15000;
const IA_WAIT_MS = 420000;
const IA_LINK_POLL_MS = 3000;
const IA_LINK_WAIT_MS = 90000;
const IA_KICK_MAX = 10;
const IA_RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA"];
const IA_TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];
// not record fields: the job's own fields, the stock dialog, buttons, badges, layout widgets, platform keys
const IA_NOT_RECORD = ["ia_v2_job_id", "ia_idem_key", "_data", "$_v", "_vts", "isTrusted", "sm_item_balance", "button_draft",
  "button_completed", "comp_post_button", "button_post", "draft_status", "issued_status", "completed_status", "fullyposted_status",
  "processing_status", "flex_2det1nd2", "flex_t6y2yh5r", "item_assembly_tittle"];

/*@@IA_SHARED@@*/

const iaOn = () => ASYNC_IA_ENABLED === true && ASYNC_IA_REVERT_ENABLED === true &&
  [IA_WF.SUBMIT, IA_WF.WORKER, IA_WF.REVERT_SUBMIT, IA_WF.REVERT_WORKER].every((id) => /^[1-9][0-9]{0,19}$/.test(id));
// COMPLETE for the Completed button; COMPLETE_POST (or, when it is off, COMPLETE) for Complete & Post
const modeOf = () => {
  if (!IA_BUTTON_POSTS) return IA_V2_ACTIONS.COMPLETE === true ? "COMPLETE" : "";
  if (IA_V2_ACTIONS.COMPLETE_POST === true) return "POST";
  return IA_V2_ACTIONS.COMPLETE === true ? "POST_LATER" : "";
};

const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
// a job's Item Assembly: SUBMIT answers "" (or "0") until the job is linked to the assembly it saved
const linked = (v) => /^[1-9][0-9]{0,19}$/.test(s(v));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const data_ = () => this.models["_data"] || {};
const store = (patch) => {
  this.models["_data"] = { ...this.models["_data"], ...patch };
};

const release = () => {
  store({ ia_submitting: 0 });
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
    localStorage.setItem("ia_v2_failed_seen_" + s(jobId), "1");
  } catch (e) {}
};

// the classic handler, exactly as the button ran it before (once per click)
let handedOver = false;
let touched = false;
const classic = async (why) => {
  if (handedOver) return;
  handedOver = true;
  console.log("Item Assembly V2: classic handler -", why);
  if (touched) release();
  try {
    await this.triggerEvent(IA_CLASSIC);
  } catch (e) {
    console.error("Item Assembly V2: classic handler failed", e);
  }
};

/*@@CONFIRM_BOM_VARIANCE@@*/

/*@@CLASSIC_POST@@*/

// the classic Complete & Post's organization for the post
const postOrg = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

// the route of this click (CONTRACT section 12), or why it stays with the classic handler
const routeOf = (v) => {
  const page = s(v.page_status);
  const isNew = page === "Add" || page === "Clone" || page === "Copy";
  if (!isNew && page !== "Edit") return { why: "page " + (page || "unknown") };
  if (!isNew && !digits(v.id)) return { why: "no document id" };
  if (!isNew && s(v.item_assembly_status) !== "Draft") return { why: "stored " + (s(v.item_assembly_status) || "no status") };
  const lines = Array.isArray(v.stock_movement) ? v.stock_movement : [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || {};
    if (iaLineHasHu(line)) return { why: "handling units on line " + (i + 1) };
    if (iaPicks(line).some((p) => s(p.serial_number) !== "")) return { why: "serial numbers on line " + (i + 1) };
  }
  const picks = iaPickCount(lines);
  if (picks <= IA_V2_MIN_PICKS) return { why: picks + " picks" };
  return { isNew: isNew, page: page, picks: picks };
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

// one key per content: a lost answer re-sent with the same key finds the same job; new content or a FAILED job gets the next
// generation (a new key, a new job). Both buttons send the same content, so one key serves Completed and Complete & Post.
// After an answer that leaves it open whether anything was written (no answer, STOP 500, the platform's error envelope), or
// while a new assembly's job is not linked yet, the next click re-uses the key whatever the content.
const pinSlot = (ctx) => (ctx.isNew ? "ia_pinned_new" : "ia_pinned_edit");
const idemKey = (ctx) => {
  const pinned = s(data_()[pinSlot(ctx)]);
  if (pinned) return pinned;
  let token = s(data_().ia_page_token);
  if (!token) {
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store({ ia_page_token: token });
  }
  const doc = ctx.isNew ? "new-" + token : s(ctx.record.id);
  const hash = hash16(canon({ saveAs: "Completed", pageStatus: ctx.page, record: ctx.record }));
  return ("IA:" + ctx.org + ":" + doc + ":" + hash + ":" + ctx.gen).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
};
const pin = (ctx, on) => store({ [pinSlot(ctx)]: on ? ctx.key : "" });
// a new assembly that SUBMIT may have saved: Save as Draft would add a second one (the Completed buttons re-send the key)
const keepKey = (ctx) => {
  pin(ctx, true);
  if (ctx.isNew) this.hide(["button_draft"]);
};

// CONTRACT section 7: every request key is sent (strings except form)
const request = (ctx, operation, iaId) => ({
  operation: operation,
  saveAs: "Completed",
  pageStatus: operation === "STATUS" ? "Edit" : ctx.page,
  ia_id: s(iaId),
  idempotency_key: ctx.key,
  source: "FORM",
  form: operation === "STATUS" ? {} : ctx.record,
});

// the text of the platform's error envelope ({ code 400, data null, msg }), unwrapped from 执行工作流节点[<node>]报错[<text>];
// a transport error has none
const envelopeText = (x) => {
  let raw = "";
  if (typeof x === "string") raw = s(x);
  else if (x && typeof x === "object") {
    const env = x instanceof Error ? (x.response && x.response.data) || {} : x;
    const inner = env.data && typeof env.data === "object" ? env.data : {};
    raw = s(env.msg) || s(inner.msg) || s(inner.message) || (x instanceof Error ? "" : s(env.message));
  }
  const m = raw.match(/报错\[([\s\S]*)\]\s*$/);
  return m ? s(m[1]) : raw;
};

const nameOf = (ctx, r) => ("Item Assembly " + (s(r && r.ia_no) || s(ctx.record.stock_movement_no))).trim();

const statusOf = (w, jobId) => {
  if (!w) return "";
  if (s(w.job_id) === s(jobId)) return s(w.job_status);
  const jobs = iaJsonList(w.jobs);
  const mine = jobs.find((j) => j && s(j.job_id) === s(jobId));
  return mine ? s(mine.job_status) : "";
};

const kick = (jobId) => {
  try {
    const p = this.runWorkflow(IA_WF.WORKER, { job_id: s(jobId) }, () => {}, (e) => console.error("Item Assembly V2: worker start failed", e));
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    console.error("Item Assembly V2: worker could not be started", e);
  }
};

// after the stock moved: the worker finishes the job (at most IA_KICK_MAX calls); the form is closed by then
const kickLoop = async (job, name) => {
  for (let n = 1; n <= IA_KICK_MAX; n++) {
    let w = null;
    try {
      const res = await run(IA_WF.WORKER, { job_id: s(job.jobId) });
      w = (res && res.data) || null;
    } catch (e) {
      console.error("Item Assembly V2: worker call failed - the list starts it again", e);
    }
    const st = statusOf(w, job.jobId);
    if (IA_TERMINAL.indexOf(st) >= 0) {
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

const finish = (job, text, moving, name) => {
  release();
  store({ ia_page_token: null, ia_gen: 1 });
  this.$message.success(text);
  closeDialog();
  if (moving) kickLoop(job, name);
};

// Complete & Post on a COMPLETED job: the classic posting code, unchanged
const postCompleted = async (job) => {
  release();
  store({ ia_page_token: null, ia_gen: 1 });
  try {
    await iaClassicPost(job.iaId, postOrg());
  } catch (e) {
    console.error("Item Assembly V2: posting could not be started", e);
    this.$message.warning("Item Assembly completed, but posting could not be started. Please post it from the Item Assembly list.");
    closeDialog();
  }
};

const completedText = (ctx, name) =>
  ctx.mode === "COMPLETE" ? name + " completed." : name + " completed. Post it from the Item Assembly list.";

// wait for the verdict: a terminal job, or (Completed button) the stock moved (COMMITTING_IA at 80 %); Complete & Post waits
// for COMPLETED and posts then
const follow = async (ctx, q) => {
  const name = nameOf(ctx, q);
  const job = { jobId: s(q.job_id), iaId: linked(q.ia_id) ? s(q.ia_id) : s(ctx.record.id) };
  this.showLoading("Completing " + name + "...");
  kick(job.jobId);
  let kickedAt = Date.now();
  const deadline = Date.now() + IA_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(IA_POLL_MS);
    if (Date.now() - kickedAt >= IA_KICK_MS) {
      kickedAt = Date.now();
      kick(job.jobId);
    }
    let st = null;
    try {
      const res = await run(IA_WF.SUBMIT, request(ctx, "STATUS", job.iaId));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Item Assembly V2: status check failed - trying again", e);
    }
    if (st && (s(st.job_status) === "NONE" || (s(st.terminal) === "YES" && !s(st.job_id)))) {
      // no job any more: the form is out of date - close it so the assembly is opened again from the list
      release();
      this.$message.warning(name + " is not being completed in the background any more. Open it again to see its current state.");
      closeDialog();
      return;
    }
    if (!st || s(st.job_id) !== job.jobId) continue;
    if (linked(st.ia_id)) job.iaId = s(st.ia_id);
    const js = s(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // nothing moved and the assembly is a Draft again: an edit keeps the form and its content; the next click is a new job
      release();
      store({ ia_gen: ctx.gen + 1 });
      markSeen(job.jobId);
      await alertBox(s(st.error_message) || s(st.error_code) || "The Item Assembly could not be completed.", name + " was not completed", "error");
      // a new assembly that failed is a saved Draft now: never stay in Add mode (a second click would save a second one)
      if (ctx.isNew) closeDialog();
      return;
    }
    if (js === "COMPLETED") {
      if (ctx.mode === "POST") return postCompleted(job);
      return finish(job, completedText(ctx, name), false, name);
    }
    if (js === "REQUIRES_REVIEW") {
      release();
      markSeen(job.jobId);
      await alertBox("It stopped half-way and is under review: please contact support. " + s(st.error_message), name + " needs a review", "warning");
      closeDialog();
      return;
    }
    if (ctx.mode !== "POST" && js === "COMMITTING_IA" && Number(st.progress_percent) >= 80) {
      const text = ctx.mode === "COMPLETE" ? name + ": the stock has moved; it is being finished in the background." : name + ": " + IA_TEXT.postLater;
      return finish(job, text, true, name);
    }
  }
  release();
  if (ctx.mode === "COMPLETE") this.$message.info(name + " is still being completed in the background.");
  else this.$message.warning(name + ": " + IA_TEXT.postLater);
  closeDialog();
};

// a new assembly's job answered before SUBMIT linked it to its assembly (a same-key retry or a double click while the first
// SUBMIT still runs): the form stays and keeps the SAME key; STATUS of that key until the job shows its assembly
const awaitLink = async (ctx, q) => {
  keepKey(ctx);
  this.showLoading("Completing Item Assembly...");
  const deadline = Date.now() + IA_LINK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(IA_LINK_POLL_MS);
    let st = null;
    try {
      const res = await run(IA_WF.SUBMIT, request(ctx, "STATUS", "0"));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Item Assembly V2: status check failed - trying again", e);
    }
    if (!st || s(st.route) !== "STATUS") continue;
    const js = s(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // the job ended without completing: tell why; the next click is a new job (a new key)
      pin(ctx, false);
      release();
      store({ ia_gen: ctx.gen + 1 });
      markSeen(st.job_id);
      await alertBox(s(st.error_message) || s(st.progress_message) || "The completion did not finish.", "Item Assembly was not completed", "error");
      // a failed new assembly that was linked is a saved Draft now: never stay in Add mode
      if (linked(st.ia_id)) closeDialog();
      return;
    }
    if (linked(st.ia_id) && (IA_RUNNING.indexOf(js) >= 0 || js === "COMPLETED" || js === "REQUIRES_REVIEW")) {
      pin(ctx, false);
      return queued(ctx, { ...q, ...st });
    }
    // no job of this key (NONE), or under review before it was linked: stop asking; the key stays for the next click
    if (js === "NONE" || js === "REQUIRES_REVIEW" || (s(st.terminal) === "YES" && !s(st.job_id))) break;
  }
  release();
  this.$message.warning("The completion is still being prepared - check the Item Assembly list before saving again.");
};

const queued = (ctx, r) => {
  if (ctx.isNew && !linked(r.ia_id)) return awaitLink(ctx, r);
  return follow(ctx, r);
};

const submit = async (ctx) => {
  this.showLoading("Completing Item Assembly...");
  const params = request(ctx, "SUBMIT", ctx.isNew ? "" : ctx.record.id);
  let res = null;
  let failure = null;
  try {
    res = await run(IA_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("Item Assembly V2: submit failed, repeating once with the same key", e);
    try {
      res = await run(IA_WF.SUBMIT, params);
    } catch (again) {
      failure = again;
      console.error("Item Assembly V2: submit failed twice", again);
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
  const message = s(r.message);
  const st = s(r.job_status);
  if (r.route === "STOP" && s(r.code) === "500") {
    release();
    keepKey(ctx);
    this.$message.error(message || IA_TEXT.queueFailed);
    return;
  }
  pin(ctx, false);
  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") return classic(r.route + ": " + (s(r.reason) || message));
  if (r.route === "STATUS" && (st === "NONE" || !s(r.job_id))) {
    release();
    this.$message.warning(message || "No background completion was found for this Item Assembly. Please try again.");
    return;
  }
  if (r.route === "QUEUED" || (r.route === "STATUS" && IA_RUNNING.indexOf(st) >= 0)) return queued(ctx, r);
  if (r.route === "STATUS" && st === "COMPLETED") {
    // completed by an earlier click: never post twice from here
    release();
    this.$message.success(nameOf(ctx, r) + " is already completed." + (ctx.mode === "COMPLETE" ? "" : " Post it from the Item Assembly list if it is not posted yet."));
    closeDialog();
    return;
  }
  if (r.route === "STATUS" && (st === "FAILED" || st === "CANCELLED" || st === "REQUIRES_REVIEW")) {
    // the same content failed before: tell why; the next click tries again with a new key (a new assembly's job under review
    // before it was linked keeps its key: only that job can save it)
    release();
    if (st !== "REQUIRES_REVIEW") store({ ia_gen: ctx.gen + 1 });
    else if (ctx.isNew && !linked(r.ia_id)) keepKey(ctx);
    markSeen(r.job_id);
    await alertBox(s(r.error_message) || s(r.progress_message) || "The previous completion of this Item Assembly did not finish.", nameOf(ctx, r),
      st === "REQUIRES_REVIEW" ? "warning" : "error");
    // a failed new assembly is a saved Draft now: never stay in Add mode
    if (ctx.isNew && linked(r.ia_id)) closeDialog();
    return;
  }
  release();
  if (r.route === "BUSY" || r.route === "STALE") {
    this.$message.warning(message || IA_TEXT.busy);
    return;
  }
  this.$message.error(message || "Failed to save the Item Assembly");
};

(async () => {
  // switched off (or this action off, or a workflow id not set): the classic handler and nothing else
  const mode = modeOf();
  if (!iaOn() || !mode) return classic("switched off (ASYNC_IA_ENABLED / IA_V2_ACTIONS / ASYNC_IA_REVERT_ENABLED)");
  let submitting = false;
  try {
    if (data_().ia_submitting === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    const values = this.getValues();
    const route = routeOf(values);
    if (route.why) return classic(route.why);
    // the classic's own checks first: a field error goes to the classic handler, which shows it; Cancel ends the click
    try {
      await this.validate();
    } catch (invalid) {
      return classic("validation");
    }
    const record = { ...values };
    IA_NOT_RECORD.forEach((k) => delete record[k]);
    Object.keys(record).forEach((k) => {
      if (k.indexOf("dialog_") === 0) delete record[k];
    });
    if (!(await confirmBomVariance(record))) return;
    const ctx = { mode: mode, isNew: route.isNew, page: route.page, record: record, org: orgOf(record), gen: Number(data_().ia_gen) || 1 };
    ctx.key = idemKey(ctx);
    touched = true;
    store({ ia_submitting: 1 });
    submitting = true;
    await submit(ctx);
  } catch (error) {
    if (!submitting) {
      console.error("Item Assembly V2: error before SUBMIT - classic handler", error);
      await classic("error before SUBMIT");
      return;
    }
    release();
    console.error("Item Assembly V2 error:", error);
    this.$message.error((error && error.message) || "Failed to save the Item Assembly");
  }
})();
