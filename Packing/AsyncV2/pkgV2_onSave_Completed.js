// Packing form - Save as Completed through the background save (PACKING_ASYNC_SUBMIT -> PACKING_ASYNC_WORKER).
// Pending HUs are completed one at a time here (TableHUCompleted in bulk mode) and the Packing is written once; the
// completion itself (stock into the HUs, reservations, GD lines, SO, Packing status) runs in the background. A new or Draft
// Packing, one with no Goods Delivery, or what the server answers NOT_ELIGIBLE runs the old onSave_Completed unchanged.
// The workflow ids are dev ids.
const PKG_V2_WF = {
  SUBMIT: "2109924558618333185",
  WORKER: "2109924593737240578",
};
const ASYNC_PACKING_ENABLED = true;
const HEADER_FIELDS = ["remarks", "remarks_2", "remarks_3", "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no", "di_shipping_company", "di_transport_name",
  "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection", "di_tracking_number", "di_freight_charges"];
const EPS = 0.001;

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const showErrors = (errors) => {
  const preview = errors.slice(0, 3).join("; ");
  const suffix = errors.length > 3 ? ` (+${errors.length - 3} more)` : "";
  this.$message.warning(`Cannot complete packing: ${preview}${suffix} — Use "Save as Created" to keep your progress and complete later.`);
};

// One workflow call as a promise that always settles: { ok, data } or { ok: false, error }.
const pkgV2Call = (workflowId, params) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        workflowId,
        params,
        (res) => resolve(res && res.data ? { ok: true, data: res.data } : { ok: false, error: "the answer carries no data" }),
        (err) => resolve({ ok: false, error: (err && (err.message || err.msg)) || String(err) }),
      );
    } catch (e) {
      resolve({ ok: false, error: e.message || String(e) });
    }
  });

// Follow one background completion: start the worker for the job until it ends or 10 minutes pass. The answer carries no
// next-attempt time, so a lock retry waits the server's backoff (2 s doubling to 30 s), an operation still running 10 s, the
// hand-over after the stock call 1.5 s; a start that did not take the job (not due yet / another run has it) reads the job
// through SUBMIT STATUS. One follower per job in this browser.
const PKG_V2_OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PACKING"];
const pkgV2FollowJob = (jobId, packingId, organizationId, onEnd) => {
  let following = {};
  try {
    following = window.__pkgV2Following = window.__pkgV2Following || {};
  } catch (e) {
    following = {};
  }
  if (following[jobId]) return;
  following[jobId] = 1;
  const until = Date.now() + 10 * 60 * 1000;
  let idle = 0;
  const step = async () => {
    const res = await pkgV2Call(PKG_V2_WF.WORKER, { job_id: jobId });
    const w = res.ok ? res.data || {} : {};
    let st = String(w.job_id || "") === jobId ? String(w.job_status || "") : "";
    let msg = String(w.result_message || "");
    let attempts = 0;
    try {
      attempts = Number((JSON.parse(w.jobs || "[]")[0] || {}).attempt_count) || 0;
    } catch (e) {
      attempts = 0;
    }
    if (!st) {
      const s = await pkgV2Call(PKG_V2_WF.SUBMIT, { packing_id: packingId, organization_id: organizationId, operation: "STATUS" });
      if (s.ok && String((s.data || {}).job_id || "") === jobId) {
        st = String(s.data.job_status || "");
        msg = String(s.data.result_message || msg);
      }
      idle += 1;
    } else idle = 0;
    if (st && PKG_V2_OPEN.indexOf(st) < 0) {
      delete following[jobId];
      return onEnd(st, msg);
    }
    if (Date.now() > until) {
      delete following[jobId];
      return;
    }
    const code = String(w.result_code || "");
    const wait = code === "PK_INVENTORY_IN_PROGRESS" ? 10000 : /RETRY/.test(code) ? Math.min(30000, 2000 * Math.pow(2, Math.max(0, attempts - 1))) + 500 : idle ? Math.min(30000, 3000 * idle) : 1500;
    setTimeout(step, wait);
  };
  step();
};

