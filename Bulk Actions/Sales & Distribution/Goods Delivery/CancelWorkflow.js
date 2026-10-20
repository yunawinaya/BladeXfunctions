const runGDWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2017151544868491265",
      {
        allData: data,
        saveAs: "Cancelled",
        pageStatus: "Edit",
      },
      (res) => {
        console.log("Goods Delivery workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to save Goods Delivery:", err);
        reject(err);
      },
    );
  });
};

// GD Cancel V2 (2026-10-20): each Created delivery goes to GD_CANCEL_SUBMIT, a background job that releases its stock and
// reservations, its sales orders, its Pickings and open Packings, and renumbers it everywhere; one it does not handle
// (NOT_ELIGIBLE) is cancelled the classic way below. false = every delivery the classic way, as before.
const CANCEL_V2_ENABLED = true;
const GD_CANCEL_SUBMIT_ID = "2112455664139866113";
const GD_CANCEL_WORKER_ID = "2112455700319932418";
const GD_JOB_CHECK_ID = "2112084100104495105"; // GD_SO_CONVERT_CHECK: job_ids -> jobs_json
const FOLLOW_MS = 120000;
const FOLLOW_EVERY_MS = 3000;

// The classic cancel of one delivery: GOODS_DELIVERY saveAs Cancelled, then its Picking rows and its movements' numbers
const classicCancel = async (gdItem) => {
  const id = gdItem.id;

  const data = await db.collection("goods_delivery").doc(id).get();

  try {
    const workflowResult = await runGDWorkflow(data.data[0]);

    if (!workflowResult || !workflowResult.data) {
      return {
        delivery_no: gdItem.delivery_no,
        success: false,
        error: "No response from workflow",
      };
    }

    const resultCode = workflowResult.data.code;

    // Handle 400 - General error
    if (
      resultCode === "400" ||
      resultCode === 400 ||
      workflowResult.data.success === false
    ) {
      const errorMessage =
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Failed to cancel Goods Delivery";
      return {
        delivery_no: gdItem.delivery_no,
        success: false,
        error: errorMessage,
      };
    }

    // Handle success
    if (
      resultCode === "200" ||
      resultCode === 200 ||
      workflowResult.data.success === true
    ) {
      // Handle picking status update.
      // Skip for GDPP: the source Picking exists independently of this GD
      // (no gd_no back-reference) and can be claimed by other GDs.
      // reserved_qty release on the picking record is handled by the
      // inventory sub-workflow already.
      if (gdItem.is_select_picking !== 1 && gdItem.picking_status) {
        const pickingFilter = new Filter().in("gd_no", [id]).build();

        const resPicking = await db
          .collection("transfer_order")
          .filter(pickingFilter)
          .get();

        if (resPicking && resPicking.data.length > 0) {
          console.log("resPicking", resPicking);
          const pickingList = resPicking.data;

          for (const pickingData of pickingList) {
            // Skip terminal Pickings: a Completed TO's picks already
            // happened physically (and are reflected in GD line picked_qty),
            // so we must not retroactively mark them as Cancelled. Cancelled
            // TOs are already done.
            if (
              pickingData.to_status === "Completed" ||
              pickingData.to_status === "Cancelled"
            ) {
              continue;
            }

            // A bundle is ONE row of table_picking_items with its items under `children`.
            // The items are picking lines in their own right and carry the same gd_id, so
            // they have to be cancelled too -- reading the top level alone cancelled the
            // bundle row and left its items Open on a Picking marked Cancelled. Walked
            // WITHOUT copying: these very row objects are what gets written back below.
            const allPickingRows = [];
            for (const row of pickingData.table_picking_items || []) {
              allPickingRows.push(row);
              for (const kid of Array.isArray(row.children)
                ? row.children
                : []) {
                allPickingRows.push(kid);
              }
            }

            for (const pickingItem of allPickingRows) {
              if (pickingItem.gd_id === id) {
                pickingItem.line_status = "Cancelled";
              }
            }

            const isAllGDCancelled = allPickingRows.every(
              (item) => item.line_status === "Cancelled",
            );

            if (isAllGDCancelled) {
              pickingData.to_status = "Cancelled";
              pickingData.to_id = `${pickingData.to_id}-Cancelled`;
            }

            console.log("pickingData", pickingData);

            await db
              .collection("transfer_order")
              .doc(pickingData.id)
              .update({
                table_picking_items: pickingData.table_picking_items,
                to_status: pickingData.to_status,
                to_id: pickingData.to_id,
              });
          }
        }
      }

      await db
        .collection("inventory_movement")
        .where({
          trx_no: gdItem.delivery_no,
          organization_id: gdItem.organization_id,
        })
        .update({
          trx_no: `${gdItem.delivery_no}-Cancelled`,
        });

      return {
        delivery_no: gdItem.delivery_no,
        success: true,
      };
    }
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "Unknown workflow status",
    };
  } catch (error) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: error.message || "Failed to cancel",
    };
  }
};

