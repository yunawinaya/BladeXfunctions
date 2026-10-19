// IA V2: an Item Assembly a background job holds stays Processing (read-only, no save or post button) until the job ends;
// opening it follows the job: STATUS, and a worker kick every 15 s (the completion worker for a completion, the revert worker
// for a revert). A failed background job is reported once per browser. With both switches false (or a workflow id not set)
// nothing here calls a workflow or touches browser storage.
const IA_BG_WF = {
  SUBMIT: "__IA_V2_SUBMIT__", // IA_V2_SUBMIT
  WORKER: "__IA_V2_WORKER__", // IA_V2_WORKER
  REVERT_SUBMIT: "__IA_REVERT_V2_SUBMIT__", // IA_REVERT_V2_SUBMIT
  REVERT_WORKER: "__IA_REVERT_V2_WORKER__", // IA_REVERT_V2_WORKER
};
// the Completed buttons' switch and the list's Revert switch
const IA_BG_ENABLED = __ASYNC_IA_ENABLED__;
const IA_BG_REVERT_ENABLED = __ASYNC_IA_REVERT_ENABLED__;
const IA_BG_POLL_MS = 3000;
const IA_BG_KICK_MS = 15000;
const IA_BG_WAIT_MS = 420000;

const iaBgId = (v) => /^[1-9][0-9]{0,19}$/.test(String(v || "").trim());
const iaBgOn = () => IA_BG_ENABLED === true && iaBgId(IA_BG_WF.SUBMIT) && iaBgId(IA_BG_WF.WORKER);
const iaBgRevertOn = () => IA_BG_REVERT_ENABLED === true && iaBgId(IA_BG_WF.REVERT_SUBMIT) && iaBgId(IA_BG_WF.REVERT_WORKER);
const iaBgText = (v) => String(v === undefined || v === null ? "" : v).trim();

const iaBgRun = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(
      id,
      params,
      (res) => resolve(res),
      (err) => reject(err),
    );
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });

// STATUS answers the assembly's latest job of either command; its action (DIRECT / REVERT) says which worker moves it
const iaBgStatus = async (iaId) => {
  try {
    const res = iaBgOn()
      ? await iaBgRun(IA_BG_WF.SUBMIT, { operation: "STATUS", saveAs: "Completed", pageStatus: "Edit", ia_id: String(iaId),
        idempotency_key: "", source: "FORM", form: {} })
      : await iaBgRun(IA_BG_WF.REVERT_SUBMIT, { operation: "STATUS", ia_id: String(iaId), idempotency_key: "", source: "FORM",
        min_picks: "", form: {} });
    return (res && res.data) || null;
  } catch (error) {
    console.error("Background job: status check failed", error);
    return null;
  }
};

const iaBgIsRevert = (st) => iaBgText(st && st.action) === "REVERT" || iaBgText(st && st.command) === "REVERT_IA";

