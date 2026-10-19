// SA V2: a Stock Adjustment completed in the background stays Processing (read-only) until its job ends; opening it re-kicks
// the worker and follows the job. A failed background completion is reported once per browser. While ASYNC_SA_ENABLED is
// false (or a workflow id is not set) nothing here calls a workflow or touches browser storage.
const SA_BG_WF = {
  STATUS: "__SA_V2_SUBMIT__", // SA_V2_SUBMIT (operation STATUS)
  WORKER: "__SA_V2_WORKER__", // SA_V2_WORKER
};
// the Completed buttons' switch
const SA_BG_ENABLED = __ASYNC_SA_ENABLED__;
const SA_BG_POLL_MS = 3000;
const SA_BG_KICK_MS = 15000;
const SA_BG_WAIT_MS = 180000;

const saBgOn = () =>
  SA_BG_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SA_BG_WF.STATUS) && /^[1-9][0-9]{0,19}$/.test(SA_BG_WF.WORKER);

const saBgRun = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(
      id,
      params,
      (res) => resolve(res),
      (err) => reject(err),
    );
  });

const saBgStatus = async (saId, orgId) => {
  try {
    const res = await saBgRun(SA_BG_WF.STATUS, {
      operation: "STATUS",
      source: "FORM",
      saveAs: "Completed",
      pageStatus: "Edit",
      sa_id: String(saId),
      sc_id: "",
      idempotency_key: "",
      form: {},
      organization_id: String(orgId || ""),
      nickname: "",
      adjustment_date: "",
      create_adjustment: "",
    });
    return (res && res.data) || null;
  } catch (error) {
    console.error("Background completion: status check failed", error);
    return null;
  }
};

const saFailedSeen = (jobId) => {
  let seen = false;
  try {
    const key = "sa_v2_failed_seen_" + jobId;
    seen = localStorage.getItem(key) === "1";
    localStorage.setItem(key, "1");
  } catch (e) {}
  return seen;
};

const saBgAlert = (message, title, type) => this.$alert(message, title, { confirmButtonText: "OK", type: type }).catch(() => {});

const saFollowBackground = async (saId, saNo, orgId, jobIdOnRecord) => {
  const name = ("Stock Adjustment " + (saNo || "")).trim();
  const kick = (jobId) => {
    try {
      this.runWorkflow(
        SA_BG_WF.WORKER,
        { job_id: String(jobId) },
        () => {},
        (error) => console.error("Background completion: worker start failed", error),
      );
    } catch (error) {
      console.error("Background completion: worker could not be started", error);
    }
  };
  const refreshList = () => {
    if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  };
  const deadline = Date.now() + SA_BG_WAIT_MS;
  let kickedAt = 0;
  let s = await saBgStatus(saId, orgId);
  for (;;) {
    // no job holds it (any more): stop following - the adjustment on screen may be out of date
    if (s && (s.job_status === "NONE" || (String(s.terminal) === "YES" && !s.job_id))) {
      // a new adjustment whose completion stopped before it was linked to its job is released only when that job is worked
      if (/^[0-9]{1,20}$/.test(String(jobIdOnRecord || "").trim())) kick(String(jobIdOnRecord).trim());
      refreshList();
      this.$message.warning(name + " is not being completed in the background any more. Close it and open it again to see its current state.");
      return;
    }
    if (s && s.job_id) {
      const st = s.job_status;
      if (st === "COMPLETED") {
        this.$message.success(name + " has been completed. Reopen it to see the result.");
        refreshList();
        return;
      }
      if (st === "FAILED" || st === "CANCELLED") {
        refreshList();
        if (saFailedSeen(s.job_id)) return;
        const reason = String(s.error_message || s.error_code || "No reason was given.").trim();
        await saBgAlert(reason + (/[.!?]$/.test(reason) ? "" : ".") + " Reopen it to continue.", name + " was not completed", "error");
        return;
      }
      if (st === "REQUIRES_REVIEW") {
        await saBgAlert(
          "It stopped part-way through its completion and needs a review before it can be changed. Please contact support." +
            (s.error_message ? " (" + s.error_message + ")" : ""),
          name + " needs a review",
          "warning",
        );
        return;
      }
      // a job waiting out a retry backoff, a stock-lock wait or a parked second phase moves only when kicked again
      if (!kickedAt || Date.now() - kickedAt >= SA_BG_KICK_MS) {
        if (!kickedAt) this.$message.info(name + " is being completed in the background. It is read-only until that finishes.");
        kickedAt = Date.now();
        kick(s.job_id);
      }
    }
    if (Date.now() >= deadline) {
      this.$message.info(name + " is still being processed in the background. Reopen it later.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SA_BG_POLL_MS));
    s = await saBgStatus(saId, orgId);
  }
};

// an adjustment a background completion once held (sa_v2_job_id) and released: its failure is shown once per browser
const saShowLastFailure = async (saId, jobId, saNo, orgId) => {
  try {
    if (localStorage.getItem("sa_v2_failed_seen_" + jobId) === "1") return;
  } catch (e) {
    return;
  }
  const s = await saBgStatus(saId, orgId);
  if (!s || !s.job_id || ["FAILED", "CANCELLED"].indexOf(s.job_status) < 0) return;
  if (saFailedSeen(s.job_id)) return;
  const reason = String(s.error_message || s.error_code || "No reason was given.").trim();
  this.$message.warning(("Stock Adjustment " + (saNo || "")).trim() + ": its last background completion failed - " + reason);
};

const saBackgroundView = (pageStatus, data) => {
  if (pageStatus !== "Edit" && pageStatus !== "View") return;
  if (data.stock_adjustment_status === "Processing") {
    if (!saBgOn()) {
      this.$message.warning(("Stock Adjustment " + (data.adjustment_no || "")).trim() + " is being processed in the background. It is read-only until that finishes.");
      return;
    }
    saFollowBackground(data.id, data.adjustment_no, data.organization_id, data.sa_v2_job_id);
    return;
  }
  if (!saBgOn()) return;
  const jobId = String(data.sa_v2_job_id || "").trim();
  if (/^[0-9]{1,20}$/.test(jobId) && (data.stock_adjustment_status === "Draft" || data.stock_adjustment_status === "Cancelled")) {
    saShowLastFailure(data.id, jobId, data.adjustment_no, data.organization_id);
  }
};

