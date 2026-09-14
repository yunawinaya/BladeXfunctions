// Bulk Revert Completed Item Assembly back to Draft.
//
// Everything is decided server-side: the workflow re-reads the record, so this
// only filters out rows the list already shows as ineligible.
const IA_REVERT_WORKFLOW_ID = "2099319746652852225";

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

    for (const ia of revertable) {
      try {
        results.push(handleWorkflowResult(await runRevertWorkflow(ia), ia));
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
        `All ${successCount} Item Assembly reverted to Draft successfully`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    if (error && error.message === "cancelled") return;
    console.error(error);
    this.$message.error((error && error.message) || "Failed to revert");
  }
})();
