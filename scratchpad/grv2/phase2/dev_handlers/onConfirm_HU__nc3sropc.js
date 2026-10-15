// Helper to build a table_gr row with all fields explicitly assigned (no spread)
// This prevents shared reactive references between rows in the platform
const buildGrRow = (
  sourceItem,
  lineIndex,
  receivedQty,
  storageLocationId,
  locationId,
  isSplit,
  parentOrChild,
  parentIndex,
  tempHuData,
  viewHu,
  overrides = {},
) => {
  const uomConversion = sourceItem.uom_conversion || 1;
  const isParent = isSplit === "Yes" && parentOrChild === "Parent";
  const isChild = parentOrChild === "Child";

  return {
    // Line identification
    line_index: lineIndex,

    // Item information
    item_id: sourceItem.item_id,
    item_name: sourceItem.item_name,
    item_desc: sourceItem.item_desc,
    more_desc: sourceItem.more_desc,

    // Quantity fields
    ordered_qty: isParent ? sourceItem.ordered_qty : isChild ? 0 : sourceItem.ordered_qty,
    ordered_qty_uom: sourceItem.ordered_qty_uom,
    base_ordered_qty: isParent ? sourceItem.base_ordered_qty : isChild ? 0 : sourceItem.base_ordered_qty,
    base_ordered_qty_uom: sourceItem.base_ordered_qty_uom,
    to_received_qty: isParent
      ? (sourceItem.ordered_qty || 0) - (sourceItem.initial_received_qty || 0)
      : receivedQty,
    to_received_qty_uom: sourceItem.to_received_qty_uom,
    received_qty: receivedQty,
    base_received_qty: receivedQty * uomConversion,
    base_received_qty_uom: sourceItem.base_received_qty_uom,
    initial_received_qty: isChild ? 0 : sourceItem.initial_received_qty,
    item_uom: sourceItem.item_uom,
    base_item_uom: sourceItem.base_item_uom,
    uom_conversion: uomConversion,

    // Location fields
    storage_location_id: storageLocationId,
    location_id: locationId,

    // Batch and inspection
    item_batch_no: sourceItem.item_batch_no,
    manufacturing_date: sourceItem.manufacturing_date,
    expired_date: sourceItem.expired_date,
    inspection_required: sourceItem.inspection_required,
    inv_category: sourceItem.inv_category,

    // PO reference
    line_po_no: sourceItem.line_po_no,
    line_po_id: sourceItem.line_po_id,
    po_line_item_id: sourceItem.po_line_item_id,

    // Pricing
    unit_price: sourceItem.unit_price,
    total_price: isParent
      ? sourceItem.total_price
      : receivedQty * (sourceItem.unit_price || 0),
    item_costing_method: sourceItem.item_costing_method,
    item_category_id: sourceItem.item_category_id,

    // Serialization
    is_serialized_item: sourceItem.is_serialized_item,
    serial_numbers: sourceItem.serial_numbers
      ? [...sourceItem.serial_numbers]
      : [],
    select_serial_number: sourceItem.select_serial_number
      ? [...sourceItem.select_serial_number]
      : [],

    // Formula
    has_formula: sourceItem.has_formula,
    formula: sourceItem.formula,

    // Remarks
    line_remark_1: sourceItem.line_remark_1,
    line_remark_2: sourceItem.line_remark_2,
    line_remark_3: sourceItem.line_remark_3,

    // HU data
    temp_hu_data: tempHuData,
    view_hu: viewHu,

    // Split tracking
    is_split: isSplit,
    parent_or_child: parentOrChild,
    parent_index: parentIndex,
    split_source_index: sourceItem.split_source_index ?? null,

    // Apply any additional overrides
    ...overrides,
  };
};

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
    const formatViewHU = async (huArray) => {
      if (!huArray || huArray.length === 0) return "";

      const hu = huArray[0];
      const huName = hu.handling_no || hu.handling_unit_id || "New HU";
      const qty = hu.store_in_quantity || 0;

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
    const remainingQty = parseFloat((receivedQty - totalStoreInQty));
    const parentIndex = currentItem.parent_index ?? rowIndex;

    // Determine if split is needed
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
          },
        );
      } catch {
        return;
      }
    }

    if (needsSplit && totalStoreInQty > 0) {
      const latestTableGR = [];

      if (currentItem.parent_or_child === "Child") {
        // Scenario: Child row - add sibling children for each HU
        const existingChildren = tableGR.filter(
          (row) =>
            row.parent_or_child === "Child" && row.parent_index === parentIndex,
        );
        let nextChildNum = existingChildren.length + 1;

        for (const [index, item] of tableGR.entries()) {
          if (index === rowIndex) {
            // First HU goes to current child row
            const firstHU = confirmedHUs[0];
            const firstHUQty = parseFloat(firstHU.store_in_quantity) || 0;

            latestTableGR.push(
              buildGrRow(
                item,
                item.line_index,
                firstHUQty,
                item.storage_location_id,
                item.location_id,
                item.is_split || "No",
                "Child",
                parentIndex,
                JSON.stringify([firstHU]),
                await formatViewHU([firstHU]),
              ),
            );

            // Create sibling children for remaining HUs
            for (let i = 1; i < confirmedHUs.length; i++) {
              const hu = confirmedHUs[i];
              const huQty = parseFloat(hu.store_in_quantity) || 0;

              latestTableGR.push(
                buildGrRow(
                  item,
                  `${parentIndex + 1} - ${nextChildNum}`,
                  huQty,
                  storageLocationId,
                  locationId,
                  "No",
                  "Child",
                  parentIndex,
                  JSON.stringify([hu]),
                  await formatViewHU([hu]),
                ),
              );
              nextChildNum++;
            }

            // Sibling for remaining qty (no HU)
            if (remainingQty > 0) {
              latestTableGR.push(
                buildGrRow(
                  item,
                  `${parentIndex + 1} - ${nextChildNum}`,
                  remainingQty,
                  storageLocationId,
                  locationId,
                  "No",
                  "Child",
                  parentIndex,
                  "[]",
                  "",
                ),
              );
            }
          } else {
            // Preserve existing row (rebuild to avoid shared references)
            latestTableGR.push(
              buildGrRow(
                item,
                item.line_index,
                item.received_qty,
                item.storage_location_id,
                item.location_id,
                item.is_split || "No",
                item.parent_or_child || "Parent",
                item.parent_index ?? index,
                item.temp_hu_data || "[]",
                item.view_hu || "",
              ),
            );
          }
        }
      } else {
        // Scenario: Regular row - create Parent + N Children + remaining
        for (const [index, item] of tableGR.entries()) {
          if (index === rowIndex) {
            // Parent row (summary)
            latestTableGR.push(
              buildGrRow(
                item,
                parentIndex + 1,
                receivedQty,
                "",
                "",
                "Yes",
                "Parent",
                parentIndex,
                "[]",
                "",
              ),
            );

            // One child per HU
            let childNum = 1;
            for (const hu of confirmedHUs) {
              const huQty = parseFloat(hu.store_in_quantity) || 0;

              latestTableGR.push(
                buildGrRow(
                  item,
                  `${parentIndex + 1} - ${childNum}`,
                  huQty,
                  storageLocationId,
                  locationId,
                  "No",
                  "Child",
                  parentIndex,
                  JSON.stringify([hu]),
                  await formatViewHU([hu]),
                ),
              );
              childNum++;
            }

            // Child for remaining qty (no HU)
            if (remainingQty > 0) {
              latestTableGR.push(
                buildGrRow(
                  item,
                  `${parentIndex + 1} - ${childNum}`,
                  remainingQty,
                  storageLocationId,
                  locationId,
                  "No",
                  "Child",
                  parentIndex,
                  "[]",
                  "",
                ),
              );
            }
          } else {
            // Preserve existing row (rebuild to avoid shared references)
            latestTableGR.push(
              buildGrRow(
                item,
                item.line_index,
                item.received_qty,
                item.storage_location_id,
                item.location_id,
                item.is_split || "No",
                item.parent_or_child || "Parent",
                item.parent_index ?? index,
                item.temp_hu_data || "[]",
                item.view_hu || "",
              ),
            );
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
