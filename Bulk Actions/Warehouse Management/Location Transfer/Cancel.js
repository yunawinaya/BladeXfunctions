// Bulk Cancel In Progress LOTs - Reverses PO quantity reservations
// Stock Movement V2: with CANCEL switched on, each In Progress transfer goes to LOT_V2_SUBMIT (CANCEL, ids only). A
// NOT_ELIGIBLE (incl. <= V2_MIN_LINES stored lines) / INVALID / no usable answer, or an error before SUBMIT, runs the classic cancel.
const LOT_WF = {
  SUBMIT: "2110992282596540417", // LOT_V2_SUBMIT
  WORKER: "2110992316335521793", // LOT_V2_WORKER
};
// Switches: ASYNC_LOT_ENABLED false or LOT_V2_CANCEL false = every cancel runs the classic workflow
const ASYNC_LOT_ENABLED = true;
const LOT_V2_CANCEL = true;
const V2_MIN_LINES = 50;
const LOT_RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_LOT"];
const LOT_TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];
const LOT_ROUTES = ["QUEUED", "SAVED", "STATUS", "NOT_ELIGIBLE", "BUSY", "STALE", "STOP", "INVALID"];
// IA transfer request (scratchpad/iatr): a Requested request is cancelled by IA_TRANSFER_REQUEST (state only, no stock call)
const IATR_WF = "1985966508400201729"; // IA_TRANSFER_REQUEST

const lotV2Queued = [];
const lv2s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const lv2run = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
  });

// one key per click and transfer: a lost answer re-sent with the same key finds the same job
const lotV2ClickToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const lotV2KeyOf = (lot) => ("LOT:" + lv2s(lot.organization_id) + ":" + lv2s(lot.id) + ":" + lotV2ClickToken).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);

// { kind: "CLASSIC" } (the classic cancel runs), "QUEUED" (a background cancel), "DONE" (already cancelled) or "FAILED" + reason
const lotV2Cancel = async (lot) => {
  let params = null;
  try {
    if (ASYNC_LOT_ENABLED !== true || LOT_V2_CANCEL !== true || LOT_WF.SUBMIT === "0" || LOT_WF.WORKER === "0" || !/^[0-9]{1,20}$/.test(lv2s(lot.id))) {
      return { kind: "CLASSIC" };
    }
    params = {
      operation: "SUBMIT",
      saveAs: "Cancelled",
      pageStatus: "Edit",
      lot_id: lv2s(lot.id),
      idempotency_key: lotV2KeyOf(lot),
      source: "LIST",
      min_lines: String(V2_MIN_LINES),
      form: { id: lv2s(lot.id), stock_movement_status: lv2s(lot.stock_movement_status), stock_movement_no: lv2s(lot.stock_movement_no), organization_id: lv2s(lot.organization_id) },
    };
  } catch (error) {
    console.error("Location Transfer V2: cancel not sent - classic cancel", error);
    return { kind: "CLASSIC" };
  }
  let res = null;
  try {
    res = await lv2run(LOT_WF.SUBMIT, params);
  } catch (error) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    try {
      res = await lv2run(LOT_WF.SUBMIT, params);
    } catch (again) {
      // the classic refuses a transfer SUBMIT already made Processing
      console.error(`No response from the background cancel for ${lot.stock_movement_no} - classic cancel`, again);
      return { kind: "CLASSIC" };
    }
  }
  const r = (res && res.data) || {};
  const st = lv2s(r.job_status);
  if (LOT_ROUTES.indexOf(lv2s(r.route)) < 0) {
    console.error(`No usable answer from the background cancel for ${lot.stock_movement_no} - classic cancel`, res);
    return { kind: "CLASSIC" };
  }
  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") return { kind: "CLASSIC" };
  if (r.route === "QUEUED" || (r.route === "STATUS" && LOT_RUNNING.indexOf(st) >= 0)) {
    lotV2Queued.push({ jobId: lv2s(r.job_id), no: lv2s(lot.stock_movement_no) });
    return { kind: "QUEUED" };
  }
  if (r.route === "STATUS" && st === "COMPLETED") return { kind: "DONE" };
  const reason = lv2s(r.error_message) || lv2s(r.message) || lv2s(r.route) || "no response";
  console.error(`Failed to cancel ${lot.stock_movement_no}: ${reason}`);
  return { kind: "FAILED", reason: reason };
};

