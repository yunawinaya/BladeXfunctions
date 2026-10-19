// gdc_onClick_save_as_completed - Goods Delivery form, onClick of button_save_as_completed (the Completed button).
// GD Completion V2: GD_COMPLETE_SUBMIT decides. QUEUED -> the dialog closes and GD_COMPLETE_WORKER is started (there is
// no scheduled worker: this start, and the list's, are what move the job). NOT_ELIGIBLE -> the classic
// onClick_save_as_completed, unchanged. Everything SUBMIT stops on carries GOODS_DELIVERY's own code and text, so the
// prompts below are the classic handler's.
const GDC_WF = {
  SUBMIT: "2110182609618337794", // GD_COMPLETE_SUBMIT
  WORKER: "2110182645714518018", // GD_COMPLETE_WORKER
};
// Switch: false = every click runs the classic save
const ASYNC_COMPLETE_ENABLED = true;
// Switch: false = a Force Complete (the 406 prompt) runs the classic save
const FORCE_COMPLETE_V2_ENABLED = true;

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

const release = () => {
  this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
  this.hideLoading();
};

// the classic save, exactly as the button ran it before
const classic = async (why) => {
  console.log("GD Completion V2: classic save -", why);
  release();
  await this.triggerEvent("onClick_save_as_completed");
};

const confirm = (message, title, ok, cancel, type) =>
  this.$confirm(message, title || "", { confirmButtonText: ok, cancelButtonText: cancel, type: type, dangerouslyUseHTMLString: true })
    .then(() => true)
    .catch(() => false);

const alertBox = (message, type) => this.$alert(message, "", { confirmButtonText: "OK", type: type, dangerouslyUseHTMLString: true });

const submit = async (data, answers) => {
  this.showLoading("Saving Goods Delivery as Completed...");
  const res = await run(GDC_WF.SUBMIT, { operation: "SUBMIT", gd_id: data.id, source: "FORM", answers: answers, form: data });
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    release();
    this.$message.error("No response from workflow. Please contact support.");
    return;
  }
  const message = r.message || "";
  if (r.route === "QUEUED") {
    release();
    this.hide(["button_save_as_draft", "button_save_as_created", "button_save_as_completed"]);
    this.$message.success("Goods Delivery " + (r.gd_no || "") + " is being completed in the background.");
    closeDialog();
    try {
      this.runWorkflow(
        GDC_WF.WORKER,
        { job_id: r.job_id },
        (w) => {
          console.log("GD Completion V2: worker finished", w);
          // refresh only - by now another delivery may be open in the dialog
          if (this.parentGenerateForm) this.parentGenerateForm.refresh();
        },
        (e) => console.error("GD Completion V2: worker start failed - the list starts it again", e),
      );
    } catch (e) {
      console.error("GD Completion V2: worker could not be started - the list starts it again", e);
    }
    return;
  }
  if (r.route === "NOT_ELIGIBLE") return classic(r.reason || message);
  if (r.route === "BUSY") {
    release();
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
  if (code === "412") {
    this.hideLoading();
    const yes = await confirm(message || "This delivery will be invoiced automatically on completion. Auto-create the Sales Invoice?",
      "Auto-create Sales Invoice", "Yes, create invoice", "No, complete only", "info");
    return submit(data, yes ? { ...answers, auto_si_confirmed: "true" } : { ...answers, auto_si_skip: "true" });
  }
  if (code === "406") {
    // Force Complete: the classic save's prompt, then V2 completes the delivery and closes its Picking rows
    if (FORCE_COMPLETE_V2_ENABLED !== true || answers.isForceComplete === "Yes") return classic("406: picking not completed");
    this.hideLoading();
    if (!(await confirm(message || "Picking is currently under In Progress status.\nProceeding will force complete picking process.\n\nWould you like to proceed?", "", "Proceed", "Cancel", "warning"))) return release();
    return submit(data, { ...answers, isForceComplete: "Yes" });
  }
  release();
  if (code === "402") return alertBox((message || "Credit limit exceeded").replace(/^Block - /, ""), "error");
  if (code === "405" || code === "407") return alertBox(message, "warning");
  this.$message.error(message || "Failed to save Goods Delivery. Please contact support.");
};

(async () => {
  try {
    if (this.models["_data"]?.is_processing === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    const data = this.getValues();
    if (ASYNC_COMPLETE_ENABLED !== true) return classic("switched off (ASYNC_COMPLETE_ENABLED)");
    if (!data.id || data.page_status !== "Edit") return classic("not a saved delivery (page " + data.page_status + ")");
    this.models["_data"] = { ...this.models["_data"], is_processing: 1 };
    await submit(data, { needCL: "required", continueZero: "", isForceComplete: "", auto_si_confirmed: "", auto_si_skip: "" });
  } catch (error) {
    release();
    console.error("GD Completion V2 error:", error);
    this.$message.error(error.message || "Failed to save Goods Delivery. Please contact support.");
  }
})();
