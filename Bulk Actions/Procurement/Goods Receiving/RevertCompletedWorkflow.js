// Bulk Revert Completed/Received Goods Receiving back to Created.
//
// Everything is decided server-side: this only filters out the records the list
// already shows as ineligible, so the user is not asked to confirm work that is
// certain to be refused.
const REVERT_WORKFLOW_ID = "REPLACE_WITH_GR_REVERT_WORKFLOW_ID";

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
  const putaway = String((record && record.putaway_status) || "").trim();
  if (putaway === "In Progress" || putaway === "Completed") {
    return `Putaway is already ${putaway}. The stock has been put away.`;
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

    for (const grItem of revertable) {
      try {
        const data = await db.collection("goods_receiving").doc(grItem.id).get();

        if (!data.data || data.data.length === 0) {
          results.push({
            gr_no: grItem.gr_no,
            success: false,
            error: "Goods Receiving record not found",
          });
          continue;
        }

        // The selected row can be stale if the receipt was invoiced or put away
        // after the list was loaded. It is already fetched, so re-checking here
        // costs nothing.
        const grData = data.data[0];
        const reason = !isReceipt(grData)
          ? `No longer revertable (${grData.gr_status}).`
          : blockingReason(grData);
        if (reason) {
          results.push({ gr_no: grItem.gr_no, success: false, error: reason });
          continue;
        }

        results.push(handleWorkflowResult(await runRevertWorkflow(grData), grItem));
      } catch (error) {
        results.push({
          gr_no: grItem.gr_no,
          success: false,
          error: error.message || "Failed to revert",
        });
      }
    }

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

    const successCount = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      this.$message({
        type: "error",
        message: `${successCount} reverted, ${failed.length} failed:<br>${describe(
          failed,
        )}`,
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `All ${successCount} Goods Receiving reverted to Created successfully`,
      );
    }

    this.hideLoading();
    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
