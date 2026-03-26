(async () => {
  try {
    const data = this.getValues();
    const tableHU = this.getValue("hu_dialog.table_hu") || [];
    const receivedQty =
      parseFloat(this.getValue("hu_dialog.received_qty")) || 0;
    const rowIndex = this.getValue("hu_dialog.rowIndex");
    const storageLocationId = this.getValue("hu_dialog.storage_location_id");
    const locationId = this.getValue("hu_dialog.location_id");

    // Helper function to format HU data for view_hu display
    // Since each row has exactly 1 HU after split, simplified format
    const formatViewHU = async (huArray) => {
      if (!huArray || huArray.length === 0) return "";

      const hu = huArray[0]; // Each row has exactly 1 HU
      const huName = hu.hu_no || hu.handling_unit_id || "New HU";
      const qty = hu.store_in_quantity || 0;

      // Fetch material code if hu_material_id exists
      let materialCode = "";
      if (hu.hu_material_id) {
        try {
          const res = await db
            .collection("Item")
            .where({ id: hu.hu_material_id })
            .get();
          materialCode = res.data?.[0]?.material_code || hu.hu_material_id;
        } catch (error) {
          console.error(`Error fetching material ${hu.hu_material_id}:`, error);
          materialCode = hu.hu_material_id;
        }
      }

      // Format:
      // HU-001: 60 qty
      // [HU Material: MAT-123]
      let result = `${huName}: ${qty} qty`;
      if (materialCode) {
        result += `\n[HU Material: ${materialCode}]`;
      }
      return result;
    };

    // Filter rows with store_in_quantity > 0
    const confirmedHUs = tableHU.filter(
      (hu) => parseFloat(hu.store_in_quantity) > 0,
    );

    // Calculate total store_in_quantity
    const totalStoreInQty = confirmedHUs.reduce(
      (sum, hu) => sum + (parseFloat(hu.store_in_quantity) || 0),
      0,
    );

    // Validate hu_material_id is not empty for all confirmed HUs
    const missingMaterialHUs = confirmedHUs.filter((hu) => !hu.hu_material_id);
    if (missingMaterialHUs.length > 0) {
      this.$message.warning(
        `Please select a material for all handling units with store in quantity.`,
      );
      return;
    }

    // Validate total does not exceed received_qty
    if (totalStoreInQty > receivedQty) {
      this.$message.warning(
        `Total store in quantity (${totalStoreInQty}) cannot exceed received quantity (${receivedQty}).`,
      );
      return;
    }

    const tableGR = data.table_gr;
    const currentItem = tableGR[rowIndex];
    const remainingQty = parseFloat((receivedQty - totalStoreInQty).toFixed(3));
    const uomConversion = currentItem.uom_conversion || 1;
    const parentIndex = currentItem.parent_index ?? rowIndex;

    // Determine if split is needed:
    // - Multiple HUs selected (each HU gets own row)
    // - OR remaining qty exists (need child without HU)
    const needsSplit = confirmedHUs.length > 1 || remainingQty > 0;

    // Warn user if there's remaining qty without HU
    if (remainingQty > 0 && totalStoreInQty > 0) {
      try {
        await this.$confirm(
          `Total HU quantity (${totalStoreInQty}) is less than received quantity (${receivedQty}). A new line with ${remainingQty} without HU will be created. Continue?`,
          "Remaining Quantity",
          {
            confirmButtonText: "Yes",
            cancelButtonText: "No",
            type: "warning",
          }
        );
      } catch {
        // User cancelled - don't proceed
        return;
      }
    }

    if (needsSplit && totalStoreInQty > 0) {
      const latestTableGR = [];

      // Check if current row is already a child
      if (currentItem.parent_or_child === "Child") {
        // Scenario: Child row - add sibling children for each HU
        const existingChildren = tableGR.filter(
          (row) =>
            row.parent_or_child === "Child" && row.parent_index === parentIndex
        );
        let nextChildNum = existingChildren.length + 1;

        for (const [index, item] of tableGR.entries()) {
          if (index === rowIndex) {
            // First HU goes to current child row
            const firstHU = confirmedHUs[0];
            const firstHUQty = parseFloat(firstHU.store_in_quantity) || 0;

            const updatedChild = {
              ...item,
              received_qty: firstHUQty,
              base_received_qty: firstHUQty * uomConversion,
              to_received_qty: firstHUQty,
              temp_hu_data: JSON.stringify([firstHU]),
              view_hu: await formatViewHU([firstHU]),
            };
            latestTableGR.push(updatedChild);

            // Create sibling children for remaining HUs (index 1+)
            for (let i = 1; i < confirmedHUs.length; i++) {
              const hu = confirmedHUs[i];
              const huQty = parseFloat(hu.store_in_quantity) || 0;

              const siblingChild = {
                ...item,
                line_index: `${parentIndex + 1} - ${nextChildNum}`,
                ordered_qty: 0,
                base_ordered_qty: 0,
                to_received_qty: huQty,
                received_qty: huQty,
                base_received_qty: huQty * uomConversion,
                initial_received_qty: 0,
                storage_location_id: storageLocationId,
                location_id: locationId,
                temp_hu_data: JSON.stringify([hu]),
                view_hu: await formatViewHU([hu]),
                is_split: "No",
                parent_or_child: "Child",
                parent_index: parentIndex,
              };
              latestTableGR.push(siblingChild);
              nextChildNum++;
            }

            // Add sibling for remaining qty (no HU)
            if (remainingQty > 0) {
              const siblingWithoutHU = {
                ...item,
                line_index: `${parentIndex + 1} - ${nextChildNum}`,
                ordered_qty: 0,
                base_ordered_qty: 0,
                to_received_qty: remainingQty,
                received_qty: remainingQty,
                base_received_qty: remainingQty * uomConversion,
                initial_received_qty: 0,
                storage_location_id: storageLocationId,
                location_id: locationId,
                temp_hu_data: "[]",
                is_split: "No",
                parent_or_child: "Child",
                parent_index: parentIndex,
              };
              latestTableGR.push(siblingWithoutHU);
            }
          } else {
            latestTableGR.push(item);
          }
        }
      } else {
        // Scenario: Regular row - create Parent + N Children (one per HU) + remaining
        for (const [index, item] of tableGR.entries()) {
          if (index === rowIndex) {
            // Parent row (summary)
            const parentItem = {
              ...item,
              line_index: parentIndex + 1,
              received_qty: receivedQty,
              base_received_qty: receivedQty * uomConversion,
              storage_location_id: "",
              location_id: "",
              temp_hu_data: "[]",
              is_split: "Yes",
              parent_or_child: "Parent",
              parent_index: parentIndex,
            };
            latestTableGR.push(parentItem);

            // Create one child per HU
            let childNum = 1;
            for (const hu of confirmedHUs) {
              const huQty = parseFloat(hu.store_in_quantity) || 0;

              const childWithHU = {
                ...item,
                line_index: `${parentIndex + 1} - ${childNum}`,
                ordered_qty: 0,
                base_ordered_qty: 0,
                to_received_qty: huQty,
                received_qty: huQty,
                base_received_qty: huQty * uomConversion,
                initial_received_qty: 0,
                storage_location_id: storageLocationId,
                location_id: locationId,
                temp_hu_data: JSON.stringify([hu]),
                view_hu: await formatViewHU([hu]),
                is_split: "No",
                parent_or_child: "Child",
                parent_index: parentIndex,
              };
              latestTableGR.push(childWithHU);
              childNum++;
            }

            // Child for remaining qty (no HU)
            if (remainingQty > 0) {
              const childWithoutHU = {
                ...item,
                line_index: `${parentIndex + 1} - ${childNum}`,
                ordered_qty: 0,
                base_ordered_qty: 0,
                to_received_qty: remainingQty,
                received_qty: remainingQty,
                base_received_qty: remainingQty * uomConversion,
                initial_received_qty: 0,
                storage_location_id: storageLocationId,
                location_id: locationId,
                temp_hu_data: "[]",
                is_split: "No",
                parent_or_child: "Child",
                parent_index: parentIndex,
              };
              latestTableGR.push(childWithoutHU);
            }
          } else {
            latestTableGR.push(item);
          }
        }
      }

      await this.setData({ table_gr: latestTableGR });

      // Apply field states after split
      const updatedTableGR = this.getValue("table_gr");
      for (const [index, item] of updatedTableGR.entries()) {
        if (item.is_split === "Yes" && item.parent_or_child === "Parent") {
          this.disabled(
            [
              `table_gr.${index}.received_qty`,
              `table_gr.${index}.base_received_qty`,
              `table_gr.${index}.storage_location_id`,
              `table_gr.${index}.location_id`,
              `table_gr.${index}.select_serial_number`,
              `table_gr.${index}.inv_category`,
              `table_gr.${index}.button_hu`,
            ],
            true,
          );
        } else if (item.parent_or_child === "Child") {
          this.disabled([`table_gr.${index}.button_split`], true);
          this.disabled(
            [
              `table_gr.${index}.item_batch_no`,
              `table_gr.${index}.manufacturing_date`,
              `table_gr.${index}.expired_date`,
            ],
            true,
          );
        }
      }

      // Reset dialog table before closing
      await this.setData({ "hu_dialog.table_hu": [] });
      await this.closeDialog("hu_dialog");

      const huCount = confirmedHUs.length;
      const message =
        remainingQty > 0
          ? `Split created: ${huCount} HU(s) with ${totalStoreInQty}, ${remainingQty} without HU.`
          : `Split created: ${huCount} HU(s) with ${totalStoreInQty} total.`;
      this.$message.success(message);
    } else {
      // No split needed - single HU matches received qty
      await this.setData({
        [`table_gr.${rowIndex}.temp_hu_data`]: JSON.stringify(confirmedHUs),
        [`table_gr.${rowIndex}.view_hu`]: await formatViewHU(confirmedHUs),
      });

      // Reset dialog table before closing
      await this.setData({ "hu_dialog.table_hu": [] });
      await this.closeDialog("hu_dialog");
      this.$message.success("Handling unit selection confirmed.");
    }
  } catch (error) {
    this.$message.error(error.message || String(error));
  }
})();
