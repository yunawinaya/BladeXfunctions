// IDA V2: a Processing Item Disassembly is read-only until its background job ends; opening it follows the job (STATUS, a worker
// kick every 15 s) and a failed job is shown once per browser. Switch off or an id not set: no workflow call, no browser storage.
const IDA_BG_WF = {
  SUBMIT: "__IDA_V2_SUBMIT__", // IDA_V2_SUBMIT
  WORKER: "__IDA_V2_WORKER__", // IDA_V2_WORKER
};
const IDA_BG_ENABLED = __ASYNC_IDA_ENABLED__;
const IDA_BG_POLL_MS = 3000;
const IDA_BG_KICK_MS = 15000;
const IDA_BG_WAIT_MS = 420000;

const idaBgId = (v) => /^[1-9][0-9]{0,19}$/.test(String(v || "").trim());
const idaBgOn = () => IDA_BG_ENABLED === true && idaBgId(IDA_BG_WF.SUBMIT) && idaBgId(IDA_BG_WF.WORKER);
const idaBgText = (v) => String(v === undefined || v === null ? "" : v).trim();

const idaBgRun = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(
      id,
      params,
      (res) => resolve(res),
      (err) => reject(err),
    );
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });

const idaBgStatus = async (idaId) => {
  try {
    const res = await idaBgRun(IDA_BG_WF.SUBMIT, { operation: "STATUS", saveAs: "Completed", pageStatus: "Edit", ida_id: String(idaId),
      idempotency_key: "", source: "FORM", form: {} });
    return (res && res.data) || null;
  } catch (error) {
    console.error("Item Disassembly V2: status check failed", error);
    return null;
  }
};

const idaBgKick = (jobId) => {
  try {
    const p = this.runWorkflow(
      IDA_BG_WF.WORKER,
      { job_id: String(jobId) },
      () => {},
      (error) => console.error("Item Disassembly V2: worker start failed", error),
    );
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (error) {
    console.error("Item Disassembly V2: worker could not be started", error);
  }
};

// true when this browser already showed the job (and marks it shown)
const idaFailedSeen = (jobId) => {
  let seen = false;
  try {
    const key = "ida_v2_failed_seen_" + jobId;
    seen = localStorage.getItem(key) === "1";
    localStorage.setItem(key, "1");
  } catch (e) {}
  return seen;
};

const idaBgAlert = (message, title, type) => this.$alert(message, title, { confirmButtonText: "OK", type: type }).catch(() => {});

const idaFollowBackground = async (idaId, name, jobOnRecord) => {
  const refreshList = () => {
    if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  };
  const deadline = Date.now() + IDA_BG_WAIT_MS;
  let kickedAt = 0;
  let st = await idaBgStatus(idaId);
  for (;;) {
    if (st && (st.job_status === "NONE" || (idaBgText(st.terminal) === "YES" && !st.job_id))) {
      // a new disassembly whose completion stopped before its link is released only when that job is worked
      if (/^[0-9]{1,20}$/.test(jobOnRecord)) idaBgKick(jobOnRecord);
      refreshList();
      this.$message.warning(name + " is not being processed in the background any more. Close it and open it again to see its current state.");
      return;
    }
    if (st && st.job_id) {
      const js = idaBgText(st.job_status);
      if (js === "COMPLETED") {
        this.$message.success(name + " has been completed. Reopen it to see the result.");
        refreshList();
        return;
      }
      if (js === "FAILED" || js === "CANCELLED") {
        refreshList();
        if (idaFailedSeen(st.job_id)) return;
        const reason = idaBgText(st.error_message || st.error_code || "No reason was given.");
        await idaBgAlert(reason + (/[.!?]$/.test(reason) ? "" : ".") + " Reopen it to continue.", name + " was not completed", "error");
        return;
      }
      if (js === "REQUIRES_REVIEW") {
        await idaBgAlert(
          "It stopped part-way through and needs a review before it can be changed. Please contact support." +
            (st.error_message ? " (" + st.error_message + ")" : ""),
          name + " needs a review",
          "warning",
        );
        return;
      }
      // a retry backoff, a stock-lock wait or a parked second phase moves only when the worker is kicked again
      if (!kickedAt || Date.now() - kickedAt >= IDA_BG_KICK_MS) {
        if (!kickedAt) this.$message.info(name + " is being completed in the background. It is read-only until that finishes.");
        kickedAt = Date.now();
        idaBgKick(st.job_id);
      }
    }
    if (Date.now() >= deadline) {
      this.$message.info(name + " is still being processed in the background. Reopen it later.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, IDA_BG_POLL_MS));
    st = await idaBgStatus(idaId);
  }
};

// a disassembly a job once held (ida_v2_job_id) and released: its failure is shown once per browser; a job with nothing to
// show is not asked about again in this browser
const idaShowLastFailure = async (idaId, jobId, name) => {
  try {
    if (localStorage.getItem("ida_v2_failed_seen_" + jobId) === "1") return;
  } catch (e) {
    return;
  }
  const st = await idaBgStatus(idaId);
  if (!st || !st.job_id) return;
  const js = idaBgText(st.job_status);
  if (["FAILED", "CANCELLED", "COMPLETED"].indexOf(js) < 0) return;
  const shown = idaFailedSeen(st.job_id);
  if (String(st.job_id) !== String(jobId)) idaFailedSeen(jobId);
  if (shown || js === "COMPLETED") return;
  const reason = idaBgText(st.error_message || st.error_code || "No reason was given.");
  this.$message.warning(name + ": its last background completion failed - " + reason);
};

const idaBackgroundView = (pageStatus, status) => {
  if (pageStatus !== "Edit" && pageStatus !== "View") return;
  const on = idaBgOn();
  if (status !== "Processing" && (!on || (status !== "Draft" && status !== "Completed"))) return;
  const jobOnRecord = idaBgText(this.getValue("ida_v2_job_id"));
  if (status !== "Processing" && !/^[0-9]{1,20}$/.test(jobOnRecord)) return;
  const idaId = idaBgText(this.getValue("id"));
  const name = ("Item Disassembly " + idaBgText(this.getValue("stock_movement_no"))).trim();
  if (status === "Processing") {
    if (!on) {
      this.$message.warning(name + " is being processed in the background. It is read-only until that finishes.");
      return;
    }
    idaFollowBackground(idaId, name, jobOnRecord);
    return;
  }
  if (idaBgId(idaId)) idaShowLastFailure(idaId, jobOnRecord, name);
};

