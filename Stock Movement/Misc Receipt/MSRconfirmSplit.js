// Helper to generate letter suffix (A, B, C, ..., Z, AA, AB, ...)
const getLetterSuffix = (index) => {
  let suffix = "";
  let num = index;
  while (num >= 0) {
    suffix = String.fromCharCode(65 + (num % 26)) + suffix;
    num = Math.floor(num / 26) - 1;
  }
  return suffix;
};

// Helper to build a stock_movement row with all fields explicitly assigned (no spread)
// This prevents shared reactive references between rows in the platform
const buildMsrSplitRow = (
  sourceItem,
  lineIndex,
  receivedQty,
  storageLocationId,
  locationId,
  category,
  itemRemark,
  itemRemark2,
  itemRemark3,
  isSplit,
  parentOrChild,
  parentIndex,
  selectSerialNumber = [],
  splitSourceIndex = null,
) => {
  const isSplitParent = parentOrChild === "Split-Parent";

  return {
    // Line identification
    line_index: lineIndex,

    // Item information
    item_selection: sourceItem.item_selection,
    item_name: sourceItem.item_name,
    item_desc: sourceItem.item_desc,

    // Quantity
    received_quantity:
      isSplit === "No" && parentOrChild === "Parent"
        ? sourceItem.received_quantity
        : receivedQty,
    received_quantity_uom: sourceItem.received_quantity_uom,

    // Pricing
    unit_price: sourceItem.unit_price || 0,
    amount:
      parentOrChild === "Parent"
        ? sourceItem.amount
        : receivedQty * (sourceItem.unit_price || 0),

    // Location
    storage_location_id: storageLocationId,
    location_id: locationId,

    // Batch - Split-Parent clears batch (each fills own)
    batch_id: isSplitParent ? "" : sourceItem.batch_id,
    manufacturing_date: isSplitParent ? null : sourceItem.manufacturing_date,
    expired_date: isSplitParent ? null : sourceItem.expired_date,

    // Category
    category: category,

    // Serial number
    is_serialized_item: sourceItem.is_serialized_item,
    select_serial_number: selectSerialNumber
      ? [...selectSerialNumber]
      : [],

    // Stock
    stock_summary: sourceItem.stock_summary || "",
    balance_id: sourceItem.balance_id || "",
    temp_qty_data: sourceItem.temp_qty_data || "",

    // UOM options (needed for dropdown)
    uom_options: sourceItem.uom_options ? [...sourceItem.uom_options] : [],

    // Remarks
    item_remark: itemRemark,
    item_remark2: itemRemark2,
    item_remark3: itemRemark3,

    // HU data (always cleared for split rows)
    temp_hu_data: "[]",
    view_hu: "",

    // Split tracking
    is_split: isSplit,
    parent_or_child: parentOrChild,
    parent_index: parentIndex,
    split_source_index: splitSourceIndex,
  };
};

