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

const setGrItemData = async (
  itemData,
  lineIndex,
  receivedQty,
  storageLocationId,
  locationId,
  lineRemark1,
  lineRemark2,
  lineRemark3,
  isSplit,
  parentOrChild,
  parentIndex,
  selectSerialNumber = [],
  splitSourceIndex = null,
) => {
  // For Split-Parent: treat like regular row (keeps ordered_qty, initial_received_qty, etc.)
  const isSplitParent = parentOrChild === "Split-Parent";

  return {
    // Line identification
    line_index: lineIndex,

    // Item information (copied from parent)
    item_id: itemData.item_id,
    item_name: itemData.item_name,
    item_desc: itemData.item_desc,
    more_desc: itemData.more_desc,

    // Quantity fields - Split-Parent keeps ordered_qty proportionally
    ordered_qty:
      parentOrChild === "Parent" || isSplitParent ? itemData.ordered_qty : 0,
    ordered_qty_uom: itemData.ordered_qty_uom,
    base_ordered_qty:
      parentOrChild === "Parent" || isSplitParent
        ? itemData.base_ordered_qty
        : 0,
    base_ordered_qty_uom: itemData.base_ordered_qty_uom,
    to_received_qty:
      parentOrChild === "Parent"
        ? (itemData.ordered_qty || 0) - (itemData.initial_received_qty || 0)
        : isSplitParent
          ? (itemData.ordered_qty || 0) -
            (itemData.initial_received_qty || 0) -
            receivedQty
          : receivedQty,
    to_received_qty_uom: itemData.to_received_qty_uom,
    received_qty:
      isSplit === "No" && parentOrChild === "Parent"
        ? itemData.received_qty
        : receivedQty,
    base_received_qty:
      isSplit === "No" && parentOrChild === "Parent"
        ? itemData.base_received_qty
        : receivedQty * (itemData.uom_conversion || 1),
    base_received_qty_uom: itemData.base_received_qty_uom,
    initial_received_qty:
      parentOrChild === "Parent" || isSplitParent
        ? itemData.initial_received_qty
        : 0,
    item_uom: itemData.item_uom,
    base_item_uom: itemData.base_item_uom,
    uom_conversion: itemData.uom_conversion,

    // Location fields
    storage_location_id: storageLocationId,
    location_id: locationId,

    // Batch and inspection - Split-Parent clears batch only for manual-entry
    // batch items. "-" (non-batch) and "Auto-generated batch number" are
    // sentinels that must be preserved.
    item_batch_no: isSplitParent
      ? itemData.item_batch_no === "-" ||
        itemData.item_batch_no === "Auto-generated batch number"
        ? itemData.item_batch_no
        : ""
      : itemData.item_batch_no,
    manufacturing_date:
      isSplitParent && itemData.item_batch_no !== "-"
        ? null
        : itemData.manufacturing_date,
    expired_date:
      isSplitParent && itemData.item_batch_no !== "-"
        ? null
        : itemData.expired_date,
    inspection_required: itemData.inspection_required,
    inv_category: itemData.inv_category,

    // PO reference (copied from parent)
    line_po_no: itemData.line_po_no,
    line_po_id: itemData.line_po_id,
    po_line_item_id: itemData.po_line_item_id,

    // Pricing
    unit_price: itemData.unit_price,
    total_price:
      parentOrChild === "Parent"
        ? itemData.total_price
        : receivedQty * itemData.unit_price,
    item_costing_method: itemData.item_costing_method,
    item_category_id: itemData.item_category_id,

    // Serialization
    is_serialized_item: itemData.is_serialized_item,
    serial_numbers: selectSerialNumber,
    select_serial_number: selectSerialNumber,

    // Formula
    has_formula: itemData.has_formula,
    formula: itemData.formula,

    // Remarks
    line_remark_1: lineRemark1,
    line_remark_2: lineRemark2,
    line_remark_3: lineRemark3,

    // Split tracking fields
    is_split: isSplit,
    parent_or_child: parentOrChild,
    parent_index: parentIndex,

    // Split-Parent tracking: original row index before split
    split_source_index: splitSourceIndex,
  };
};

