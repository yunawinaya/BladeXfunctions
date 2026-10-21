// Stock Movement V2: a transfer saved in the background stays Processing (read-only) until its job ends; opening it re-kicks
// the worker and follows the job. A failed background save is reported once per browser.
const LOT_BG_WF = {
  STATUS: "__LOT_V2_SUBMIT__", // LOT_V2_SUBMIT (operation STATUS)
  WORKER: "__LOT_V2_WORKER__", // LOT_V2_WORKER
};
const LOT_BG_POLL_MS = 3000;
const LOT_BG_KICK_MS = 15000;
const LOT_BG_WAIT_MS = 180000;

/*@@FINGERPRINT@@*/

// the lines as the form opened them: a Completed click compares against it (COMPLETE vs COMPLETE_EDITED)
const rememberLines = (data) => {
  try {
    this.models["_data"] = { ...this.models["_data"], lot_mount_fp: lotLineFingerprint(data.stock_movement || []) };
  } catch (error) {
    console.error("Background save: line fingerprint failed", error);
  }
};

const lotBgRun = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(
      id,
      params,
      (res) => resolve(res),
      (err) => reject(err),
    );
  });

const lotBgStatus = async (lotId) => {
  try {
    const res = await lotBgRun(LOT_BG_WF.STATUS, { operation: "STATUS", saveAs: "", pageStatus: "Edit", lot_id: String(lotId), idempotency_key: "", source: "FORM", form: {} });
    return (res && res.data) || null;
  } catch (error) {
    console.error("Background save: status check failed", error);
    return null;
  }
};

const lotFailedSeen = (jobId) => {
  let seen = false;
  try {
    const key = "lot_v2_failed_seen_" + jobId;
    seen = localStorage.getItem(key) === "1";
    localStorage.setItem(key, "1");
  } catch (e) {}
  return seen;
};

const lotAlert = (message, title, type) => this.$alert(message, title, { confirmButtonText: "OK", type: type }).catch(() => {});

const followBackgroundSave = async (lotId, lotNo, jobIdOnRecord) => {
  const name = ("Location Transfer " + (lotNo || "")).trim();
  if (LOT_BG_WF.STATUS === "0" || LOT_BG_WF.WORKER === "0") {
    this.$message.warning(name + " is being processed. It is read-only until that finishes.");
    return;
  }
  const kick = (jobId) => {
    try {
      this.runWorkflow(
        LOT_BG_WF.WORKER,
        { job_id: String(jobId) },
        () => {},
        (error) => console.error("Background save: worker start failed", error),
      );
    } catch (error) {
      console.error("Background save: worker could not be started", error);
    }
  };
  const refreshList = () => {
    if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  };
  const deadline = Date.now() + LOT_BG_WAIT_MS;
  let kickedAt = 0;
  let s = await lotBgStatus(lotId);
  for (;;) {
    // no job holds it (any more): stop following - the transfer on screen may be out of date
    if (s && (s.job_status === "NONE" || (String(s.terminal) === "YES" && !s.job_id))) {
      // a new transfer whose save stopped before it was linked to its job is released only when that job is worked
      if (/^[0-9]{1,20}$/.test(String(jobIdOnRecord || "").trim())) kick(String(jobIdOnRecord).trim());
      refreshList();
      this.$message.warning(name + " is not being saved in the background any more. Close it and open it again to see its current state.");
      return;
    }
    if (s && s.job_id) {
      const st = s.job_status;
      if (st === "COMPLETED") {
        this.$message.success(name + " has been saved. Reopen it to see the result.");
        refreshList();
        return;
      }
      if (st === "FAILED" || st === "CANCELLED") {
        refreshList();
        if (lotFailedSeen(s.job_id)) return;
        const reason = String(s.error_message || s.error_code || "No reason was given.").trim();
        await lotAlert(reason + (/[.!?]$/.test(reason) ? "" : ".") + " Reopen it to continue.", name + " was not saved", "error");
        return;
      }
      if (st === "REQUIRES_REVIEW") {
        await lotAlert(
          "It stopped part-way through its save and needs a review before it can be changed. Please contact support." + (s.error_message ? " (" + s.error_message + ")" : ""),
          name + " needs a review",
          "warning",
        );
        return;
      }
      // a job waiting out a retry backoff, a stock-lock wait or a parked second phase moves only when kicked again
      if (!kickedAt || Date.now() - kickedAt >= LOT_BG_KICK_MS) {
        if (!kickedAt) this.$message.info(name + " is being saved in the background. It is read-only until that finishes.");
        kickedAt = Date.now();
        kick(s.job_id);
      }
    }
    if (Date.now() >= deadline) {
      this.$message.info(name + " is still being processed in the background. Reopen it later.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, LOT_BG_POLL_MS));
    s = await lotBgStatus(lotId);
  }
};

// a transfer a background save once held (lot_v2_job_id) and released: its failure is shown once per browser
const showLastBackgroundFailure = async (lotId, jobId, lotNo) => {
  if (LOT_BG_WF.STATUS === "0") return;
  try {
    if (localStorage.getItem("lot_v2_failed_seen_" + jobId) === "1") return;
  } catch (e) {
    return;
  }
  const s = await lotBgStatus(lotId);
  if (!s || !s.job_id || ["FAILED", "CANCELLED", "COMPLETED"].indexOf(s.job_status) < 0) return;
  if (lotFailedSeen(s.job_id) || s.job_status === "COMPLETED") return;
  const reason = String(s.error_message || s.error_code || "No reason was given.").trim();
  this.$message.warning(("Location Transfer " + (lotNo || "")).trim() + ": its last background save failed - " + reason);
};

const lotBackgroundView = (pageStatus, data) => {
  if (pageStatus !== "Edit" && pageStatus !== "View") return;
  if (data.stock_movement_status === "Processing") {
    followBackgroundSave(data.id, data.stock_movement_no, data.lot_v2_job_id);
    return;
  }
  const jobId = String(data.lot_v2_job_id || "").trim();
  if (/^[0-9]{1,20}$/.test(jobId) && (data.stock_movement_status === "Draft" || data.stock_movement_status === "In Progress")) {
    showLastBackgroundFailure(data.id, jobId, data.stock_movement_no);
  }
};

