// SC Review V2: while a Stock Adjustment from this Stock Count is completed in the background (Processing), the Stock Count is
// read-only - its save buttons are hidden - and opening it re-kicks the worker and follows that job. While
// ASYNC_SC_REVIEW_ENABLED is false (or a workflow id is not set) nothing here reads, calls a workflow or touches browser storage.
const SCR_BG_WF = {
  STATUS: "__SA_V2_SUBMIT__", // SA_V2_SUBMIT (operation STATUS)
  WORKER: "__SA_V2_WORKER__", // SA_V2_WORKER
};
// the Review button's switch
const SCR_BG_ENABLED = __ASYNC_SC_REVIEW_ENABLED__;
const SCR_BG_POLL_MS = 3000;
const SCR_BG_KICK_MS = 15000;
const SCR_BG_WAIT_MS = 180000;
const SCR_BG_BUTTONS = ["button_review", "button_sync", "button_approve_all", "button_count", "button_draft", "button_issued", "button_select_stock"];

const scrBgOn = () =>
  SCR_BG_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SCR_BG_WF.STATUS) && /^[1-9][0-9]{0,19}$/.test(SCR_BG_WF.WORKER);

const scrBgFollow = async (scId, sa) => {
  const name = ("Stock Adjustment " + (sa.adjustment_no || "")).trim();
  const run = (id, params) =>
    new Promise((resolve, reject) => {
      this.runWorkflow(
        id,
        params,
        (res) => resolve(res),
        (err) => reject(err),
      );
    });
  const status = async () => {
    try {
      const res = await run(SCR_BG_WF.STATUS, {
        operation: "STATUS",
        source: "REVIEW",
        saveAs: "Completed",
        pageStatus: "Edit",
        sa_id: String(sa.id),
        sc_id: String(scId),
        idempotency_key: "",
        form: {},
        organization_id: String(sa.organization_id || ""),
        nickname: "",
        adjustment_date: "",
        create_adjustment: "",
      });
      return (res && res.data) || null;
    } catch (error) {
      console.error("Background review: status check failed", error);
      return null;
    }
  };
  const kick = (jobId) => {
    try {
      this.runWorkflow(
        SCR_BG_WF.WORKER,
        { job_id: String(jobId) },
        () => {},
        (error) => console.error("Background review: worker start failed", error),
      );
    } catch (error) {
      console.error("Background review: worker could not be started", error);
    }
  };
  const failedSeen = (jobId) => {
    let seen = false;
    try {
      const key = "sa_v2_failed_seen_" + jobId;
      seen = localStorage.getItem(key) === "1";
      localStorage.setItem(key, "1");
    } catch (e) {}
    return seen;
  };
  const alertBox = (message, title, type) => this.$alert(message, title, { confirmButtonText: "OK", type: type }).catch(() => {});
  const refreshList = () => {
    if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  };
  this.$message.warning(name + " from this Stock Count is being completed in the background. The Stock Count is read-only until that finishes.");
  const deadline = Date.now() + SCR_BG_WAIT_MS;
  let kickedAt = 0;
  let s = await status();
  for (;;) {
    if (s && (s.job_status === "NONE" || (String(s.terminal) === "YES" && !s.job_id))) {
      if (/^[0-9]{1,20}$/.test(String(sa.sa_v2_job_id || "").trim())) kick(String(sa.sa_v2_job_id).trim());
      refreshList();
      this.$message.warning(name + " is not being completed in the background any more. Close the Stock Count and open it again to see its current state.");
      return;
    }
    if (s && s.job_id) {
      const st = s.job_status;
      if (st === "COMPLETED") {
        this.$message.success(name + " has been completed. Reopen the Stock Count to see the result.");
        refreshList();
        return;
      }
      if (st === "FAILED" || st === "CANCELLED") {
        refreshList();
        if (failedSeen(s.job_id)) return;
        const reason = String(s.error_message || s.error_code || "No reason was given.").trim();
        await alertBox(reason + (/[.!?]$/.test(reason) ? "" : ".") + " The review was not saved; reopen the Stock Count to review it again.", name + " was not completed", "error");
        return;
      }
      if (st === "REQUIRES_REVIEW") {
        await alertBox(
          "It stopped part-way through its completion and needs a review. Please contact support." + (s.error_message ? " (" + s.error_message + ")" : ""),
          name + " needs a review",
          "warning",
        );
        return;
      }
      // a job waiting out a retry backoff, a stock-lock wait or a parked second phase moves only when kicked again
      if (!kickedAt || Date.now() - kickedAt >= SCR_BG_KICK_MS) {
        kickedAt = Date.now();
        kick(s.job_id);
      }
    }
    if (Date.now() >= deadline) {
      this.$message.info(name + " is still being processed in the background. Reopen the Stock Count later.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SCR_BG_POLL_MS));
    s = await status();
  }
};

const scBackgroundView = (pageStatus) => {
  if (!scrBgOn()) return;
  if (pageStatus !== "Edit" && pageStatus !== "View") return;
  const scId = String(this.getValue("id") || "").trim();
  if (!/^[0-9]{1,20}$/.test(scId)) return;
  (async () => {
    let sa = null;
    try {
      const res = await db
        .collection("stock_adjustment")
        .where({ stock_count_id: scId, stock_adjustment_status: "Processing", is_deleted: 0 })
        .field("adjustment_no,stock_adjustment_status,sa_v2_job_id,organization_id")
        .get();
      sa = (res && res.data && res.data[0]) || null;
    } catch (error) {
      console.error("Background review: Stock Adjustment check failed", error);
      return;
    }
    if (!sa) return;
    // no save of this Stock Count while its Stock Adjustment is being completed (STOCK_COUNT refuses it too)
    this.hide(SCR_BG_BUTTONS);
    await scrBgFollow(scId, sa);
  })();
};

