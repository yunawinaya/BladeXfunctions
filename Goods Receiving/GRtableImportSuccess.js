(async () => {
  // Bulk Excel import for the WHOLE table_gr (all items). The parsed payload
  // arrives as arguments[0].value; the workflow matches rows to existing GR
  // lines (by material_code), validates, and returns a rebuilt table_gr.
  const clearImport = () => {
    this.setData({ import_table_data: "" });
  };

  // Re-apply per-row field states after table_gr is replaced. Combines the
  // inv_category option/date/batch logic from GRaddBatchLineItem.processData
  // with the parent_or_child disabled branches from GRconfirmSplit.
  const applyFieldStates = async () => {
    const rows = this.getValue("table_gr") || [];
    const predefinedData = this.getValue("predefined_data") || [];
    const pd = predefinedData[0] || {};
    const putawaySetupData = pd.putawaySetup;
    const invCategoryData = pd.invCategory || [];
    const putawayCategory =
      (putawaySetupData && putawaySetupData.category) || "In Transit";

    // Column-level display toggles: reveal a column if ANY row needs it.
    if (rows.some((g) => (parseFloat(g.uom_conversion) || 0) > 0)) {
      this.display([
        "table_gr.ordered_qty_uom",
        "table_gr.base_ordered_qty",
        "table_gr.base_ordered_qty_uom",
        "table_gr.to_received_qty_uom",
        "table_gr.base_received_qty_uom",
        "table_gr.base_received_qty",
        "table_gr.base_item_uom",
      ]);
    }
    if (rows.some((g) => g.is_serialized_item === 1)) {
      this.display("table_gr.select_serial_number");
    }
    if (rows.some((g) => g.has_formula === 1)) {
      this.display("table_gr.button_formula");
    }
    if (rows.some((g) => g.item_batch_no !== "-")) {
      this.display(["table_gr.manufacturing_date", "table_gr.expired_date"]);
    }

    for (const [index, gr] of rows.entries()) {
      // inv_category dropdown OPTIONS (value is preserved from the built row).
      if (gr.inspection_required === "No") {
        if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
          this.setOptionData(
            `table_gr.${index}.inv_category`,
            invCategoryData.filter(
              (c) => c.dict_key === "Unrestricted" || c.dict_key === "Blocked",
            ),
          );
        } else {
          this.setOptionData(
            `table_gr.${index}.inv_category`,
            invCategoryData.filter((c) =>
              putawayCategory === "In Transit"
                ? c.dict_key === "In Transit"
                : c.dict_key === "In Transit" || c.dict_key === "Unrestricted",
            ),
          );
          this.display("assigned_to");
        }
      } else if (gr.inspection_required === "Yes") {
        if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
          this.setOptionData(
            `table_gr.${index}.inv_category`,
            invCategoryData.filter(
              (c) =>
                c.dict_key === "Unrestricted" ||
                c.dict_key === "Blocked" ||
                c.dict_key === "Quality Inspection",
            ),
          );
        } else {
          this.setOptionData(
            `table_gr.${index}.inv_category`,
            invCategoryData.filter(
              (c) => c.dict_key === putawayCategory || c.dict_key === "Quality Inspection",
            ),
          );
          this.display("assigned_to");
        }
      }

      // Per-row enable/disable by row type.
      const poc = gr.parent_or_child;
      if (gr.is_split === "Yes" && poc === "Parent") {
        this.disabled(
          [
            `table_gr.${index}.received_qty`,
            `table_gr.${index}.base_received_qty`,
            `table_gr.${index}.storage_location_id`,
            `table_gr.${index}.location_id`,
            `table_gr.${index}.line_remark_1`,
            `table_gr.${index}.line_remark_2`,
            `table_gr.${index}.line_remark_3`,
            `table_gr.${index}.select_serial_number`,
            `table_gr.${index}.inv_category`,
          ],
          true,
        );
      } else if (poc === "Split-Parent") {
        this.disabled([`table_gr.${index}.button_split`], true);
        this.disabled(
          [
            `table_gr.${index}.received_qty`,
            `table_gr.${index}.base_received_qty`,
            `table_gr.${index}.storage_location_id`,
            `table_gr.${index}.location_id`,
            `table_gr.${index}.line_remark_1`,
            `table_gr.${index}.line_remark_2`,
            `table_gr.${index}.line_remark_3`,
            `table_gr.${index}.inv_category`,
          ],
          false,
        );
        const isManualBatch =
          gr.item_id &&
          gr.item_batch_no !== "-" &&
          gr.item_batch_no !== "Auto-generated batch number";
        this.disabled([`table_gr.${index}.item_batch_no`], !isManualBatch);
        this.disabled(
          [
            `table_gr.${index}.manufacturing_date`,
            `table_gr.${index}.expired_date`,
          ],
          gr.item_batch_no === "-",
        );
        if (gr.is_serialized_item === 1) {
          this.disabled(
            [
              `table_gr.${index}.select_serial_number`,
              `table_gr.${index}.received_qty`,
            ],
            false,
          );
        }
      } else if (poc === "Child") {
        this.disabled(
          [
            `table_gr.${index}.button_split`,
            `table_gr.${index}.item_batch_no`,
            `table_gr.${index}.manufacturing_date`,
            `table_gr.${index}.expired_date`,
          ],
          true,
        );
        if (gr.is_serialized_item === 1) {
          this.disabled(
            [
              `table_gr.${index}.select_serial_number`,
              `table_gr.${index}.received_qty`,
            ],
            true,
          );
        }
      } else {
        // Regular (non-split) Parent row — mirrors GRaddBatchLineItem.
        this.disabled([`table_gr.${index}.button_split`], false);
        this.disabled(
          `table_gr.${index}.item_batch_no`,
          (gr.item_batch_no !== "" && gr.item_id !== "") ||
            (!gr.item_id && gr.item_batch_no === ""),
        );
        if (gr.item_batch_no === "-") {
          this.disabled(
            [
              `table_gr.${index}.manufacturing_date`,
              `table_gr.${index}.expired_date`,
            ],
            true,
          );
        }
        if (gr.is_serialized_item === 1) {
          this.disabled(`table_gr.${index}.received_qty`, true);
          this.disabled(`table_gr.${index}.base_received_qty`, true);
        } else {
          this.disabled(`table_gr.${index}.select_serial_number`, true);
          this.disabled(`table_gr.${index}.received_qty`, false);
          this.disabled(`table_gr.${index}.base_received_qty`, false);
        }
        this.disabled(`table_gr.${index}.button_formula`, gr.has_formula !== 1);
      }
    }
  };

  try {
    const excelData = arguments[0].value;
    const tableGR = this.getValue("table_gr") || [];
    const plantId = this.getValue("plant_id");
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    if (!excelData) {
      this.$message.error("No data found in the imported file.");
      clearImport();
      return;
    }
    if (!tableGR.length) {
      this.$message.error(
        "There are no GR lines to import into. Select a PO / items first.",
      );
      clearImport();
      return;
    }

    // One workflow call; on a 409 (duplicates) confirm and re-call with skip.
    const callWorkflow = async (skipDuplicates) => {
      this.showLoading();
      const payload = {
        import_table_data: JSON.stringify(excelData),
        table_gr: JSON.stringify(this.getValue("table_gr") || []),
        plant_id: plantId,
        organization_id: organizationId,
        skipDuplicates: skipDuplicates ? "true" : "",
      };
      await this.runWorkflow(
        "2074075402816585730",
        payload,
        async (res) => {
          this.hideLoading();
          try {
            const out =
              (res && res.data && res.data.data) || (res && res.data) || {};
            const code = String(out.code);

            if (code === "409") {
              try {
                await this.$confirm(
                  out.message ||
                    "Some items appear on multiple GR lines and will be skipped. Continue?",
                  "Duplicate items",
                  {
                    confirmButtonText: "Continue",
                    cancelButtonText: "Cancel",
                    type: "warning",
                  },
                );
              } catch (e) {
                clearImport();
                return;
              }
              await callWorkflow(true);
              return;
            }

            if (code === "200") {
              let rows = [];
              try {
                rows = JSON.parse(out.table_gr || "[]");
              } catch (e) {
                this.$message.error("Failed to read the imported data.");
                clearImport();
                return;
              }
              await this.setData({ table_gr: rows });
              // states must be applied after the rows exist in the model
              setTimeout(async () => {
                await applyFieldStates();
              }, 100);
              if (out.warning) {
                this.$message.warning(out.warning);
              } else {
                this.$message.success("Imported successfully.");
              }
            } else {
              this.$message.error(out.message || "Import validation failed.");
              clearImport();
            }
          } catch (err) {
            this.$message.error(err.message || String(err));
            clearImport();
          }
        },
        async (error) => {
          this.hideLoading();
          this.$message.error(
            (error && error.data && error.data.msg) ||
              (error && error.message) ||
              String(error),
          );
          clearImport();
        },
      );
    };

    await callWorkflow(false);
  } catch (error) {
    this.hideLoading();
    this.$message.error(error.message || String(error));
    clearImport();
  }
})();
