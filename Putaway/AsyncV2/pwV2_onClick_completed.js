// pwV2_onClick_completed - Putaway form, onClick of button_completed (Completed).
// Putaway Completion V2: PUTAWAY_ASYNC_SUBMIT decides. QUEUED -> the dialog closes and PUTAWAY_ASYNC_WORKER is started (there
// is no scheduled worker: this start, the open form's and the list's are what move the job). NOT_ELIGIBLE -> the classic
// onClick_workflowComplete, unchanged. mounted calls it with { pwv2_mode: "STATUS_ON_OPEN" } to show an open job.
const PWV2_WF = {
  SUBMIT: "2110545826201112577", // PUTAWAY_ASYNC_SUBMIT
  WORKER: "2110545857423511553", // PUTAWAY_ASYNC_WORKER
};
// Switch: false = every click runs the classic save
const ASYNC_PUTAWAY_ENABLED = true;
const PWV2_MAX_ROWS = 2500;
const PWV2_RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PUTAWAY"];
const SAVE_BUTTONS = ["button_save_as_draft", "button_inprogress", "button_completed"];
const statusOnOpen = !!(arguments[0] && arguments[0].pwv2_mode === "STATUS_ON_OPEN");

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

const store = (patch) => {
  this.models["_data"] = { ...this.models["_data"], ...patch };
};

const release = () => {
  store({ pwv2_submitting: 0 });
  this.hideLoading();
};

// the classic save, exactly as the button ran it before
const classic = async (why) => {
  console.log("Putaway Completion V2: classic save -", why);
  release();
  await this.triggerEvent("onClick_workflowComplete");
};

const str = (v) => (v === undefined || v === null ? "" : String(v));

// the confirmation: per row to put away its stored line (id), or for a split row the split line (parent_id), in table order
const confirmationOf = (rows) => {
  const lines = [];
  for (const row of rows) {
    if (row.line_status === "Cancelled") continue;
    if (row.parent_or_child === "Parent" && row.is_split === "Yes") continue;
    const qty = parseFloat(row.putaway_qty) || 0;
    if (qty <= 0) continue;
    const entry = {};
    if (row.parent_or_child === "Child" && str(row.parent_line_id)) entry.parent_id = str(row.parent_line_id);
    else if (str(row.id)) entry.id = str(row.id);
    else return { lines: lines, unexpressible: true };
    entry.qty = qty;
    ["target_location", "storage_location", "target_inv_category", "remark"].forEach((f) => {
      if (row[f] !== undefined && row[f] !== null) entry[f] = str(row[f]);
    });
    lines.push(entry);
  }
  return { lines: lines, unexpressible: false };
};

// the putaway's attachments as the form shows them (the whole list): saved with the confirmation
const refDocOf = (v) => {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch (e) {
      x = null;
    }
  }
  return Array.isArray(x) ? x : null;
};

// one key per click and content (the putaway as opened + the confirmation): a lost answer re-sent with the same key finds
// the same job; a failed job gets the next generation (a new key, a new job)
const idemKey = (data, lines, gen) => {
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
  const content = { to_id: str(data.id), update_time: str(data.update_time), lines: lines, ref_doc: refDocOf(data.ref_doc) };
  return ("PWC:" + str(data.organization_id) + ":" + str(data.id) + ":" + hash(canon(content)) + ":" + gen).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
};

const kick = (jobId) => {
  try {
    this.runWorkflow(
      PWV2_WF.WORKER,
      { job_id: jobId },
      (w) => {
        console.log("Putaway Completion V2: worker finished", w);
        if (this.parentGenerateForm) this.parentGenerateForm.refresh();
      },
      (e) => console.error("Putaway Completion V2: worker start failed - the list starts it again", e),
    );
  } catch (e) {
    console.error("Putaway Completion V2: worker could not be started - the list starts it again", e);
  }
};

