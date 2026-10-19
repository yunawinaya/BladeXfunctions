// Bulk Revert Completed/Received Goods Receiving back to Created - Goods Receiving list, RevertCompletedGR (GR Revert V2).
// GR_REVERT_SUBMIT decides per receipt: QUEUED -> reverted in the background by GR_REVERT_WORKER (started here; the list's
// mounted starts it again); NOT_ELIGIBLE (a handling unit in the receipt) -> the classic GR_REVERT_COMPLETED, unchanged.
const REVERT_WORKFLOW_ID = "2095079401411117057";
const GRV_WF = {
  SUBMIT: "2110563805617885185", // GR_REVERT_SUBMIT
  WORKER: "2110563842980745217", // GR_REVERT_WORKER
};
// Switch: false = every receipt takes the classic revert
const ASYNC_REVERT_ENABLED = true;

const runRevertWorkflow = async (gr) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      REVERT_WORKFLOW_ID,
      {
        gr_id: gr.id,
        gr_no: gr.gr_no,
        organization_id: gr.organization_id,
      },
      (res) => {
        console.log("Goods Receiving revert workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to revert Goods Receiving:", err);
        reject(err);
      },
    );
  });
};

const run = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
  });

const esc = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Completion writes "Received" instead of "Completed" whenever a putaway is
// required or a line goes to quality inspection. Both are the same inventory
// state, so both can be reverted.
const isReceipt = (record) => {
  const status = String((record && record.gr_status) || "").trim();
  return status === "Completed" || status === "Received";
};

// A cancelled purchase invoice writes "Cancelled" back onto the receipt, which
// is not a live invoice.
const blockingReason = (record) => {
  const pi = String((record && record.pi_status) || "").trim();
  if (pi !== "" && pi.toLowerCase() !== "cancelled") {
    return `Already invoiced (${pi}). Please cancel the purchase invoice first.`;
  }
  const ret = String((record && record.return_status) || "").trim();
  if (ret !== "" && ret.toLowerCase() !== "cancelled") {
    return `A purchase return exists (${ret}). Please cancel the purchase return first.`;
  }
  if (String((record && record.posted_status) || "").trim() === "Posted") {
    return "Already posted to accounting.";
  }
  // A finished putaway is fine: the reversal follows the stock to wherever the
  // putaway left it, and withdraws the putaway along with the receipt. Only a
  // putaway someone is still working on is blocked.
  if (
    String((record && record.putaway_status) || "").trim() === "In Progress"
  ) {
    return "Putaway is in progress. Finish or clear it first.";
  }
  return "";
};

const handleWorkflowResult = (workflowResult, grItem) => {
  const fail = (error) => ({ gr_no: grItem.gr_no, success: false, error });

  if (!workflowResult || !workflowResult.data) {
    return fail("No response from revert workflow");
  }

  const data = workflowResult.data;
  const resultCode = data.code;
  const message = data.msg || data.message;

  // 409 - the stock has been used or a document moved on. Nothing was written.
  if (resultCode === "409" || resultCode === 409) {
    const detail = Array.isArray(data.conflicts)
      ? data.conflicts
          .map((c) => c && c.message)
          .filter((m) => m)
          .join(" ")
      : "";
    return fail(
      [message || "The stock from this receipt has already been used.", detail]
        .filter((m) => m)
        .join(" "),
    );
  }

  // 500 - the reversal stopped part way through and has to be run again.
  if (resultCode === "500" || resultCode === 500) {
    return {
      gr_no: grItem.gr_no,
      success: false,
      partial: true,
      error: message || "Revert stopped part way through.",
    };
  }

  // 400 - refused by the state of the document itself.
  if (resultCode === "400" || resultCode === 400 || data.success === false) {
    return fail(message || "Failed to revert Goods Receiving");
  }

  if (resultCode === "200" || resultCode === 200 || data.success === true) {
    return { gr_no: grItem.gr_no, success: true };
  }

  return fail("Unknown revert workflow status");
};

// the classic revert of one receipt, exactly as the button ran it before
const classicRevert = async (grItem) => {
  const data = await db.collection("goods_receiving").doc(grItem.id).get();
  if (!data.data || data.data.length === 0) {
    return { gr_no: grItem.gr_no, success: false, error: "Goods Receiving record not found" };
  }
  // The selected row can be stale if the receipt was invoiced or put away
  // after the list was loaded. It is already fetched, so re-checking here
  // costs nothing.
  const grData = data.data[0];
  const reason = !isReceipt(grData) ? `No longer revertable (${grData.gr_status}).` : blockingReason(grData);
  if (reason) {
    return { gr_no: grItem.gr_no, success: false, error: reason };
  }
  return handleWorkflowResult(await runRevertWorkflow(grData), grItem);
};

// one key per click and receipt: a lost answer re-sent with the same key finds the same job
const clickToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const keyOf = (gr) => ("GRV:" + String(gr.organization_id || "") + ":" + String(gr.id) + ":" + clickToken).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);

