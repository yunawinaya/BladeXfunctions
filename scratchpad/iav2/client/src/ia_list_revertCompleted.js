// Bulk Revert Completed Item Assembly back to Draft.
//
// Everything is decided server-side: the workflow re-reads the record, so this
// only filters out rows the list already shows as ineligible.
//
// IA Revert V2: with ASYNC_IA_REVERT_ENABLED each assembly asks IA_REVERT_V2_SUBMIT first: more than 50 live stock rows ->
// reverted in the background by IA_REVERT_V2_WORKER (started here; the list's mounted starts it again); NOT_ELIGIBLE, INVALID
// or no usable answer -> the classic IA_REVERT below, unchanged.
const IA_REVERT_WORKFLOW_ID = "2099319746652852225";
const IARV_WF = {
  SUBMIT: "__IA_REVERT_V2_SUBMIT__", // IA_REVERT_V2_SUBMIT
  WORKER: "__IA_REVERT_V2_WORKER__", // IA_REVERT_V2_WORKER
};
// Switch: false = every assembly takes the classic revert
const ASYNC_IA_REVERT_ENABLED = __ASYNC_IA_REVERT_ENABLED__;
const IA_RV_MIN_ROWS = __IA_RV_MIN_ROWS__;
const IARV_KICK_MAX = 10;

const runRevertWorkflow = async (ia) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      IA_REVERT_WORKFLOW_ID,
      {
        ia_id: ia.id,
        ia_no: ia.stock_movement_no,
        organization_id: ia.organization_id,
      },
      (res) => resolve(res),
      (err) => reject(err),
    );
  });
};

const esc = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const handleWorkflowResult = (workflowResult, ia) => {
  const label = ia.stock_movement_no || ia.id;
  const fail = (error) => ({ label, success: false, error });

  if (!workflowResult || !workflowResult.data) {
    return fail("No response from revert workflow");
  }

  const data = workflowResult.data;
  const resultCode = String(data.code);
  const message = data.msg || data.message;

  // 409 - the assembled item has been used. Nothing was written.
  if (resultCode === "409") {
    const detail = Array.isArray(data.conflicts)
      ? data.conflicts
          .map((c) => c && c.message)
          .filter((m) => m)
          .join(" ")
      : "";
    return fail(
      [message || "The assembled item has already been used.", detail]
        .filter((m) => m)
        .join(" "),
    );
  }

  // 500 - the reversal stopped part way through and has to be run again.
  if (resultCode === "500") {
    return {
      label,
      success: false,
      partial: true,
      error: message || "Revert stopped part way through.",
    };
  }

  if (resultCode === "200") {
    return { label, success: true };
  }

  return fail(message || "Failed to revert Item Assembly");
};

const rvOn = () =>
  ASYNC_IA_REVERT_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(IARV_WF.SUBMIT) && /^[1-9][0-9]{0,19}$/.test(IARV_WF.WORKER);
const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// settles on the callback or on the promise runWorkflow returns, whichever comes first
const run = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });

// one key per click and assembly: a lost answer re-sent with the same key finds the same job
const clickToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const keyOf = (ia) => ("IAV:" + str(ia.organization_id) + ":" + str(ia.id) + ":" + clickToken).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
// RV4: every request key is sent (strings except form; the form is the list row)
const rvRequest = (ia, operation) => ({
  operation: operation,
  ia_id: str(ia.id),
  idempotency_key: keyOf(ia),
  source: "LIST",
  min_picks: String(IA_RV_MIN_ROWS),
  form:
    operation === "STATUS"
      ? {}
      : { id: str(ia.id), item_assembly_status: str(ia.item_assembly_status), stock_movement_no: str(ia.stock_movement_no), organization_id: str(ia.organization_id) },
});