(async () => {
  try {
    const data = this.getValues();
    const tableSM = data.stock_movement;
    const splitDialogData = data.split_dialog;
    const tableSplit = splitDialogData.table_split;
    const rowIndex = splitDialogData.rowIndex;
    const isParentSplit = splitDialogData.is_parent_split;

    // Validate total split quantity
    const totalSplitQty = parseFloat(
      tableSplit
        .reduce((sum, item) => sum + (parseFloat(item.received_qty) || 0), 0)
        .toFixed(3),
    );

    const toReceivedQty = splitDialogData.to_received_qty;

    if (totalSplitQty <= 0) {
      throw new Error("Total split quantity must be greater than 0.");
    }

    if (totalSplitQty > toReceivedQty) {
      throw new Error(
        `Total split quantity (${totalSplitQty}) exceeds quantity to receive (${toReceivedQty}).`,
      );
    }

    const latestTableSM = [];

    for (const [index, msrItem] of tableSM.entries()) {
      if (index === rowIndex) {
        if (isParentSplit === 1) {
          // Split-Parent mode: Create N independent rows
          const baseLineIndex = msrItem.parent_index + 1;

          for (const [dialogLineIndex, dialogItem] of tableSplit.entries()) {
            const letterSuffix = getLetterSuffix(dialogLineIndex);
            const splitParentItem = buildMsrSplitRow(
              msrItem,
              `${baseLineIndex}-${letterSuffix}`,
              dialogItem.received_qty,
              dialogItem.storage_location_id,
              dialogItem.location_id,
              msrItem.category,
              dialogItem.line_remark_1 || "",
              dialogItem.line_remark_2 || "",
              dialogItem.line_remark_3 || "",
              "Yes",
              "Split-Parent",
              index,
              dialogItem.select_serial_number || [],
              index,
            );
            latestTableSM.push(splitParentItem);
          }
        } else {
          // Hierarchy mode: Create parent row + child rows
          const parentItem = buildMsrSplitRow(
            msrItem,
            msrItem.parent_index + 1,
            totalSplitQty,
            "",
            "",
            msrItem.category,
            msrItem.item_remark || "",
            msrItem.item_remark2 || "",
            msrItem.item_remark3 || "",
            "Yes",
            "Parent",
            index,
            msrItem.select_serial_number,
          );
          latestTableSM.push(parentItem);

          // Create child rows from split dialog
          for (const [dialogLineIndex, dialogItem] of tableSplit.entries()) {
            const childItem = buildMsrSplitRow(
              msrItem,
              `${msrItem.parent_index + 1} - ${dialogLineIndex + 1}`,
              dialogItem.received_qty,
              dialogItem.storage_location_id,
              dialogItem.location_id,
              msrItem.category,
              dialogItem.line_remark_1 || "",
              dialogItem.line_remark_2 || "",
              dialogItem.line_remark_3 || "",
              "No",
              "Child",
              index,
              dialogItem.select_serial_number || [],
            );
            latestTableSM.push(childItem);
          }
        }
      } else {
        // Preserve existing row (rebuild to avoid shared references)
        const preservedItem = buildMsrSplitRow(
          msrItem,
          msrItem.line_index,
          msrItem.received_quantity,
          msrItem.storage_location_id,
          msrItem.location_id,
          msrItem.category,
          msrItem.item_remark || "",
          msrItem.item_remark2 || "",
          msrItem.item_remark3 || "",
          msrItem.is_split || "No",
          msrItem.parent_or_child || "Parent",
          msrItem.parent_index ?? index,
          msrItem.select_serial_number,
          msrItem.split_source_index,
        );
        latestTableSM.push(preservedItem);
      }
    }

    await this.setData({ stock_movement: latestTableSM });

    // Apply field states after data update
    const updatedTableSM = this.getValue("stock_movement");

    for (const [index, msrItem] of updatedTableSM.entries()) {
      if (msrItem.is_split === "Yes" && msrItem.parent_or_child === "Parent") {
        // Hierarchy parent: disable most fields
        this.disabled(
          [
            `stock_movement.${index}.received_quantity`,
            `stock_movement.${index}.storage_location_id`,
            `stock_movement.${index}.location_id`,
            `stock_movement.${index}.select_serial_number`,
            `stock_movement.${index}.category`,
            `stock_movement.${index}.button_hu`,
            `stock_movement.${index}.item_remark`,
            `stock_movement.${index}.item_remark2`,
            `stock_movement.${index}.item_remark3`,
          ],
          true,
        );

        // Clear location fields display for parent
        this.setData({
          [`stock_movement.${index}.storage_location_id`]: "",
          [`stock_movement.${index}.location_id`]: "",
        });
      } else if (msrItem.parent_or_child === "Split-Parent") {
        // Split-Parent: independent rows, all fields enabled except re-splitting
        this.disabled([`stock_movement.${index}.button_split`], true);

        this.disabled(
          [
            `stock_movement.${index}.received_quantity`,
            `stock_movement.${index}.storage_location_id`,
            `stock_movement.${index}.location_id`,
            `stock_movement.${index}.batch_id`,
            `stock_movement.${index}.manufacturing_date`,
            `stock_movement.${index}.expired_date`,
            `stock_movement.${index}.category`,
            `stock_movement.${index}.item_remark`,
            `stock_movement.${index}.item_remark2`,
            `stock_movement.${index}.item_remark3`,
          ],
          false,
        );

        // Handle serialized items for Split-Parent
        if (msrItem.is_serialized_item === 1) {
          this.disabled(
            [
              `stock_movement.${index}.select_serial_number`,
              `stock_movement.${index}.received_quantity`,
            ],
            false,
          );
        }
      } else if (msrItem.parent_or_child === "Child") {
        // Child rows: disable split button and inherited fields
        this.disabled([`stock_movement.${index}.button_split`], true);

        this.disabled(
          [
            `stock_movement.${index}.batch_id`,
            `stock_movement.${index}.manufacturing_date`,
            `stock_movement.${index}.expired_date`,
          ],
          true,
        );

        // Handle serialized items
        if (msrItem.is_serialized_item === 1) {
          this.disabled(
            [
              `stock_movement.${index}.select_serial_number`,
              `stock_movement.${index}.received_quantity`,
            ],
            true,
          );
        }
      } else {
        // Regular non-split row
        this.disabled([`stock_movement.${index}.button_split`], false);

        if (msrItem.is_serialized_item === 1) {
          this.disabled(
            [
              `stock_movement.${index}.select_serial_number`,
              `stock_movement.${index}.received_quantity`,
            ],
            false,
          );
        }
      }
    }

    await this.closeDialog("split_dialog");
    await this.triggerEvent("func_reset_split_dialog");
  } catch (error) {
    this.$message.error(error.message || String(error));
  }
})();
