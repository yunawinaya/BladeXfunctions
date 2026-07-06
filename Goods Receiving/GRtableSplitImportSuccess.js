(async () => {
  // Excel -> JSON is handled by the platform (su-fm-excel-parse). The parsed
  // payload arrives as arguments[0].value; the split dialog context tells us
  // which GR line is being split.
  //
  // This import is SPLIT-PARENT only: it fills per-row batch/date/location,
  // which the split dialog only honours when is_parent_split === 1. So we force
  // is_parent_split = 1 (and lock it) while importing, and unlock it again if
  // the import fails.
  const clearImport = () => {
    this.setData({ "split_dialog.import_data": "" });
  };
  const unlockParentSplit = async () => {
    await this.disabled("split_dialog.is_parent_split", false);
  };

  try {
    const excelData = arguments[0].value;
    const dialogData = this.getValue("split_dialog");
    const rowIndex = dialogData ? dialogData.rowIndex : undefined;
    const tableGR = this.getValue("table_gr") || [];
    const grItem = rowIndex !== undefined ? tableGR[rowIndex] : undefined;
    const plantId = this.getValue("plant_id");

    if (!excelData) {
      this.$message.error("No data found in the imported file.");
      clearImport();
      return;
    }

    if (!grItem || !grItem.item_id) {
      this.$message.error(
        "Unable to determine the item for this split. Please reopen the split dialog and try again.",
      );
      clearImport();
      return;
    }

    // If split rows already exist, confirm before replacing them so the user
    // knows a new upload resets the current split rows and imported file.
    const existingSplit =
      dialogData && Array.isArray(dialogData.table_split)
        ? dialogData.table_split
        : [];
    if (existingSplit.length > 0) {
      try {
        await this.$confirm(
          "Uploading another file will reset the current split rows and the previously imported file. Do you want to continue?",
          "Replace imported data?",
          {
            confirmButtonText: "Continue",
            cancelButtonText: "Cancel",
            type: "warning",
          },
        );
      } catch (e) {
        // Cancelled: discard this upload, keep the existing split rows.
        clearImport();
        return;
      }
    }

    // Lock the dialog into split-parent mode for the imported data.
    await this.setData({ "split_dialog.is_parent_split": 1 });
    await this.disabled("split_dialog.is_parent_split", true);

    // The workflow does all name->id resolution, validation, date formatting,
    // UOM conversion and batch handling, then returns a ready-to-use
    // table_split (JSON string).
    const payload = {
      excelData: JSON.stringify(excelData),
      item_id: grItem.item_id,
      plant_id: plantId,
      ordered_qty: grItem.ordered_qty,
      initial_received_qty: grItem.initial_received_qty,
      ordered_qty_uom: grItem.ordered_qty_uom,
      item_uom: grItem.item_uom,
    };

    await this.runWorkflow(
      "2074020700778831873",
      payload,
      async (res) => {
        try {
          // Return keys may sit at res.data or res.data.data depending on the
          // platform envelope (see POsaveAsIssued.js).
          const out =
            (res && res.data && res.data.data) || (res && res.data) || {};
          const code = String(out.code);

          if (code === "200") {
            let rows = [];
            try {
              rows = JSON.parse(out.table_split || "[]");
            } catch (e) {
              this.$message.error("Failed to read the imported split data.");
              clearImport();
              await unlockParentSplit();
              return;
            }

            await this.setData({
              "split_dialog.table_split": rows,
              "split_dialog.no_of_split": rows.length,
            });

            // Enable the batch-number column for manual-batch items so the user
            // can still adjust it (mirrors GRconfirmSplit.js). "-" = non-batch
            // and "Auto-generated batch number" = auto both stay disabled.
            if (grItem.item_batch_no === "") {
              await this.disabled("split_dialog.table_split.batch_no", false);
            }

            // is_parent_split intentionally stays locked (=1, disabled) on success.

            if (out.warning) {
              this.$message.warning(out.warning);
            } else {
              this.$message.success(
                `Imported ${rows.length} row(s) successfully.`,
              );
            }
          } else {
            // Validation failure: surface the message, clear the upload and
            // unlock the mode so the user can correct and re-import (or split
            // manually).
            this.$message.error(out.message || "Import validation failed.");
            clearImport();
            await unlockParentSplit();
          }
        } catch (err) {
          this.$message.error(err.message || String(err));
          clearImport();
          await unlockParentSplit();
        }
      },
      async (error) => {
        this.$message.error(
          (error && error.data && error.data.msg) ||
            (error && error.message) ||
            String(error),
        );
        clearImport();
        await unlockParentSplit();
      },
    );
  } catch (error) {
    this.$message.error(error.message || String(error));
    clearImport();
    await unlockParentSplit();
  }
})();