const submit = async (data, lines, gen) => {
  this.showLoading("Saving Putaway as Completed...");
  const params = {
    operation: "SUBMIT",
    to_id: str(data.id),
    idempotency_key: idemKey(data, lines, gen),
    confirmed_by: this.getVarGlobal("nickname"),
    request: refDocOf(data.ref_doc) ? { source: "FORM", lines: lines, ref_doc: refDocOf(data.ref_doc) } : { source: "FORM", lines: lines },
  };
  let res = null;
  try {
    res = await run(PWV2_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("Putaway Completion V2: submit failed, repeating once with the same key", e);
    res = await run(PWV2_WF.SUBMIT, params);
  }
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    release();
    this.$message.error("No response from workflow. Please contact support.");
    return;
  }
  const message = r.message || "";
  const jobStatus = str(r.job_status);
  const toNo = r.to_no || data.to_id || "";
  if (r.route === "QUEUED" || (r.route === "STATUS" && PWV2_RUNNING.indexOf(jobStatus) >= 0)) {
    release();
    store({ pwv2_gen: 1 });
    this.hide(SAVE_BUTTONS);
    this.$message.success("Putaway " + toNo + " is being completed in the background.");
    closeDialog();
    kick(r.job_id);
    return;
  }
  if (r.route === "STATUS" && jobStatus === "COMPLETED") {
    release();
    this.$message.success("Putaway " + toNo + " is already completed.");
    closeDialog();
    return;
  }
  if (r.route === "STATUS" && jobStatus === "FAILED") {
    // the same content failed before: tell why, and let the next click try again with a new key
    release();
    store({ pwv2_gen: gen + 1 });
    this.$message.error(r.error_message || r.progress_message || "The previous completion of this putaway failed.");
    return;
  }
  if (r.route === "NOT_ELIGIBLE") return classic(r.reason || message);
  if (r.route === "BUSY" || r.route === "STATUS") {
    release();
    this.$message.warning(message || r.progress_message || "This putaway is being processed - please wait for it to finish.");
    return;
  }
  release();
  this.$message.error(message || "Failed to save Putaway");
};

// on open: a running job hides the save buttons and is started again; a failed one is reported once per browser
const showOpenJob = async () => {
  if (ASYNC_PUTAWAY_ENABLED !== true || PWV2_WF.SUBMIT === "0") return;
  const toId = str(this.getValue("id"));
  if (!toId) return;
  const res = await run(PWV2_WF.SUBMIT, {
    operation: "STATUS",
    to_id: toId,
    idempotency_key: "PWS:" + str(this.getValue("organization_id")) + ":" + toId,
    confirmed_by: "",
    request: { source: "FORM", lines: [] },
  });
  const r = (res && res.data) || {};
  const jobStatus = str(r.job_status);
  if (r.route !== "STATUS" || !str(r.job_id)) return;
  if (PWV2_RUNNING.indexOf(jobStatus) >= 0 || jobStatus === "REQUIRES_REVIEW") {
    this.hide(SAVE_BUTTONS);
    if (jobStatus === "REQUIRES_REVIEW") {
      this.$message.warning("The background completion of this putaway stopped half-way and is under review: please contact support.");
      return;
    }
    this.$message.warning("This putaway is being completed in the background (" + (r.progress_message || jobStatus) + ").");
    kick(r.job_id);
    return;
  }
  if (jobStatus === "FAILED") {
    let seen = false;
    try {
      const key = "pwv2_failed_seen_" + str(r.job_id);
      seen = localStorage.getItem(key) === "1";
      localStorage.setItem(key, "1");
    } catch (e) {}
    if (!seen) this.$message.warning("The last background completion of this putaway failed: " + (r.error_message || r.progress_message || jobStatus));
  }
};

(async () => {
  try {
    if (statusOnOpen) {
      await showOpenJob().catch((e) => console.error("Putaway Completion V2: status on open failed", e));
      return;
    }
    if ((this.models["_data"] || {}).pwv2_submitting === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    if (ASYNC_PUTAWAY_ENABLED !== true || PWV2_WF.SUBMIT === "0") return classic("switched off (ASYNC_PUTAWAY_ENABLED)");
    const data = {
      id: this.getValue("id"),
      to_id: this.getValue("to_id"),
      page_status: this.getValue("page_status"),
      to_status: this.getValue("to_status"),
      organization_id: this.getValue("organization_id"),
      update_time: this.getValue("update_time"),
      ref_doc: this.getValue("ref_doc"),
    };
    const rows = this.getValue("table_putaway_item") || [];
    if (data.page_status !== "Edit" || !str(data.id) || data.to_status === "Draft") return classic("page " + data.page_status + " / " + data.to_status);
    // the classic's own handling-unit check and the bundle tree stay with the classic save
    if (rows.some((r) => str(r.hu_data) !== "")) return classic("handling units");
    if (rows.some((r) => str(r.item_bundle_id) !== "" || (Array.isArray(r.children) && r.children.length > 0))) return classic("item bundles");
    const conf = confirmationOf(rows);
    if (conf.unexpressible) return classic("a row without a stored line id");
    if (conf.lines.length === 0) {
      this.$message.error("Cannot complete putaway. At least one item must have putaway quantity greater than 0.");
      return;
    }
    if (conf.lines.length > PWV2_MAX_ROWS) {
      this.$message.error("This confirmation has " + conf.lines.length + " rows to put away. At most " + PWV2_MAX_ROWS + " rows can be confirmed at once: please confirm part of the lines first.");
      return;
    }
    store({ pwv2_submitting: 1 });
    await submit(data, conf.lines, Number((this.models["_data"] || {}).pwv2_gen) || 1);
  } catch (error) {
    release();
    console.error("Putaway Completion V2 error:", error);
    this.$message.error(error.message || "Failed to save Putaway");
  }
})();