// GD Cancel V2: one call, an answer that always settles (null when the call failed)
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
      GD_CANCEL_WORKER_ID,
      { job_id: jobId },
      () => {},
      (err) => console.error("GD cancel worker for job " + jobId + ":", err),
    );
  } catch (error) {
    console.error("GD cancel worker could not be started:", error);
  }
};

// Starts the worker for each queued cancel, then reports each one as its job ends; a job the background cancel refused as
// not eligible (the delivery is back to Created) is cancelled the classic way. Returns the cancels still running.
const followCancels = async (queued, results) => {
  let pending = queued.slice();
  pending.forEach((item) => kickWorker(item.job_id));
  const started = Date.now();
  let round = 0;
  while (pending.length > 0 && Date.now() - started < FOLLOW_MS) {
    this.hideLoading();
    this.showLoading(`Cancelling in the background: ${queued.length - pending.length} of ${queued.length} done...`);
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
        results.push({ delivery_no: item.delivery_no, success: true, note: job.progress_message || "" });
      } else if (status === "FAILED" && job.error_code === "GDX_NOT_ELIGIBLE") {
        results.push(await classicCancel(item.gd));
      } else if (status === "FAILED" || status === "CANCELLED") {
        results.push({ delivery_no: item.delivery_no, success: false, error: job.error_message || "The goods delivery could not be cancelled." });
      } else if (status === "REQUIRES_REVIEW") {
        results.push({ delivery_no: item.delivery_no, success: false,
          error: `Held for review by an administrator${job.error_message ? ": " + job.error_message : "."} Do not cancel it again.` });
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

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      let goodsDeliveryData = selectedRecords.filter(
        (item) => item.gd_status === "Created",
      );

      if (goodsDeliveryData.length === 0) {
        this.$message.error(
          "Please select at least one created goods delivery.",
        );
        throw new Error();
      }

      const goodsDeliveryNumbers = goodsDeliveryData.map(
        (item) => item.delivery_no,
      );

      await this.$confirm(
        `You've selected ${
          goodsDeliveryNumbers.length
        } goods delivery(s) to cancel. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
          ", ",
        )} <br>Do you want to proceed?`,
        "Goods Delivery Cancellation",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      const results = [];
      const queued = [];

      for (const gdItem of goodsDeliveryData) {
        if (!CANCEL_V2_ENABLED) {
          results.push(await classicCancel(gdItem));
          continue;
        }
        const answer = await callWorkflow(GD_CANCEL_SUBMIT_ID, { operation: "SUBMIT", gd_id: String(gdItem.id), source: "LIST" });
        if (answer && answer.route === "QUEUED") {
          queued.push({ delivery_no: gdItem.delivery_no, job_id: answer.job_id, gd: gdItem });
        } else if (answer && answer.route === "NOT_ELIGIBLE") {
          results.push(await classicCancel(gdItem));
        } else {
          results.push({ delivery_no: gdItem.delivery_no, success: false, error: (answer && answer.message) || "The cancel could not be started. Try again." });
        }
      }
      const background = queued.length ? await followCancels(queued, results) : [];

      // Show summary
      const ok = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      const notes = ok.filter((r) => r.note && r.note.indexOf(";") >= 0);
      if (failed.length > 0 || background.length > 0 || notes.length > 0) {
        const sections = [];
        if (ok.length) sections.push(`<strong>Cancelled (${ok.length}):</strong><br>` + ok.map((r) => r.note || r.delivery_no).join("<br>"));
        if (failed.length) sections.push(`<strong>Not cancelled (${failed.length}):</strong><br>` + failed.map((r) => `${r.delivery_no}: ${r.error}`).join("<br>"));
        if (background.length) sections.push(`<strong>Being cancelled in the background (${background.length}):</strong><br>` + background.map((r) => r.delivery_no).join(", ") + "<br>They will show as Cancelled in the list shortly.");
        this.hideLoading();
        await this.$alert(sections.join("<br><br>"), "Goods Delivery Cancellation", { dangerouslyUseHTMLString: true, confirmButtonText: "OK" }).catch(() => {});
      } else {
        this.$message.success(
          `All ${ok.length} Goods Delivery cancelled successfully`,
        );
      }

      this.hideLoading();
      this.refresh();
    } else {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