const setFlag = (k, v) => {
  this.models["_data"] = { ...this.models["_data"], [k]: v };
};

const oldPath = async (why) => {
  console.log("Packing V2: the classic save -", why);
  await this.triggerEvent("onSave_Completed");
};

// triggerEvent does not wait for the handler: TableHUCompleted (bulk) reports through _data, one HU at a time, so the
// packaging stock and the HU numbers are never raced
const completePendingHus = async (indexes) => {
  for (const i of indexes) {
    const row = (this.getValue("table_hu") || [])[i];
    if (!row || row.hu_status === "Completed" || !row.temp_data || row.temp_data === "[]") continue;
    const flag = "pkgv2_hu_" + i;
    setFlag(flag, "");
    this.showLoading("Completing HU " + (row.handling_no || i + 1) + "...");
    await this.triggerEvent("TableHUCompleted", { row: row, rowIndex: i, bulk: 1 });
    const t0 = Date.now();
    let res = "";
    while (!res && Date.now() - t0 < 180000) {
      await new Promise((r) => setTimeout(r, 300));
      res = String((this.models["_data"] || {})[flag] || "");
    }
    if (res !== "OK") return { ok: false, error: "HU " + (row.handling_no || i + 1) + ": " + (res ? res.replace(/^ERR:/, "") : "no answer after 3 minutes") };
  }
  return { ok: true };
};

// the one Packing write of the bulk completion: the ledger of completed HUs, as TableHUCompleted writes it
const writeLedger = async (packingId) => {
  await db
    .collection("packing")
    .doc(packingId)
    .update({
      table_hu: (this.getValue("table_hu") || []).filter((r) => r.hu_status === "Completed"),
      table_hu_source: this.getValue("table_hu_source") || [],
      table_item_source: this.getValue("table_item_source") || [],
    });
};