(async () => {
  try {
    const data = this.getValues();
    const tableGR = data.table_gr;
    const splitDialogData = data.split_dialog;
    const tableSplit = splitDialogData.table_split;
    const rowIndex = splitDialogData.rowIndex;
    const isParentSplit = splitDialogData.is_parent_split;

    // Validate total split quantity with over_receive_tolerance
    const totalSplitQty = parseFloat(
      tableSplit
        .reduce((sum, item) => sum + (parseFloat(item.received_qty) || 0), 0)
        .toFixed(3),
    );

    const toReceivedQty = splitDialogData.to_received_qty;

    // Get the item's over_receive_tolerance
    const itemId = tableGR[rowIndex].item_id;
    let overReceiveTolerance = 0;

    if (itemId) {
      const { data: itemData } = await db
        .collection("Item")
        .where({ id: itemId })
        .get();
      if (itemData && itemData.length > 0) {
        overReceiveTolerance = itemData[0].over_receive_tolerance || 0;
      }
    }

    // Calculate maximum allowed quantity with tolerance
    const maxAllowedQty = parseFloat(
      ((toReceivedQty * (100 + overReceiveTolerance)) / 100).toFixed(3),
    );

    if (totalSplitQty <= 0) {
      throw new Error("Total split quantity must be greater than 0.");
    }

    if (totalSplitQty > maxAllowedQty) {
      throw new Error(
        `Total split quantity (${totalSplitQty}) exceeds maximum allowed quantity (${maxAllowedQty}) based on tolerance.`,
      );
    }

    const latestTableGR = [];

    for (const [index, grItem] of tableGR.entries()) {
      if (index === rowIndex) {
        // Check if this is a split-parent (parallel) split
        if (isParentSplit === 1) {
          // Split-Parent mode: Create N independent rows (no hierarchy)
          const baseLineIndex = grItem.parent_index + 1;

          for (const [dialogLineIndex, dialogItem] of tableSplit.entries()) {
            const letterSuffix = getLetterSuffix(dialogLineIndex);
            const splitParentItem = await setGrItemData(
              grItem,
              `${baseLineIndex}-${letterSuffix}`, // e.g., "1-A", "1-B"
              dialogItem.received_qty,
              dialogItem.storage_location_id,
              dialogItem.location_id,
              dialogItem.line_remark_1,
              dialogItem.line_remark_2,
              dialogItem.line_remark_3,
              "Yes", // is_split
              "Split-Parent", // NEW: Split-Parent type
              index, // parent_index (for tracking)
              dialogItem.select_serial_number || [],
              index, // split_source_index
            );
            latestTableGR.push(splitParentItem);
          }
        } else {
          // Hierarchy mode: Create parent row + child rows (existing behavior)
          // Create parent row (summary row, no location/qty editable)
          const parentItem = await setGrItemData(
            grItem,
            grItem.parent_index + 1,
            totalSplitQty,
            "", // storage_location_id cleared for parent
            "", // location_id cleared for parent
            grItem.line_remark_1,
            grItem.line_remark_2,
            grItem.line_remark_3,
            "Yes", // is_split
            "Parent",
            index,
            grItem.select_serial_number,
          );
          latestTableGR.push(parentItem);

          // Create child rows from split dialog
          for (const [dialogLineIndex, dialogItem] of tableSplit.entries()) {
            const childItem = await setGrItemData(
              grItem,
              `${grItem.parent_index + 1} - ${dialogLineIndex + 1}`,
              dialogItem.received_qty,
              dialogItem.storage_location_id,
              dialogItem.location_id,
              dialogItem.line_remark_1,
              dialogItem.line_remark_2,
              dialogItem.line_remark_3,
              "No", // is_split
              "Child",
              index,
              dialogItem.select_serial_number || [],
            );
            latestTableGR.push(childItem);
          }
        }
      } else {
        // Preserve existing row unchanged
        const preservedItem = await setGrItemData(
          grItem,
          grItem.line_index,
          grItem.received_qty,
          grItem.storage_location_id,
          grItem.location_id,
          grItem.line_remark_1,
          grItem.line_remark_2,
          grItem.line_remark_3,
          grItem.is_split,
          grItem.parent_or_child,
          grItem.parent_index,
          grItem.select_serial_number,
          grItem.split_source_index,
        );
        latestTableGR.push(preservedItem);
      }
    }

    await this.setData({ table_gr: latestTableGR });

    // Apply field states after data update
    const updatedTableGR = this.getValue("table_gr");

    for (const [index, grItem] of updatedTableGR.entries()) {
      if (grItem.is_split === "Yes" && grItem.parent_or_child === "Parent") {
        // Disable most fields for split parent, but keep editable:
        // - item_batch_no (if manually entered)
        // - manufacturing_date
        // - expired_date
        // (user fills these on parent, children inherit them)
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

        // Clear location fields display for parent
        this.setData({
          [`table_gr.${index}.storage_location_id`]: "",
          [`table_gr.${index}.location_id`]: "",
        });
      } else if (grItem.parent_or_child === "Split-Parent") {
        // Split-Parent rows: behave like regular rows (independent location,
        // batch, etc.) but re-splitting is disabled.
        this.disabled([`table_gr.${index}.button_split`], true);

        // Enable non-batch editable fields
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

        // Batch field: enabled only for manual-entry batch items (""). "-"
        // (non-batch) and "Auto-generated batch number" stay disabled.
        const isManualBatch =
          grItem.item_batch_no === "" && grItem.item_id;
        this.disabled(
          [`table_gr.${index}.item_batch_no`],
          !isManualBatch,
        );

        // Manufacturing/expired dates: disabled for non-batch items
        const isNonBatch = grItem.item_batch_no === "-";
        this.disabled(
          [
            `table_gr.${index}.manufacturing_date`,
            `table_gr.${index}.expired_date`,
          ],
          isNonBatch,
        );

        // Handle serialized items for Split-Parent
        if (grItem.is_serialized_item === 1) {
          this.disabled(
            [
              `table_gr.${index}.select_serial_number`,
              `table_gr.${index}.received_qty`,
            ],
            false,
          );
        }
      } else if (grItem.parent_or_child === "Child") {
        // Disable split button for children
        this.disabled([`table_gr.${index}.button_split`], true);

        // Disable batch and date fields for children (inherited from parent)
        this.disabled(
          [
            `table_gr.${index}.item_batch_no`,
            `table_gr.${index}.manufacturing_date`,
            `table_gr.${index}.expired_date`,
          ],
          true,
        );

        // Handle serialized items
        if (grItem.is_serialized_item === 1) {
          this.disabled(
            [
              `table_gr.${index}.select_serial_number`,
              `table_gr.${index}.received_qty`,
            ],
            true,
          );
        }
      } else {
        // Regular non-split row - enable split button
        this.disabled([`table_gr.${index}.button_split`], false);

        if (grItem.is_serialized_item === 1) {
          this.disabled(
            [
              `table_gr.${index}.select_serial_number`,
              `table_gr.${index}.received_qty`,
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