const submitV2 = async (ia) => {
  const params = rvRequest(ia, "SUBMIT");
  let res = null;
  try {
    res = await run(IARV_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("IA Revert V2: submit failed, repeating once with the same key", e);
    try {
      res = await run(IARV_WF.SUBMIT, params);
    } catch (again) {
      console.error("IA Revert V2: submit failed twice", again);
    }
  }
  return (res && res.data) || null;
};

const RV_OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_REVERT"];
const watching = [];
const revertOne = async (ia) => {
  const label = ia.stock_movement_no || ia.id;
  const r = await submitV2(ia);
  // no usable answer, NOT_ELIGIBLE (50 live stock rows or fewer, handling units, ...) or INVALID: the classic revert
  if (!r || !r.route || r.route === "NOT_ELIGIBLE" || r.route === "INVALID") {
    return handleWorkflowResult(await runRevertWorkflow(ia), ia);
  }
  const js = str(r.job_status);
  if (r.route === "QUEUED" || (r.route === "STATUS" && RV_OPEN.indexOf(js) >= 0)) {
    watching.push(ia);
    return { label, success: true, queued: true };
  }
  if (r.route === "STATUS" && js === "COMPLETED") return { label, success: true };
  if (r.route === "STATUS" && (js === "FAILED" || js === "REQUIRES_REVIEW")) {
    return { label, success: false, error: str(r.error_message) || str(r.progress_message) || "The previous revert of this Item Assembly did not finish." };
  }
  return { label, success: false, error: str(r.message) || str(r.progress_message) || "Failed to revert Item Assembly" };
};

// the background revert finds the classic's conflicts (the assembled item used since, ...) only once it runs: say why
const reportFinished = async () => {
  const stopped = [];
  for (const ia of watching.splice(0)) {
    let r = {};
    try {
      const res = await run(IARV_WF.SUBMIT, rvRequest(ia, "STATUS"));
      r = (res && res.data) || {};
    } catch (e) {
      console.error("IA Revert V2: status check failed", e);
    }
    const js = str(r.job_status);
    if (js === "FAILED" || js === "REQUIRES_REVIEW") {
      stopped.push(`${esc(ia.stock_movement_no || ia.id)}: ${esc(str(r.error_message) || str(r.progress_message) || "The revert did not finish.")}`);
    } else if (js !== "COMPLETED") {
      watching.push(ia);
    }
  }
  if (stopped.length > 0) {
    await this.$alert(stopped.join("<br>"), "Revert did not finish", { type: "error", dangerouslyUseHTMLString: true }).catch(() => {});
  }
};

// no scheduled worker: driven here while it finds work (at most IARV_KICK_MAX calls), then by the list's mounted
const drainWorker = async () => {
  for (let n = 1; n <= IARV_KICK_MAX; n++) {
    let processed = 0;
    try {
      const res = await run(IARV_WF.WORKER, { job_id: "" });
      processed = Number((res && res.data && res.data.processed) || 0);
    } catch (e) {
      console.error("IA Revert V2: worker tick failed - the list starts it again", e);
    }
    this.refresh();
    if (watching.length > 0) await reportFinished();
    if (watching.length === 0) return;
    if (processed <= 0) await sleep(3000);
  }
};

(async () => {
  try {
    this.showLoading();

    const selectedRecords =
      this.getComponent("custom_7rq6zmn4")?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const revertable = [];
    const skipped = [];
    for (const item of selectedRecords) {
      if (item.item_assembly_status === "Completed") {
        revertable.push(item);
      } else {
        skipped.push({
          label: item.stock_movement_no || item.id,
          success: false,
          error: `Only Completed Item Assembly can be reverted (this one is ${
            item.item_assembly_status || "blank"
          }).`,
        });
      }
    }

    const describe = (rows) =>
      rows.map((r) => `${esc(r.label)}: ${esc(r.error)}`).join("<br>");

    if (revertable.length === 0) {
      this.hideLoading();
      this.$message({
        type: "error",
        message: `None of the selected Item Assembly can be reverted.<br>${describe(
          skipped,
        )}`,
        dangerouslyUseHTMLString: true,
      });
      return;
    }

    const skippedNote =
      skipped.length > 0
        ? `<br><br><strong>${skipped.length} will be skipped:</strong><br>${describe(
            skipped,
          )}`
        : "";

    this.hideLoading();
    await this.$confirm(
      `You've selected ${
        revertable.length
      } Item Assembly to revert to Draft. This will take the assembled item back out of stock and return its components. Completing it again will issue a new number.<br><strong>Item Assembly Numbers:</strong><br>${revertable
        .map((item) => esc(item.stock_movement_no))
        .join(", ")}${skippedNote}<br><br>Do you want to proceed?`,
      "Revert Item Assembly to Draft",
      {
        confirmButtonText: "Revert",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("cancelled");
    });

    this.showLoading("Reverting Item Assembly...");
    const results = skipped.slice();
    const v2 = rvOn();

    for (const ia of revertable) {
      try {
        results.push(v2 ? await revertOne(ia) : handleWorkflowResult(await runRevertWorkflow(ia), ia));
      } catch (error) {
        results.push({
          label: ia.stock_movement_no || ia.id,
          success: false,
          error: (error && error.message) || "Failed to revert",
        });
      }
    }

    this.hideLoading();

    // A half-finished reversal needs the user to act, so it gets its own alert.
    const partial = results.filter((r) => r.partial);
    if (partial.length > 0) {
      await this.$alert(describe(partial), "Revert did not finish", {
        type: "error",
        dangerouslyUseHTMLString: true,
      }).catch(() => {});
    }

    const queued = results.filter((r) => r.queued).length;
    const successCount = results.filter((r) => r.success && !r.queued).length;
    const failed = results.filter((r) => !r.success);
    const queuedNote = queued > 0 ? `${queued} being reverted in the background, ` : "";

    if (failed.length > 0) {
      this.$message({
        type: "error",
        message: `${successCount} reverted, ${queuedNote}${failed.length} failed:<br>${describe(
          failed,
        )}`,
        dangerouslyUseHTMLString: true,
      });
    } else if (queued > 0) {
      this.$message.success(
        `${queued} Item Assembly ${queued === 1 ? "is" : "are"} being reverted to Draft in the background` +
          (successCount > 0 ? `; ${successCount} reverted` : ""),
      );
    } else {
      this.$message.success(
        `All ${successCount} Item Assembly reverted to Draft successfully`,
      );
    }

    this.refresh();
    if (queued > 0) drainWorker();
  } catch (error) {
    this.hideLoading();
    if (error && error.message === "cancelled") return;
    console.error(error);
    this.$message.error((error && error.message) || "Failed to revert");
  }
})();
