const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const showErrors = (errors) => {
  const preview = errors.slice(0, 3).join("; ");
  const suffix = errors.length > 3 ? ` (+${errors.length - 3} more)` : "";
  this.$message.warning(`Cannot complete packing: ${preview}${suffix}`);
};

(async () => {
  try {
    const data = this.getValues();
    const EPS = 0.001;

    // ---- Precheck: source tables fully packed ----
    const preErrors = [];
    for (const r of data.table_item_source || []) {
      const remaining = parseFloat(r.remaining_qty) || 0;
      if (remaining > EPS || r.line_status !== "Fully Picked") {
        preErrors.push(
          `Item ${r.item_name || r.id || "(?)"} is not fully packed.`,
        );
      }
    }
    if (preErrors.length > 0) {
      showErrors(preErrors);
      return;
    }

    if ((data.table_hu || []).length === 0) {
      this.$message.error("Packing has no HU rows to complete.");
      return;
    }

    // ---- Auto-complete any row with temp_data but hu_status !== "Completed" ----
    // Skips rows without temp_data (empty slots) and already-completed rows.
    // Row indexes stay stable because TableHUCompleted updates fields in place
    // (setData path syntax), it doesn't splice.
    const tableHu = data.table_hu || [];
    const pendingIndexes = [];
    for (let i = 0; i < tableHu.length; i++) {
      const r = tableHu[i];
      if (r.hu_status === "Completed") continue;
      if (!r.temp_data || r.temp_data === "[]") continue;
      pendingIndexes.push(i);
    }

    if (pendingIndexes.length > 0) {
      try {
        await this.$confirm(
          `${pendingIndexes.length} HU(s) are not yet completed. Complete them now as part of finalizing this packing?`,
          "Confirm Complete All",
          {
            confirmButtonText: "Complete All",
            cancelButtonText: "Cancel",
            type: "warning",
          },
        );
      } catch {
        return;
      }

      for (const i of pendingIndexes) {
        const r = tableHu[i];
        await this.triggerEvent("TableHUCompleted", {
          row: r,
          rowIndex: i,
        });
      }
    }

    // ---- Re-read state and validate everything is now Completed ----
    const latestHu = this.getValue("table_hu") || [];
    const latestHuSource = this.getValue("table_hu_source") || [];
    const postErrors = [];

    for (const r of latestHu) {
      // Ignore empty slot rows (no temp_data). Only rows that had items must be Completed.
      if (!r.temp_data || r.temp_data === "[]") continue;
      if (r.hu_status !== "Completed") {
        postErrors.push(
          `HU ${r.handling_no || "(unnumbered)"} is not completed.`,
        );
      }
    }

    for (const r of latestHuSource) {
      if (r.row_type !== "header") continue;
      if (r.hu_status !== "Completed") {
        postErrors.push(
          `Source HU ${r.handling_no || r.handling_unit_id || "(?)"} is not completed.`,
        );
      }
    }

    if (postErrors.length > 0) {
      showErrors(postErrors);
      return;
    }

    this.showLoading("Completing Packing...");
    const finalData = this.getValues();
    console.log("data", finalData);

    let workflowResult;

    await this.runWorkflow(
      "1994279909883895810",
      { entry: finalData, saveAs: "Completed" },
      async (res) => {
        console.log("Packing completed successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to complete Packing:", err);
        workflowResult = err;
      },
    );

    if (
      workflowResult.data.errorStatus &&
      workflowResult.data.errorStatus !== ""
    ) {
      if (workflowResult.data.errorStatus === "missingFields") {
        this.hideLoading();
        this.$message.error(
          `Validation errors: ${workflowResult.data.message}`,
        );
        return;
      }

      if (workflowResult.data.errorStatus === "fullyPacked") {
        this.hideLoading();
        this.$message.error(workflowResult.data.message);
        return;
      }

      // Handle any other error status
      if (workflowResult.data.message) {
        this.hideLoading();
        this.$message.error(workflowResult.data.message);
        return;
      }
    }

    if (workflowResult.data.status === "Success") {
      this.$message.success("Packing completed successfully");
      this.hideLoading();
      closeDialog();
    }
  } catch (error) {
    console.error("Error:", error);
    this.$message.error("Failed to complete Packing");
    this.hideLoading();
    closeDialog();
  }
})();