// the queued cancels, one after another: LOT_V2_WORKER per job until it ends (at most 10 calls each)
const lotV2Kick = async () => {
  for (const q of lotV2Queued) {
    for (let n = 1; n <= 10; n++) {
      let w = null;
      try {
        const res = await lv2run(LOT_WF.WORKER, { job_id: q.jobId });
        w = (res && res.data) || null;
      } catch (error) {
        console.error("Location Transfer V2: worker call failed - the list starts it again", error);
      }
      const st = w && lv2s(w.job_id) === q.jobId ? lv2s(w.job_status) : "";
      if (LOT_TERMINAL.indexOf(st) >= 0) {
        this.refresh();
        if (st !== "COMPLETED") this.$message.warning(`${q.no}: the background cancel did not finish - ${lv2s(w.result_message) || st}`);
        break;
      }
      if (!(Number((w && w.processed) || 0) > 0)) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
};

(async () => {
  try {
    this.showLoading();

    const listID = "location_transfer";
    let selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const inProgressLOTs = selectedRecords.filter(
      (item) => item.stock_movement_status === "In Progress",
    );

    const requestLOTs = selectedRecords.filter((item) => item.stock_movement_status === "Requested" && item.transfer_purpose === "IA_SUPPLY");

    if (inProgressLOTs.length === 0 && requestLOTs.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one In Progress location transfer or Requested transfer request.",
      );
      return;
    }

    const lotNumbers = inProgressLOTs.concat(requestLOTs).map((item) => item.stock_movement_no);

    // Declare counters
    let successCount = 0;
    let failCount = 0;
    const failedLOTs = [];

    await this.$confirm(
      `You've selected ${lotNumbers.length} location transfer(s) to cancel.<br><br>` +
        `<strong>Location Transfer Numbers:</strong><br>` +
        `${lotNumbers.join(", ")}<br><br>` +
        `Do you want to proceed?`,
      "Cancel In Progress Location Transfer",
      {
        confirmButtonText: "Yes, Cancel LOTs",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      this.hideLoading();
      console.log("User clicked Cancel");
      throw new Error();
    });

    for (const lot of requestLOTs) {
      try {
        const res = await lv2run(IATR_WF, { operation: "CANCEL", ia_id: lv2s(lot.source_ia_id), organization_id: lv2s(lot.organization_id), lot_id: lv2s(lot.id),
          idempotency_key: ("IATR:" + lv2s(lot.id) + ":cancel:" + lotV2ClickToken).slice(0, 128) });
        const r = (res && res.data) || {};
        if (lv2s(r.code) === "200") {
          successCount++;
        } else {
          failCount++;
          failedLOTs.push(`${lot.stock_movement_no} (${lv2s(r.message) || "not cancelled"})`);
        }
      } catch (error) {
        failCount++;
        failedLOTs.push(lot.stock_movement_no);
        console.error(`Failed to cancel transfer request ${lot.stock_movement_no}:`, error);
      }
    }

    for (const lot of inProgressLOTs) {
      try {
        const v2 = await lotV2Cancel(lot);
        if (v2.kind === "QUEUED" || v2.kind === "DONE") {
          successCount++;
          continue;
        }
        if (v2.kind === "FAILED") {
          failCount++;
          failedLOTs.push(`${lot.stock_movement_no} (${v2.reason})`);
          continue;
        }
        let workflowResult;

        await this.runWorkflow(
          "2013133675374927874",
          {
            allData: lot,
            saveAs: "Cancelled",
            pageStatus: "Edit",
          },
          async (res) => {
            console.log("Location Transfer saved successfully:", res);
            workflowResult = res;
          },
          (err) => {
            console.error("Failed to cancel Location Transfer:", err);
            workflowResult = err;
          },
        );

        if (!workflowResult || !workflowResult.data) {
          failCount++;
          failedLOTs.push(lot.stock_movement_no);
          console.error(`No response from workflow for ${lot.stock_movement_no}`);
          continue;
        }

        // Handle workflow errors
        if (
          workflowResult.data.code === "400" ||
          workflowResult.data.code === 400 ||
          workflowResult.data.success === false
        ) {
          failCount++;
          failedLOTs.push(lot.stock_movement_no);
          const errorMessage =
            workflowResult.data.msg ||
            workflowResult.data.message ||
            "Failed to cancel Location Transfer";
          console.error(`Failed to cancel ${lot.stock_movement_no}: ${errorMessage}`);
          continue;
        }

        // Handle success
        if (
          workflowResult.data.code === "200" ||
          workflowResult.data.code === 200 ||
          workflowResult.data.success === true
        ) {
          successCount++;
          console.log(`Successfully cancelled LOT ${lot.stock_movement_no}`);
        } else {
          failCount++;
          failedLOTs.push(lot.stock_movement_no);
          console.error(`Unknown workflow status for ${lot.stock_movement_no}`);
        }
      } catch (error) {
        failCount++;
        failedLOTs.push(lot.stock_movement_no);
        console.error(`Failed to cancel ${lot.stock_movement_no}:`, error);
      }
    }

    this.hideLoading();
    this.refresh();
    if (lotV2Queued.length > 0) {
      this.$message.info(
        `${lotV2Queued.length} location transfer(s) are being cancelled in the background: ${lotV2Queued.map((q) => q.no).join(", ")}`,
      );
      lotV2Kick();
    }

    if (failCount > 0) {
      this.$message.warning(
        `Cancelled ${successCount} LOT(s). Failed: ${failCount} (${failedLOTs.join(
          ", ",
        )})`,
      );
    } else {
      this.$message.success(
        `Successfully cancelled ${successCount} location transfer(s).`,
      );
    }
  } catch (error) {
    this.hideLoading();
    if (error.message) {
      this.$message.error(error.message);
    }
    console.error("Error in bulk cancel process:", error);
  }
})();
