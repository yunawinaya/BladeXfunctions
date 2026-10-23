// gde_onClick_save_as_created - Goods Delivery form, onClick of button_save_as_created (the Created button).
// GD Edit V2: an edit of a saved delivery (Created, or a Draft saved as Created) goes to GD_EDIT_SUBMIT. QUEUED -> GD_EDIT_WORKER
// is started (no scheduled worker: this start, the form's mounted and the list's are what move the job) and the form waits for
// its check (STATUS every 2 s, at most 90 s): passed -> the dialog closes; failed -> the reason, the edits stay on screen.
// NOT_ELIGIBLE, a new delivery, or the switch off -> gdV2_onClick_save_as_created, today's handler, unchanged.
const GDE_WF = {
  SUBMIT: "2110618741159940097", // GD_EDIT_SUBMIT
  WORKER: "2110618789356687361", // GD_EDIT_WORKER
  CONSUMER: "2105134245397041153", // GD_PICKING_OUTBOX_CONSUMER (a GD V2 create's Picking)
};
// Switch: false = every edit runs today's handler (the classic save)
const ASYNC_EDIT_ENABLED = true;
const GDE_POLL_MS = 2000;
const GDE_KICK_MS = 15000;
const GDE_WAIT_MS = 90000;
// the inventory engine refuses data the classic save handles (costing rows to migrate, a duplicate balance row, a negative price)
const GDE_FALLBACK = ["GDE_INVENTORY_UNSUPPORTED_COSTING", "GDE_INVENTORY_DUPLICATE_BALANCE", "GDE_INVENTORY_UNSUPPORTED_PRICE"];

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const run = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const release = () => {
  this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
  this.hideLoading();
};

const today = async (why) => {
  console.log("GD Edit V2: today's handler -", why);
  release();
  await this.triggerEvent("gdV2_onClick_save_as_created");
};

// job and gate texts carry item names (master data): HTML only for their line breaks
const safeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
  .replace(/&lt;br\s*\/?&gt;/gi, "<br>").replace(/\n/g, "<br>");

const confirm = (message, title, ok, cancel, type) =>
  this.$confirm(safeHtml(message), title || "", { confirmButtonText: ok, cancelButtonText: cancel, type: type, dangerouslyUseHTMLString: true })
    .then(() => true)
    .catch(() => false);

// an alert closed with its X rejects: it was still read
const alertBox = (message, title, type) =>
  this.$alert(safeHtml(message), title || "", { confirmButtonText: "OK", type: type, dangerouslyUseHTMLString: true }).catch(() => {});

const kick = (jobId) => {
  try {
    this.runWorkflow(
      GDE_WF.WORKER,
      { job_id: jobId },
      (w) => {
        // refresh only - by now another delivery may be open in the dialog
        const processed = Number((w && w.data && w.data.processed) || 0);
        if (processed > 0 && this.parentGenerateForm) this.parentGenerateForm.refresh();
      },
      (e) => console.error("GD Edit V2: worker start failed - the form's mounted and the list start it again", e),
    );
  } catch (e) {
    console.error("GD Edit V2: worker could not be started - the form's mounted and the list start it again", e);
  }
};

const finish = async (q, s, text) => {
  release();
  if (q.picking_reversal_note) await alertBox(q.picking_reversal_note, "Stock to put back", "warning");
  if (q.credit_limit_note) await alertBox(q.credit_limit_note, "Credit limit", "info");
  if (s && s.job_status === "REQUIRES_REVIEW") await alertBox(s.error_message || "This delivery needs a review before it can be saved again.", "Saved with a problem", "warning");
  else this.$message.success(text);
  closeDialog();
};

// a GD V2 create whose Picking is not made yet: start its outbox consumer without waiting (no Quartz on prod; a failure there
// must not reach this save)
const startPickingCreate = (gdId) => {
  try {
    this.runWorkflow(GDE_WF.CONSUMER, { event_id: "GD_COMMITTED|" + gdId + "|1" }, () => {}, (e) => console.error("GD Edit V2: Picking creation start failed", e));
  } catch (e) {
    console.error("GD Edit V2: Picking creation could not be started", e);
  }
};

// PREPARE failed: it puts the delivery back from Processing right after its job row; wait up to 10 s for that
const unlocked = async (gdId) => {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await db.collection("Goods Delivery").where({ id: gdId }).field("gd_status").get();
      const g = ((r && r.data) || [])[0];
      if (g && g.gd_status !== "Processing") return true;
    } catch (e) {
      console.error("GD Edit V2: delivery status read failed - trying again", e);
    }
    await sleep(1000);
  }
  return false;
};