const iaBgKick = (workerId, jobId) => {
  if (!workerId) return;
  try {
    const p = this.runWorkflow(
      workerId,
      { job_id: String(jobId) },
      () => {},
      (error) => console.error("Background job: worker start failed", error),
    );
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (error) {
    console.error("Background job: worker could not be started", error);
  }
};

// true when this browser already showed the job (and marks it shown)
const iaFailedSeen = (jobId) => {
  let seen = false;
  try {
    const key = "ia_v2_failed_seen_" + jobId;
    seen = localStorage.getItem(key) === "1";
    localStorage.setItem(key, "1");
  } catch (e) {}
  return seen;
};

const iaBgAlert = (message, title, type) => this.$alert(message, title, { confirmButtonText: "OK", type: type }).catch(() => {});

const iaFollowBackground = async (iaId, name, jobOnRecord) => {
  const refreshList = () => {
    if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  };
  const deadline = Date.now() + IA_BG_WAIT_MS;
  let kickedAt = 0;
  let st = await iaBgStatus(iaId);
  for (;;) {
    // no job holds it (any more): stop following - the assembly on screen may be out of date
    if (st && (st.job_status === "NONE" || (iaBgText(st.terminal) === "YES" && !st.job_id))) {
      // a new assembly whose completion stopped before it was linked to its job is released only when that job is worked
      if (/^[0-9]{1,20}$/.test(jobOnRecord) && iaBgOn()) iaBgKick(IA_BG_WF.WORKER, jobOnRecord);
      refreshList();
      this.$message.warning(name + " is not being processed in the background any more. Close it and open it again to see its current state.");
      return;
    }
    if (st && st.job_id) {
      const revert = iaBgIsRevert(st);
      const verb = revert ? "reverted" : "completed";
      const js = iaBgText(st.job_status);
      if (js === "COMPLETED") {
        this.$message.success(name + (revert ? " has been reverted to Draft." : " has been completed.") + " Reopen it to see the result.");
        refreshList();
        return;
      }
      if (js === "FAILED" || js === "CANCELLED") {
        refreshList();
        if (iaFailedSeen(st.job_id)) return;
        const reason = iaBgText(st.error_message || st.error_code || "No reason was given.");
        await iaBgAlert(reason + (/[.!?]$/.test(reason) ? "" : ".") + " Reopen it to continue.", name + " was not " + verb, "error");
        return;
      }
      if (js === "REQUIRES_REVIEW") {
        await iaBgAlert(
          "It stopped part-way through and needs a review before it can be changed. Please contact support." +
            (st.error_message ? " (" + st.error_message + ")" : ""),
          name + " needs a review",
          "warning",
        );
        return;
      }
      // a job waiting out a retry backoff, a stock-lock wait or a parked second phase moves only when kicked again
      if (!kickedAt || Date.now() - kickedAt >= IA_BG_KICK_MS) {
        if (!kickedAt) this.$message.info(name + " is being " + verb + " in the background. It is read-only until that finishes.");
        kickedAt = Date.now();
        iaBgKick(revert ? (iaBgRevertOn() ? IA_BG_WF.REVERT_WORKER : "") : iaBgOn() ? IA_BG_WF.WORKER : "", st.job_id);
      }
    }
    if (Date.now() >= deadline) {
      this.$message.info(name + " is still being processed in the background. Reopen it later.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, IA_BG_POLL_MS));
    st = await iaBgStatus(iaId);
  }
};

// an assembly a background job once held (ia_v2_job_id) and released: a failure is shown once per browser; a job with nothing
// to show is not asked about again in this browser
const iaShowLastFailure = async (iaId, jobId, name) => {
  try {
    if (localStorage.getItem("ia_v2_failed_seen_" + jobId) === "1") return;
  } catch (e) {
    return;
  }
  const st = await iaBgStatus(iaId);
  if (!st || !st.job_id) return;
  const js = iaBgText(st.job_status);
  if (["FAILED", "CANCELLED", "COMPLETED"].indexOf(js) < 0) return;
  const shown = iaFailedSeen(st.job_id);
  if (String(st.job_id) !== String(jobId)) iaFailedSeen(jobId);
  if (shown || js === "COMPLETED") return;
  const reason = iaBgText(st.error_message || st.error_code || "No reason was given.");
  this.$message.warning(name + ": its last background " + (iaBgIsRevert(st) ? "revert" : "completion") + " failed - " + reason);
};

const iaBackgroundView = (pageStatus, status) => {
  if (pageStatus !== "Edit" && pageStatus !== "View") return;
  const on = iaBgOn() || iaBgRevertOn();
  if (status !== "Processing" && (!on || (status !== "Draft" && status !== "Completed"))) return;
  const jobOnRecord = iaBgText(this.getValue("ia_v2_job_id"));
  if (status !== "Processing" && !/^[0-9]{1,20}$/.test(jobOnRecord)) return;
  const iaId = iaBgText(this.getValue("id"));
  const name = ("Item Assembly " + iaBgText(this.getValue("stock_movement_no"))).trim();
  if (status === "Processing") {
    if (!on) {
      this.$message.warning(name + " is being processed in the background. It is read-only until that finishes.");
      return;
    }
    iaFollowBackground(iaId, name, jobOnRecord);
    return;
  }
  if (iaBgId(iaId)) iaShowLastFailure(iaId, jobOnRecord, name);
};

