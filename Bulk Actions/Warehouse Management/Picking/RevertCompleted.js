(async () => {
  try {
    this.showLoading();
    const allListID = "custom_9zz4lqcj";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      // Filter for Completed pickings only
      const completedPickings = selectedRecords.filter(
        (item) => item.to_status === "Completed",
      );

      if (completedPickings.length === 0) {
        this.$message.error("Please select at least one completed picking.");
        this.hideLoading();
        return;
      }

      // Filter out pickings where GD has been delivered (gd_status is on the picking record)
      const deliveredPickings = completedPickings.filter(
        (item) =>
          item.gd_status === "Fully Delivered" ||
          item.gd_status === "Partially Delivered",
      );

      if (deliveredPickings.length > 0) {
        const deliveredList = deliveredPickings
          .map((item) => `${item.to_id} (GD Status: ${item.gd_status})`)
          .join("<br>");

        if (deliveredPickings.length === completedPickings.length) {
          this.$message.error(
            `Cannot revert the following picking(s) because the associated Goods Delivery has already been delivered:<br>${deliveredList}`,
          );
          this.hideLoading();
          return;
        }

        this.$message.warning(
          `The following picking(s) will be skipped because the associated Goods Delivery has already been delivered:<br>${deliveredList}`,
        );
      }

      const validPickings = completedPickings.filter(
        (item) =>
          item.gd_status !== "Fully Delivered" &&
          item.gd_status !== "Partially Delivered",
      );

      const pickingNumbers = validPickings.map((item) => item.to_id);

      await this.$confirm(
        `You've selected ${
          pickingNumbers.length
        } picking(s) to revert to Created. <br> <strong>Picking Numbers:</strong> <br>${pickingNumbers.join(
          ", ",
        )} <br><br><strong>Warning:</strong> Reverting will change the picking status back to Created and remove picking records.<br><br>Do you want to proceed?`,
        "Revert Completed Picking",
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

      for (const pickingItem of validPickings) {
        const id = pickingItem.id;

        // to_no is an array of objects like [{to_no: "PP/...", id: "..."}]
        const toNoArray = pickingItem.to_no || [];
        const ppIds = toNoArray.map((pp) => pp.id);

        try {
          // Update transfer_order to_status to Created
          await db.collection("transfer_order").doc(id).update({
            to_status: "Created",
          });

          console.log(`Updated transfer_order ${id} to_status to Created`);

          // Soft delete transfer_order_vrqs3cmr_sub records
          const subResult = await db
            .collection("transfer_order_vrqs3cmr_sub")
            .where({ transfer_order_id: id })
            .get();

          if (subResult.data && subResult.data.length > 0) {
            await Promise.all(
              subResult.data.map((subRecord) =>
                db
                  .collection("transfer_order_vrqs3cmr_sub")
                  .doc(subRecord.id)
                  .update({ is_deleted: 1 }),
              ),
            );
            console.log(
              `Soft deleted ${subResult.data.length} sub records for transfer_order ${id}`,
            );
          }

          // Revert picking plan lines (picking_plan_fwii8mvb_sub)
          // Restore temp_qty_data from prev_temp_qty_data, clear picked data
          const pickingItems = pickingItem.table_picking_items || [];
          const toLineIds = [
            ...new Set(
              pickingItems
                .filter(
                  (item) =>
                    item.to_line_id && item.line_status !== "Cancelled",
                )
                .map((item) => item.to_line_id),
            ),
          ];

          if (toLineIds.length > 0) {
            // Fetch current PP lines to get prev_temp_qty_data
            const ppLineResults = await Promise.all(
              toLineIds.map((lineId) =>
                db.collection("picking_plan_fwii8mvb_sub").doc(lineId).get(),
              ),
            );

            for (const ppLineResult of ppLineResults) {
              if (ppLineResult.data && ppLineResult.data.length > 0) {
                const ppLine = ppLineResult.data[0];

                // Restore temp_qty_data from prev_temp_qty_data
                const prevTempQtyData = ppLine.prev_temp_qty_data || ppLine.temp_qty_data;

                // Parse to regenerate view_stock
                let tempQtyDataArray = [];
                try {
                  tempQtyDataArray =
                    typeof prevTempQtyData === "string"
                      ? JSON.parse(prevTempQtyData)
                      : Array.isArray(prevTempQtyData)
                        ? prevTempQtyData
                        : [];
                } catch (e) {
                  tempQtyDataArray = [];
                }

                // Regenerate view_stock from restored temp_qty_data
                const uom = ppLine.to_uom || "PCS";
                const totalQuantity = tempQtyDataArray.reduce(
                  (sum, entry) => sum + (entry.to_quantity || 0),
                  0,
                );
                const details = tempQtyDataArray
                  .filter((entry) => (entry.to_quantity || 0) > 0)
                  .map((entry, idx) => {
                    const locName = entry.location_id || "";
                    const batchInfo = entry.batch_id
                      ? "\n[" + entry.batch_id + "]"
                      : "";
                    return (
                      idx +
                      1 +
                      ". " +
                      locName +
                      ": " +
                      entry.to_quantity +
                      " " +
                      uom +
                      batchInfo
                    );
                  })
                  .join("\n");

                const viewStock =
                  "Total: " +
                  totalQuantity +
                  " " +
                  uom +
                  "\n\nDETAILS:\n" +
                  (details || "No stock allocated");

                await db
                  .collection("picking_plan_fwii8mvb_sub")
                  .doc(ppLine.id)
                  .update({
                    temp_qty_data: prevTempQtyData,
                    view_stock: viewStock,
                    picked_qty: 0,
                    picked_temp_qty_data: "[]",
                    picked_view_stock: "",
                    picking_status: "Created",
                  });

                console.log(
                  `Reverted picking_plan_fwii8mvb_sub ${ppLine.id}: restored temp_qty_data, cleared picked data`,
                );
              }
            }
          }

          // For each picking plan referenced by this picking
          for (const ppId of ppIds) {
            // Check if there are other transfer_order records with the same to_no (PP ID)
            const otherTOResult = await db
              .collection("transfer_order")
              .filter([
                {
                  type: "branch",
                  operator: "all",
                  children: [
                    {
                      prop: "to_no",
                      operator: "in",
                      value: [ppId],
                    },
                    {
                      prop: "organization_id",
                      operator: "equal",
                      value: pickingItem.organization_id,
                    },
                  ],
                },
              ])
              .get();

            const otherTOs = (otherTOResult.data || []).filter(
              (to) => to.id !== id,
            );

            // If no other transfer_order references this PP, also update picking_plan
            if (otherTOs.length === 0) {
              await db.collection("picking_plan").doc(ppId).update({
                to_status: "Created",
                picking_status: "Created",
              });
              console.log(
                `Updated picking_plan ${ppId} to_status and picking_status to Created`,
              );
            } else {
              console.log(
                `Other transfer_order(s) found referencing PP ${ppId}, skipping picking_plan update`,
              );
            }
          }

          results.push({
            to_id: pickingItem.to_id,
            success: true,
          });
        } catch (error) {
          console.error(
            `Error reverting picking ${pickingItem.to_id}:`,
            error,
          );
          results.push({
            to_id: pickingItem.to_id,
            success: false,
            error: error.message || "Failed to revert",
          });
        }
      }

      // Show summary
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (failCount > 0) {
        const failedItems = results
          .filter((r) => !r.success)
          .map((r) => `${r.to_id}: ${r.error}`)
          .join("<br>");
        this.$message.error(
          `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        );
      } else {
        this.$message.success(
          `All ${successCount} Picking(s) reverted to Created successfully`,
        );
      }

      this.hideLoading();
      this.refresh();
      this.hide("custom_41s73hyl");
    } else {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
