// grc_onClick_completed - Goods Receiving form, onClick of button_save_as_comp (Save as Completed).
// GR Completion V2: GR_COMPLETE_SUBMIT decides. QUEUED -> the dialog closes and GR_COMPLETE_WORKER is started (there is
// no scheduled worker: this start, and the list's, are what move the job). NOT_ELIGIBLE -> the classic
// onClick_workflowCompleted, unchanged. Everything SUBMIT stops on carries GOODS_RECEIVING's own code and text.
const GRC_WF = {
  SUBMIT: "2110545633913245697", // GR_COMPLETE_SUBMIT
  WORKER: "2110545675948560386", // GR_COMPLETE_WORKER
};
// Switch: false = every click runs the classic save
const ASYNC_COMPLETE_ENABLED = true;
const GRC_MAX_LINES = 2500;

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
  this.models["_data"] = { ...this.models["_data"], grc_submitting: 0 };
  this.hideLoading();
};

// the classic save, exactly as the button ran it before
const classic = async (why) => {
  console.log("GR Completion V2: classic save -", why);
  release();
  await this.triggerEvent("onClick_workflowCompleted");
};

// the record as the server takes it: dialogs, helper models and the workflow-owned keys are not record fields
const NOT_RECORD = ["gr_v2_job_id", "gr_idem_key", "_data", "dialog_select_item", "dialog_formula", "confirm_split_dialog", "split_dialog", "hu_dialog", "dialog_serial_number"];
const recordOf = (values) => {
  const out = { ...values };
  NOT_RECORD.forEach((k) => delete out[k]);
  return out;
};

// one key per click and content: a lost answer re-sent with the same key finds the same job; new content or a failed job
// gets the next generation (a new key, a new job)
const idemKey = (data, gen) => {
  const canon = (v) => {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  };
  const hash = (text) => {
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
  let token = (this.models["_data"] || {}).grc_page_token;
  if (!token) {
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    this.models["_data"] = { ...this.models["_data"], grc_page_token: token };
  }
  const doc = data.page_status === "Edit" && data.id ? String(data.id) : "new-" + token;
  return ("GRC:" + String(data.organization_id || "") + ":" + doc + ":" + hash(canon(data)) + ":" + gen).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
};

const kick = (jobId) => {
  try {
    this.runWorkflow(
      GRC_WF.WORKER,
      { job_id: jobId },
      (w) => {
        console.log("GR Completion V2: worker finished", w);
        if (this.parentGenerateForm) this.parentGenerateForm.refresh();
      },
      (e) => console.error("GR Completion V2: worker start failed - the list starts it again", e),
    );
  } catch (e) {
    console.error("GR Completion V2: worker could not be started - the list starts it again", e);
  }
};

const submit = async (data, answers, gen) => {
  this.showLoading("Saving Goods Receiving as Completed...");
  const params = { operation: "SUBMIT", page_status: data.page_status, gr_id: data.page_status === "Edit" ? data.id : "", idempotency_key: idemKey(data, gen), answers: answers, form: data };
  let res = null;
  try {
    res = await run(GRC_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("GR Completion V2: submit failed, repeating once with the same key", e);
    res = await run(GRC_WF.SUBMIT, params);
  }
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    release();
    this.$message.error("No response from workflow. Please contact support.");
    return;
  }
  const message = r.message || "";
  if (r.route === "QUEUED" || (r.route === "STATUS" && ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GR"].indexOf(r.job_status) >= 0)) {
    release();
    this.models["_data"] = { ...this.models["_data"], grc_page_token: null, grc_gen: 1 };
    this.hide(["button_save_as_draft", "button_save_as_created", "button_save_as_comp"]);
    this.$message.success("Goods Receiving " + (r.gr_no || "") + " is being completed in the background.");
    closeDialog();
    kick(r.job_id);
    return;
  }
  if (r.route === "STATUS" && r.job_status === "COMPLETED") {
    release();
    this.$message.success("Goods Receiving " + (r.gr_no || "") + " is already completed.");
    closeDialog();
    return;
  }
  if (r.route === "STATUS" && r.job_status === "FAILED") {
    // the same content failed before: tell why, and let the next click try again with a new key
    release();
    this.models["_data"] = { ...this.models["_data"], grc_gen: gen + 1 };
    this.$message.error(r.error_message || r.progress_message || "The previous completion of this receipt failed.");
    return;
  }
  if (r.route === "NOT_ELIGIBLE") return classic(r.reason || message);
  if (r.route === "BUSY" || r.route === "STATUS") {
    release();
    this.$message.warning(message || r.progress_message || "This Goods Receiving is being processed - please wait for it to finish.");
    return;
  }
  const code = String(r.code);
  if (r.route === "STOP" && code === "401") {
    this.hideLoading();
    try {
      await this.$confirm(message || "Some lines have zero receive quantity. Would you like to proceed?", "", {
        confirmButtonText: "Proceed", cancelButtonText: "Cancel", type: "warning", dangerouslyUseHTMLString: true,
      });
    } catch (e) {
      return release();
    }
    return submit(data, { ...answers, continueZero: "Yes" }, gen);
  }
  release();
  this.$message.error(message || "Failed to save Goods Receiving");
};

(async () => {
  try {
    if ((this.models["_data"] || {}).grc_submitting === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    const data = recordOf(this.getValues());
    if (ASYNC_COMPLETE_ENABLED !== true || GRC_WF.SUBMIT === "0") return classic("switched off (ASYNC_COMPLETE_ENABLED)");
    if (["Add", "Edit"].indexOf(data.page_status) < 0 || (data.page_status === "Edit" && !data.id)) return classic("page " + data.page_status);
    const lines = (data.table_gr || []).reduce((n, r) => n + 1 + (Array.isArray(r.children) ? r.children.length : 0), 0);
    if (lines > GRC_MAX_LINES) {
      this.$message.error("This Goods Receiving has " + lines + " lines. The maximum is " + GRC_MAX_LINES + " lines per receipt. Please split it into smaller receipts.");
      return;
    }
    this.models["_data"] = { ...this.models["_data"], grc_submitting: 1 };
    await submit(data, { continueZero: "" }, Number((this.models["_data"] || {}).grc_gen) || 1);
  } catch (error) {
    release();
    console.error("GR Completion V2 error:", error);
    this.$message.error(error.message || "Failed to save Goods Receiving");
  }
})();
