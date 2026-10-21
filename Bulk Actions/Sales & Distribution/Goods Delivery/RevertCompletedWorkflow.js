const REVERT_WORKFLOW_ID = "2058819647368241153";

// GD Revert V2 (2026-10-21): each Completed delivery goes to GD_REVERT_SUBMIT, a background job that puts its stock back, restores
// its reservations and sales orders and makes it Created again; one it does not handle (NOT_ELIGIBLE: a Picking Plan delivery,
// serial numbers, stock from a handling unit) is reverted the classic way below. false = every delivery the classic way, as before.
const REVERT_V2_ENABLED = true;
const GD_REVERT_SUBMIT_ID = "2112758069166473217";
const GD_REVERT_WORKER_ID = "2112758130420088833";
const GD_JOB_CHECK_ID = "2112084100104495105"; // GD_SO_CONVERT_CHECK: job_ids -> jobs_json
const FOLLOW_MS = 120000;
const FOLLOW_EVERY_MS = 3000;

const runRevertWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      REVERT_WORKFLOW_ID,
      {
        allData: data,
        pageStatus: "Edit",
      },
      (res) => {
        console.log("GD revert workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to revert Goods Delivery:", err);
        reject(err);
      },
    );
  });
};

// A Goods Delivery carries si_status = "" / null (not invoiced), "Partially
// Invoiced", "Fully Invoiced" or "Cancelled". Anything other than empty or
// "Cancelled" means a live Sales Invoice exists against this GD, so the
// delivery cannot be rolled back until that invoice is cancelled.
const isInvoiced = (record) => {
  const status = String((record && record.si_status) || "").trim();
  return status !== "" && status.toLowerCase() !== "cancelled";
};

const describeInvoiced = (records) =>
  records
    .map((item) => `${item.delivery_no} (${item.si_status})`)
    .join("<br>");

const invoicedError = (siStatus) =>
  `Already invoiced (${siStatus}). Please cancel the sales invoice first.`;

const handleWorkflowResult = (workflowResult, gdItem) => {
  if (!workflowResult || !workflowResult.data) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "No response from revert workflow",
    };
  }

  const resultCode = workflowResult.data.code;

  // 409 - Conflict (state changed since completion; cannot safely revert)
  if (resultCode === "409" || resultCode === 409) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error:
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Conflict: state has changed since completion",
    };
  }

  // 400 - general error (not Completed, snapshot missing, etc.)
  if (
    resultCode === "400" ||
    resultCode === 400 ||
    workflowResult.data.success === false
  ) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error:
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Failed to revert Goods Delivery",
    };
  }

  // 200 - success
  if (
    resultCode === "200" ||
    resultCode === 200 ||
    workflowResult.data.success === true
  ) {
    return {
      delivery_no: gdItem.delivery_no,
      success: true,
    };
  }

  return {
    delivery_no: gdItem.delivery_no,
    success: false,
    error: "Unknown revert workflow status",
  };
};

// The classic revert of one delivery: GD_REVERT_COMPLETED on the record as stored
const classicRevert = async (gdItem) => {
  const data = await db.collection("goods_delivery").doc(gdItem.id).get();

  if (!data.data || data.data.length === 0) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "Goods Delivery record not found",
    };
  }

  try {
    const gdData = data.data[0];

    // The selected row can be stale if the goods delivery was invoiced
    // elsewhere after the list was loaded. The record is already fetched,
    // so re-checking here costs nothing.
    if (isInvoiced(gdData)) {
      return {
        delivery_no: gdItem.delivery_no,
        success: false,
        error: invoicedError(gdData.si_status),
      };
    }

    const workflowResult = await runRevertWorkflow(gdData);
    return handleWorkflowResult(workflowResult, gdItem);
  } catch (error) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: error.message || "Failed to revert",
    };
  }
};

// GD Revert V2: one call, an answer that always settles (null when the call failed)
const callWorkflow = (workflowId, params) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        workflowId,
        params,
        (res) => resolve(res && res.data ? res.data : null),
        (err) => {
          console.error("Workflow " + workflowId + " failed:", err);
          resolve(null);
        },
      );
    } catch (error) {
      console.error("Workflow " + workflowId + " could not run:", error);
      resolve(null);
    }
  });

const kickWorker = (jobId) => {
  try {
    this.runWorkflow(
      GD_REVERT_WORKER_ID,
      { job_id: jobId },
      () => {},
      (err) => console.error("GD revert worker for job " + jobId + ":", err),
    );
  } catch (error) {
    console.error("GD revert worker could not be started:", error);
  }
};