(async () => {
  let data = this.getValues();
  try {
    if ((this.models["_data"] || {}).pkgv2_submitting === 1) {
      this.$message.warning("A save request is already being sent. Please wait.");
      return;
    }
    if (!ASYNC_PACKING_ENABLED || !PKG_V2_WF.SUBMIT || PKG_V2_WF.SUBMIT.indexOf("__") === 0) return oldPath("switched off");
    if (data.page_status === "Add" || !data.id) return oldPath("a new Packing");
    if (data.packing_status === "Draft") return oldPath("a Draft Packing");
    if (!data.gd_id) return oldPath("no Goods Delivery");

    // ---- the form's own checks (the server checks again)
    const preErrors = [];
    for (const r of data.table_item_source || []) {
      const remaining = parseFloat(r.remaining_qty) || 0;
      if (remaining > EPS || r.line_status !== "Fully Picked") preErrors.push(`Item ${r.item_name || r.id || "(?)"} is not fully packed.`);
    }
    if (preErrors.length > 0) return showErrors(preErrors);
    if ((data.table_hu || []).length === 0) {
      this.$message.error("Packing has no HU rows to complete.");
      return;
    }

    // ---- pending HUs: completed one at a time, the Packing written once
    const pending = [];
    (data.table_hu || []).forEach((r, i) => {
      if (r.hu_status !== "Completed" && r.temp_data && r.temp_data !== "[]") pending.push(i);
    });
    if (pending.length > 0) {
      try {
        await this.$confirm(`${pending.length} HU(s) are not yet completed. Complete them now as part of finalizing this packing?`, "Confirm Complete All", {
          confirmButtonText: "Complete All",
          cancelButtonText: "Cancel",
          type: "warning",
        });
      } catch {
        return;
      }
      setFlag("pkgv2_submitting", 1);
      let done;
      try {
        done = await completePendingHus(pending);
      } finally {
        // what was completed is kept even when a later HU failed
        try {
          await writeLedger(data.id);
        } catch (e) {
          console.error("Packing V2: the Packing could not be written", e);
          done = { ok: false, error: "the Packing could not be saved (" + (e.message || e) + ")" };
        }
        setFlag("pkgv2_submitting", 0);
        this.hideLoading();
      }
      if (!done.ok) {
        this.$message.error("Not completed: " + done.error + ". The HUs completed so far are saved; fix it and press Save as Completed again.");
        return;
      }
      data = this.getValues();
    }

    const postErrors = [];
    for (const r of data.table_hu || []) {
      if (!r.temp_data || r.temp_data === "[]") continue;
      if (r.hu_status !== "Completed") postErrors.push(`HU ${r.handling_no || "(unnumbered)"} is not completed.`);
    }
    for (const r of data.table_hu_source || []) {
      if (r.row_type === "header" && r.hu_status !== "Completed") postErrors.push(`Source HU ${r.handling_no || r.handling_unit_id || "(?)"} is not completed.`);
    }
    if (postErrors.length > 0) return showErrors(postErrors);

    // ---- the submit
    const headerPatch = {};
    for (const k of HEADER_FIELDS) if (data[k] !== undefined) headerPatch[k] = data[k];
    let organizationId = String(data.organization_id || "");
    if (!organizationId) {
      organizationId = String(this.getVarGlobal("deptParentId") || "");
      if (!organizationId || organizationId === "0") organizationId = String(this.getVarSystem("deptIds") || "").split(",")[0];
    }
    // one key per click: a retry of a click that got no answer reuses it, so the same completion is never queued twice
    let key = (this.models["_data"] || {}).pkgv2_key;
    if (!key) {
      key = "PKG-" + data.id + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      setFlag("pkgv2_key", key);
    }
    const params = { packing_id: String(data.id), organization_id: organizationId, operation: "COMPLETE", idempotency_key: key, header_patch: JSON.stringify(headerPatch),
      submitted_name: this.getVarGlobal("nickname") || "" };
    setFlag("pkgv2_submitting", 1);
    this.showLoading("Submitting Packing...");
    let res;
    try {
      res = await pkgV2Call(PKG_V2_WF.SUBMIT, params);
      if (!res.ok) res = await pkgV2Call(PKG_V2_WF.SUBMIT, params);
    } finally {
      setFlag("pkgv2_submitting", 0);
      this.hideLoading();
    }
    if (!res || !res.ok) {
      this.$message.error("The save request did not complete (" + ((res && res.error) || "no answer") + "). Press the button again: the same packing is never saved twice.");
      return;
    }
    const out = res.data;
    if (out.route === "NOT_ELIGIBLE") {
      setFlag("pkgv2_key", null);
      return oldPath(out.result_message);
    }
    if (String(out.result_code) !== "200" || !out.job_id) {
      setFlag("pkgv2_key", null);
      this.$message.error(out.result_message || "The Packing could not be submitted.");
      return;
    }
    setFlag("pkgv2_key", null);
    this.$message.success("Packing submitted. It is being completed in the background; reopen it in a moment.");
    closeDialog();
    // no worker is scheduled on the server: this browser starts it until the job ends; a job left open (browser closed) is
    // taken by the next open of any Packing
    pkgV2FollowJob(String(out.job_id), String(data.id), organizationId, (st, msg) => {
      if (this.parentGenerateForm) this.parentGenerateForm.refresh();
      if (st === "COMPLETED") this.$message.success("Packing " + (data.packing_no || "") + " completed.");
      else if (st === "FAILED") this.$message.error("Packing " + (data.packing_no || "") + " was not completed: " + (msg || "unknown reason"));
      else if (st === "REQUIRES_REVIEW") this.$message.error("Packing " + (data.packing_no || "") + " stopped half-way and is under review: " + msg + " Please contact support.");
    });
  } catch (error) {
    setFlag("pkgv2_submitting", 0);
    this.hideLoading();
    console.error("Packing V2 save error:", error);
    this.$message.error(error.message || "Failed to save Packing");
  }
})();