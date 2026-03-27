// Helper function to round quantity to 3 decimal places
const roundQty = (value) => {
  return Math.round(value * 1000) / 1000;
};

(async () => {
  try {
    // Get input values
    const quantity = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    // Validate inputs
    if (rowIndex === undefined || rowIndex === null) {
      console.error("Row index is missing");
      return;
    }

    if (quantity === undefined || quantity === null) {
      console.error("Quantity value is missing");
      return;
    }

    // Check if line has HU data - if quantity changed, confirm reset
    const tempHuDataStr = this.getValue(`table_gr.${rowIndex}.temp_hu_data`);
    const uomConversionCheck =
      this.getValue(`table_gr.${rowIndex}.uom_conversion`) || 1;

    if (tempHuDataStr && tempHuDataStr !== "[]") {
      const tempHuData = JSON.parse(tempHuDataStr);
      const totalStoreInQty = tempHuData.reduce(
        (sum, hu) => sum + (parseFloat(hu.store_in_quantity) || 0),
        0
      );

      // Convert totalStoreInQty to base UOM for comparison
      const totalStoreInBaseQty = totalStoreInQty * uomConversionCheck;

      // If new quantity differs from HU total (in base UOM), warn user
      if (quantity !== totalStoreInBaseQty) {
        try {
          await this.$confirm(
            "Changing the received quantity will reset the selected Handling Units. Do you want to continue?",
            "Warning",
            {
              confirmButtonText: "Yes",
              cancelButtonText: "No",
              type: "warning",
            }
          );

          // User confirmed - clear temp_hu_data and view_hu
          await this.setData({
            [`table_gr.${rowIndex}.temp_hu_data`]: "[]",
            [`table_gr.${rowIndex}.view_hu`]: "",
          });
        } catch {
          // User cancelled - revert to HU total (in base UOM)
          await this.setData({
            [`table_gr.${rowIndex}.base_received_qty`]: totalStoreInBaseQty,
          });
          return;
        }
      }
    }

    // Skip calculation for hierarchy split parent rows (their quantities are managed by split logic)
    // Note: Split-Parent rows are treated like regular rows (no skip)
    const isSplit = this.getValue(`table_gr.${rowIndex}.is_split`);
    const parentOrChild = this.getValue(`table_gr.${rowIndex}.parent_or_child`);
    if (isSplit === "Yes" && parentOrChild === "Parent") {
      return;
    }

    // Split-Parent rows: treat like regular rows (fall through to regular logic)
    // They are independent and can have their own quantities validated normally

    // For child rows: validate total children qty against parent's ordered qty
    if (parentOrChild === "Child") {
      const uomConversion =
        this.getValue(`table_gr.${rowIndex}.uom_conversion`) || 0;
      const receivedQty = roundQty(
        uomConversion > 0 ? quantity / uomConversion : quantity
      );

      const parentIndex = this.getValue(`table_gr.${rowIndex}.parent_index`);
      const tableGR = this.getValue("table_gr");

      // Find parent row to get ordered_qty
      const parentRow = tableGR.find(
        (row) =>
          row.is_split === "Yes" &&
          row.parent_or_child === "Parent" &&
          row.parent_index === parentIndex
      );

      if (parentRow) {
        const parentOrderedQty = parseFloat(parentRow.ordered_qty) || 0;
        const parentInitialReceivedQty =
          parseFloat(parentRow.initial_received_qty) || 0;
        const parentRemainingQty = parentOrderedQty - parentInitialReceivedQty;

        // Get all sibling children (excluding current row)
        const siblingChildren = tableGR.filter(
          (row, idx) =>
            row.parent_or_child === "Child" &&
            row.parent_index === parentIndex &&
            idx !== rowIndex
        );

        // Sum siblings' received_qty
        const siblingsTotal = siblingChildren.reduce(
          (sum, child) => sum + (parseFloat(child.received_qty) || 0),
          0
        );

        // Total with new value
        const totalChildrenQty = roundQty(siblingsTotal + receivedQty);

        // Get tolerance from item
        const itemId = this.getValue(`table_gr.${rowIndex}.item_id`);
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

        // Calculate max allowed with tolerance
        const maxAllowedQty = roundQty(
          (parentRemainingQty * (100 + overReceiveTolerance)) / 100
        );

        // Validate
        if (totalChildrenQty > maxAllowedQty) {
          this.$message.warning(
            `Total split quantity (${totalChildrenQty}) exceeds maximum allowed (${maxAllowedQty}).`
          );
        }
      }

      await this.setData({
        [`table_gr.${rowIndex}.received_qty`]: receivedQty,
      });
      return;
    }

    // Get table values
    const orderedQty = this.getValue(`table_gr.${rowIndex}.ordered_qty`) || 0;
    const baseOrderedQty =
      this.getValue(`table_gr.${rowIndex}.base_ordered_qty`) || 0;
    const initialReceivedQty =
      this.getValue(`table_gr.${rowIndex}.initial_received_qty`) || 0;
    const uomConversion =
      this.getValue(`table_gr.${rowIndex}.uom_conversion`) || 0;

    console.log("Calculation inputs:", {
      quantity,
      rowIndex,
      orderedQty,
      baseOrderedQty,
      initialReceivedQty,
      uomConversion,
    });

    // quantity is base_received_qty, divide by uomConversion to get received_qty (alt UOM)
    // Apply rounding to avoid floating-point precision issues
    const receivedQty = roundQty(
      uomConversion > 0 ? quantity / uomConversion : quantity,
    );

    // Calculate remaining qty in alt UOM (orderedQty, receivedQty, initialReceivedQty are all in alt UOM)
    const toReceivedQty = roundQty(
      orderedQty - receivedQty - initialReceivedQty,
    );

    await this.setData({
      [`table_gr.${rowIndex}.received_qty`]: receivedQty,
      [`table_gr.${rowIndex}.to_received_qty`]: toReceivedQty,
    });
  } catch (error) {
    console.error("Error in quantity calculation:", error);

    // Log additional error details
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    this.$message.error(
      "An error occurred while calculating quantities. Please try again.",
    );
  }
})();