const submitV2 = async (gr) => {
  const params = { operation: "SUBMIT", gr_id: String(gr.id), idempotency_key: keyOf(gr), source: "LIST" };
  let res = null;
  try {
    res = await run(GRV_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("GR Revert V2: submit failed, repeating once with the same key", e);
    res = await run(GRV_WF.SUBMIT, params);
  }
  return (res && res.data) || null;
};

const OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_REVERT"];
const watching = [];
const revertOne = async (grItem) => {
  const r = await submitV2(grItem);
  if (!r || !r.route) return { gr_no: grItem.gr_no, success: false, error: "No response from revert workflow" };
  if (r.route === "QUEUED" || (r.route === "STATUS" && OPEN.indexOf(r.job_status) >= 0)) {
    watching.push(grItem);
    return { gr_no: grItem.gr_no, success: true, queued: true };
  }
  if (r.route === "STATUS" && r.job_status === "COMPLETED") return { gr_no: grItem.gr_no, success: true };
  if (r.route === "NOT_ELIGIBLE") return classicRevert(grItem);
  if (r.route === "STATUS" && r.job_status === "FAILED") {
    return { gr_no: grItem.gr_no, success: false, error: r.error_message || r.progress_message || "The previous revert of this receipt failed." };
  }
  return { gr_no: grItem.gr_no, success: false, error: r.message || r.progress_message || "Failed to revert Goods Receiving" };
};

// the background finds the classic's conflicts (stock used since the receipt, ...) only once it runs: say why, as the classic did
const reportFinished = async () => {
  const stopped = [];
  for (const gr of watching.splice(0)) {
    const r = await run(GRV_WF.SUBMIT, { operation: "STATUS", gr_id: String(gr.id), idempotency_key: keyOf(gr), source: "LIST" }).then(
      (res) => (res && res.data) || {},
      () => ({}),
    );
    if (r.job_status === "FAILED" || r.job_status === "REQUIRES_REVIEW") {
      stopped.push(`${esc(gr.gr_no)}: ${esc(r.error_message || r.progress_message || "The revert did not finish.")}`);
    } else if (r.job_status !== "COMPLETED") {
      watching.push(gr);
    }
  }
  if (stopped.length > 0) {
    await this.$alert(stopped.join("<br>"), "Revert did not finish", { type: "error", dangerouslyUseHTMLString: true }).catch(() => {});
  }
};

// no scheduled worker: started here after the queue, again while it still finds work (and by the list's mounted)
const drainWorker = (round) => {
  try {
    this.runWorkflow(
      GRV_WF.WORKER,
      {},
      async (w) => {
        const processed = Number((w && w.data && w.data.processed) || 0);
        this.refresh();
        if (watching.length > 0) await reportFinished();
        if (processed > 0 && round < 40) drainWorker(round + 1);
      },
      (e) => console.error("GR Revert V2: worker tick failed - the list starts it again", e),
    );
  } catch (e) {
    console.error("GR Revert V2: worker could not be started - the list starts it again", e);
  }
};

(async () => {
  try {
    this.showLoading();
    const listID = "custom_fnns00ze";

    const selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const receipts = selectedRecords.filter(isReceipt);

    if (receipts.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one completed or received goods receiving to revert.",
      );
      return;
    }

    const skipped = [];
    const revertable = [];
    for (const item of receipts) {
      const reason = blockingReason(item);
      if (reason) {
        skipped.push({ gr_no: item.gr_no, success: false, error: reason });
      } else {
        revertable.push(item);
      }
    }

    const describe = (rows) =>
      rows.map((r) => `${esc(r.gr_no)}: ${esc(r.error)}`).join("<br>");

    if (revertable.length === 0) {
      this.hideLoading();
      this.$message({
        type: "error",
        message: `None of the selected goods receiving can be reverted.<br>${describe(
          skipped,
        )}`,
        dangerouslyUseHTMLString: true,
      });
      return;
    }

    const skippedNote =
      skipped.length > 0
        ? `<br><br><strong>${skipped.length} goods receiving will be skipped:</strong><br>${describe(
            skipped,
          )}`
        : "";

    await this.$confirm(
      `You've selected ${
        revertable.length
      } goods receiving to revert to Created. This will take the received stock back out, remove the costing layers it created, restore the purchase order quantities, and remove any putaway, inspection and handling unit it created. <br><strong>Goods Receiving Numbers:</strong><br>${revertable
        .map((item) => esc(item.gr_no))
        .join(", ")}${skippedNote}<br><br>Do you want to proceed?`,
      "Revert Goods Receiving to Created",
      {
        confirmButtonText: "Revert",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    const results = skipped.slice();
    const v2 = ASYNC_REVERT_ENABLED === true && GRV_WF.SUBMIT !== "0" && GRV_WF.WORKER !== "0";

    for (const grItem of revertable) {
      try {
        results.push(v2 ? await revertOne(grItem) : await classicRevert(grItem));
      } catch (error) {
        results.push({
          gr_no: grItem.gr_no,
          success: false,
          error: error.message || "Failed to revert",
        });
      }
    }

    const queued = results.filter((r) => r.queued).length;
    if (queued > 0) drainWorker(1);

    // A half-finished reversal needs the user to act, so it gets its own alert
    // rather than one line in a summary they may not read.
    const partial = results.filter((r) => r.partial);
    if (partial.length > 0) {
      await this.$alert(
        partial.map((r) => `${esc(r.gr_no)}: ${esc(r.error)}`).join("<br>"),
        "Revert did not finish",
        { type: "error", dangerouslyUseHTMLString: true },
      ).catch(() => {});
    }

    const doneCount = results.filter((r) => r.success && !r.queued).length;
    const failed = results.filter((r) => !r.success);
    const queuedNote = queued > 0 ? `${queued} being reverted in the background, ` : "";

    if (failed.length > 0) {
      this.$message({
        type: "error",
        message: `${doneCount} reverted, ${queuedNote}${failed.length} failed:<br>${describe(
          failed,
        )}`,
        dangerouslyUseHTMLString: true,
      });
    } else if (queued > 0) {
      this.$message.success(
        `${queued} Goods Receiving ${queued === 1 ? "is" : "are"} being reverted to Created in the background` +
          (doneCount > 0 ? `; ${doneCount} reverted` : ""),
      );
    } else {
      this.$message.success(
        `All ${doneCount} Goods Receiving reverted to Created successfully`,
      );
    }

    this.hideLoading();
    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
