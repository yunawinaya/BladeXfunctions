const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateCompletion = (data) => {
  const errors = [];
  const repackType = data.repack_type;
  const rows = data.table_repack || [];

  if (!repackType) {
    errors.push("Repack Type is required");
    return errors;
  }

  const seenSourceHuIds = new Set();

  rows.forEach((row, idx) => {
    const rowNo = idx + 1;
    const needsSource = repackType === "Unload" || repackType === "Transfer";
    const needsTarget = repackType === "Load" || repackType === "Transfer";
    const needsWarehouseLocation = repackType === "Unload";

    let parsedItems = [];
    try {
      parsedItems = row.items_temp_data ? JSON.parse(row.items_temp_data) : [];
    } catch (e) {
      parsedItems = [];
    }

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      errors.push(`Row ${rowNo}: no items selected`);
    } else if (
      !parsedItems.some((it) => (parseFloat(it.unload_quantity) || 0) > 0)
    ) {
      errors.push(`Row ${rowNo}: no item has a quantity`);
    }

    if (needsSource) {
      if (!row.source_temp_data) {
        errors.push(`Row ${rowNo}: source handling unit not selected`);
      } else {
        try {
          const parsed = JSON.parse(row.source_temp_data);
          const sourceId = parsed?.id || "";
          if (sourceId) {
            if (seenSourceHuIds.has(sourceId)) {
              errors.push(
                `Row ${rowNo}: source handling unit already used in another row`,
              );
            } else {
              seenSourceHuIds.add(sourceId);
            }
          }
        } catch (e) {
          errors.push(`Row ${rowNo}: source handling unit data is invalid`);
        }
      }
    }

    if (needsTarget) {
      const hasExistingTarget = row.target_hu_id || row.target_temp_data;
      const hasNewTarget = row.target_hu_no === "Auto-generated number";
      if (!hasExistingTarget && !hasNewTarget) {
        errors.push(`Row ${rowNo}: target handling unit not selected`);
      }
    }

    if (needsWarehouseLocation) {
      if (!row.target_location || !row.target_storage_location) {
        errors.push(
          `Row ${rowNo}: target warehouse location not set`,
        );
      }
    }

    if (repackType === "Transfer" && row.source_temp_data && row.target_temp_data) {
      try {
        const src = JSON.parse(row.source_temp_data);
        const tgt = JSON.parse(row.target_temp_data);
        if (src?.id && tgt?.id && src.id === tgt.id) {
          errors.push(
            `Row ${rowNo}: source and target handling unit cannot be the same`,
          );
        }
      } catch (e) {
        // already reported above
      }
    }
  });

  return errors;
};

(async () => {
  try {
    this.showLoading("Completing Repack Order...");

    const rawData = this.getValues();
    const { dialog_repack, ...data } = rawData;
    const pageStatus = data.page_status;

    const validationErrors = validateCompletion(data);
    if (validationErrors.length > 0) {
      this.hideLoading();
      this.$message.error(
        `Cannot complete: ${validationErrors.join("; ")}`,
      );
      return;
    }

    let workflowResult;

    await this.runWorkflow(
      "2043621631586209793",
      { allData: data, saveAs: "Completed", pageStatus },
      (res) => {
        console.log("Repack Order completed:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to complete Repack Order:", err);
        workflowResult = err;
      },
    );

    if (workflowResult?.data?.code && workflowResult.data.code !== 200) {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.message || "Failed to complete Repack Order",
      );
      return;
    }

    this.$message.success("Repack Order completed");
    this.hideLoading();
    closeDialog();
  } catch (error) {
    console.error("Error in ROsaveAsCompleted:", error);
    this.hideLoading();
    this.$message.error(error.message || "Failed to complete Repack Order");
    closeDialog();
  }
})();