// Starts the worker for each queued revert, then reports each one as its job ends; a job the background revert refused as
// not eligible (the delivery is back to Completed) is reverted the classic way. Returns the reverts still running.
const followReverts = async (queued, results) => {
  let pending = queued.slice();
  pending.forEach((item) => kickWorker(item.job_id));
  const started = Date.now();
  let round = 0;
  while (pending.length > 0 && Date.now() - started < FOLLOW_MS) {
    this.hideLoading();
    this.showLoading(`Reverting in the background: ${queued.length - pending.length} of ${queued.length} done...`);
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_EVERY_MS));
    const answer = await callWorkflow(GD_JOB_CHECK_ID, { job_ids: pending.map((item) => item.job_id) });
    let jobs = null;
    try {
      jobs = JSON.parse((answer && answer.jobs_json) || "null");
    } catch (error) {
      jobs = null;
    }
    if (!Array.isArray(jobs)) continue;
    const byId = {};
    jobs.forEach((job) => {
      byId[String(job.job_id)] = job;
    });
    const still = [];
    for (const item of pending) {
      const job = byId[String(item.job_id)];
      const status = job ? job.job_status : "";
      if (status === "COMPLETED") {
        results.push({ delivery_no: item.delivery_no, success: true });
      } else if (status === "FAILED" && job.error_code === "GDR_NOT_ELIGIBLE") {
        results.push(await classicRevert(item.gd));
      } else if (status === "FAILED" || status === "CANCELLED") {
        results.push({ delivery_no: item.delivery_no, success: false, error: job.error_message || "The goods delivery could not be reverted." });
      } else if (status === "REQUIRES_REVIEW") {
        results.push({ delivery_no: item.delivery_no, success: false,
          error: `Held for review by an administrator${job.error_message ? ": " + job.error_message : "."} Do not revert it again.` });
      } else {
        still.push(item);
      }
    }
    pending = still;
    // a worker run that ended before its job did (stock locks held by another save) is started again
    if (++round % 5 === 0) pending.forEach((item) => kickWorker(item.job_id));
  }
  return pending;
};

(async () => {
  try {
    this.showLoading();
    const allListID = "custom_ezwb0qqp";

    const selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const completedGoodsDelivery = selectedRecords.filter(
      (item) => item.gd_status === "Completed",
    );

    if (completedGoodsDelivery.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one completed goods delivery to revert.",
      );
      return;
    }

    // Invoiced goods deliveries cannot be reverted - the sales invoice has to
    // be cancelled first, which resets si_status back to empty.
    const invoicedGoodsDelivery = completedGoodsDelivery.filter(isInvoiced);
    const goodsDeliveryData = completedGoodsDelivery.filter(
      (item) => !isInvoiced(item),
    );

    if (goodsDeliveryData.length === 0) {
      this.hideLoading();
      this.$message({
        type: "error",
        message: `The selected goods delivery(s) have already been invoiced and cannot be reverted. Please cancel the sales invoice first.<br>${describeInvoiced(
          invoicedGoodsDelivery,
        )}`,
        dangerouslyUseHTMLString: true,
      });
      return;
    }

    const goodsDeliveryNumbers = goodsDeliveryData.map(
      (item) => item.delivery_no,
    );

    const skippedNote =
      invoicedGoodsDelivery.length > 0
        ? `<br><br><strong>${
            invoicedGoodsDelivery.length
          } invoiced goods delivery(s) will be skipped:</strong> <br>${describeInvoiced(
            invoicedGoodsDelivery,
          )}<br>Please cancel the sales invoice first to revert them.`
        : "";

    await this.$confirm(
      `You've selected ${
        goodsDeliveryNumbers.length
      } goods delivery(s) to revert to Created. This will undo inventory delivery, stock movements, handling unit deductions, and Sales Order updates. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
        ", ",
      )}${skippedNote} <br>Do you want to proceed?`,
      "Revert Goods Delivery to Created",
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

    const results = invoicedGoodsDelivery.map((item) => ({
      delivery_no: item.delivery_no,
      success: false,
      error: invoicedError(item.si_status),
    }));

    const queued = [];

    for (const gdItem of goodsDeliveryData) {
      if (!REVERT_V2_ENABLED) {
        results.push(await classicRevert(gdItem));
        continue;
      }
      const answer = await callWorkflow(GD_REVERT_SUBMIT_ID, { operation: "SUBMIT", gd_id: String(gdItem.id), source: "LIST" });
      if (answer && answer.route === "QUEUED") {
        queued.push({ delivery_no: gdItem.delivery_no, job_id: answer.job_id, gd: gdItem });
      } else if (answer && answer.route === "NOT_ELIGIBLE") {
        results.push(await classicRevert(gdItem));
      } else {
        results.push({ delivery_no: gdItem.delivery_no, success: false, error: (answer && answer.message) || "The revert could not be started. Try again." });
      }
    }
    const background = queued.length ? await followReverts(queued, results) : [];

    // Show summary
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    if (failCount > 0 || background.length > 0) {
      const sections = [];
      if (successCount) sections.push(`<strong>Reverted to Created (${successCount}):</strong><br>` + results.filter((r) => r.success).map((r) => r.delivery_no).join(", "));
      if (failCount) sections.push(`<strong>Not reverted (${failCount}):</strong><br>` + results.filter((r) => !r.success).map((r) => `${r.delivery_no}: ${r.error}`).join("<br>"));
      if (background.length) sections.push(`<strong>Being reverted in the background (${background.length}):</strong><br>` + background.map((r) => r.delivery_no).join(", ") + "<br>They will show as Created in the list shortly.");
      this.hideLoading();
      await this.$alert(sections.join("<br><br>"), "Revert Goods Delivery to Created", { dangerouslyUseHTMLString: true, confirmButtonText: "OK" }).catch(() => {});
    } else {
      this.$message.success(
        `All ${successCount} Goods Delivery reverted to Created successfully`,
      );
    }

    this.hideLoading();
    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