// QUEUED: start the worker, then wait for its check of the edit
const follow = async (q) => {
  const no = q.gd_no || "";
  this.showLoading("Checking Goods Delivery " + no + "...");
  kick(q.job_id);
  let kickedAt = Date.now();
  const deadline = Date.now() + GDE_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(GDE_POLL_MS);
    // a job waiting out a retry backoff moves only when kicked again
    if (Date.now() - kickedAt >= GDE_KICK_MS) {
      kickedAt = Date.now();
      kick(q.job_id);
    }
    let s = null;
    try {
      const res = await run(GDE_WF.SUBMIT, { operation: "STATUS", gd_id: q.gd_id });
      s = (res && res.data) || null;
    } catch (e) {
      console.error("GD Edit V2: status check failed - trying again", e);
    }
    if (!s || String(s.job_id) !== String(q.job_id)) continue;
    const st = s.job_status;
    if (st === "FAILED" && GDE_FALLBACK.indexOf(String(s.error_code)) >= 0 && (await unlocked(q.gd_id))) return today("the inventory engine refused it (" + s.error_code + ")");
    if (st === "FAILED" || st === "CANCELLED") {
      release();
      await alertBox(s.error_message || s.error_code || "The edit could not be saved.", "Goods Delivery " + no + " was not saved", "error");
      return;
    }
    if (st === "COMPLETED") return finish(q, s, "Goods Delivery " + no + " saved.");
    if (st === "READY_TO_COMMIT" || st === "COMMITTING_GD" || st === "HELD" || st === "REQUIRES_REVIEW") {
      return finish(q, s, "Goods Delivery " + no + " is being saved in the background.");
    }
  }
  return finish(q, null, "Goods Delivery " + no + " is still being checked in the background.");
};

const submit = async (data, answers) => {
  this.showLoading("Saving Goods Delivery as Created...");
  const res = await run(GDE_WF.SUBMIT, { operation: "SUBMIT", gd_id: data.id, source: "FORM", answers: answers, form: data });
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    release();
    this.$message.error("No response from workflow. Please contact support.");
    return;
  }
  const message = r.message || "";
  if (r.route === "QUEUED") return follow(r);
  if (r.route === "NOT_ELIGIBLE") return today(r.reason || message);
  if (r.route === "BUSY") {
    release();
    if (r.command === "CREATE_GD_FROM_FORM") startPickingCreate(data.id);
    this.$message.warning(message);
    return;
  }
  if (r.route !== "STOP") {
    release();
    this.$message.error(message || "Failed to save Goods Delivery. Please contact support.");
    return;
  }
  const code = String(r.code);
  if (code === "401") {
    this.hideLoading();
    if (!(await confirm(message || "Some lines have zero delivery quantity. Would you like to proceed?", "", "Proceed", "Cancel", "warning"))) return release();
    return submit(data, { ...answers, continueZero: "Yes" });
  }
  if (code === "403") {
    this.hideLoading();
    if (!(await confirm((message || "Credit limit warning").replace(/^Override - /, ""), "", "Proceed", "Cancel", "error"))) return release();
    return submit(data, { ...answers, needCL: "not required" });
  }
  if (code === "413") {
    this.hideLoading();
    if (!(await confirm(message || "This change reverses quantities that have already been picked. Proceed?", "Reverse picked quantities", "Proceed", "Cancel", "warning"))) return release();
    return submit(data, { ...answers, confirmPickReversal: "Yes" });
  }
  release();
  if (code === "402") return alertBox((message || "Credit limit exceeded").replace(/^Block - /, ""), "", "error");
  this.$message.error(message || "Failed to save Goods Delivery. Please contact support.");
};

(async () => {
  try {
    if (this.models["_data"]?.is_processing === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    const data = this.getValues();
    if (this.isAdd || this.isCopy || !data.id || data.page_status !== "Edit") return today("a new delivery (page " + data.page_status + ")");
    if (ASYNC_EDIT_ENABLED !== true) return today("switched off (ASYNC_EDIT_ENABLED)");
    this.models["_data"] = { ...this.models["_data"], is_processing: 1 };
    await submit(data, { needCL: "required", continueZero: "", confirmPickReversal: "" });
  } catch (error) {
    release();
    console.error("GD Edit V2 error:", error);
    this.$message.error(error.message || "Failed to save Goods Delivery. Please contact support.");
  }
})();
