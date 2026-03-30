(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const smRow = arguments[0].row;
    const quantity = arguments[0].value;

    if (rowIndex === undefined || rowIndex === null) {
      return;
    }

    if (quantity === undefined || quantity === null) {
      return;
    }

    // Handle negative quantity
    if (quantity < 0) {
      this.$message.error("Quantity cannot be negative");
      this.setData({
        [`stock_movement.${rowIndex}.received_quantity`]: 0,
        [`stock_movement.${rowIndex}.amount`]: 0,
      });
      return;
    }

    // Check if line has HU data - if quantity changed, confirm reset
    const tempHuDataStr = this.getValue(
      `stock_movement.${rowIndex}.temp_hu_data`,
    );

    if (tempHuDataStr && tempHuDataStr !== "[]") {
      const tempHuData = JSON.parse(tempHuDataStr);
      const totalStoreInQty = tempHuData.reduce(
        (sum, hu) => sum + (parseFloat(hu.store_in_quantity) || 0),
        0,
      );

      // If new quantity differs from HU total, warn user
      if (quantity !== totalStoreInQty) {
        try {
          await this.$confirm(
            "Changing the received quantity will reset the selected Handling Units. Do you want to continue?",
            "Warning",
            {
              confirmButtonText: "Yes",
              cancelButtonText: "No",
              type: "warning",
            },
          );

          // User confirmed - clear temp_hu_data and view_hu
          await this.setData({
            [`stock_movement.${rowIndex}.temp_hu_data`]: "[]",
            [`stock_movement.${rowIndex}.view_hu`]: "",
          });
        } catch {
          // User cancelled - revert to HU total
          await this.setData({
            [`stock_movement.${rowIndex}.received_quantity`]: totalStoreInQty,
          });
          return;
        }
      }
    }

    // Skip calculation for split parent rows (quantities managed by split logic)
    const isSplit = this.getValue(`stock_movement.${rowIndex}.is_split`);
    const parentOrChild = this.getValue(
      `stock_movement.${rowIndex}.parent_or_child`,
    );
    if (isSplit === "Yes" && parentOrChild === "Parent") {
      return;
    }

    // For child rows: validate total children qty against parent's received qty
    if (parentOrChild === "Child") {
      const parentIndex = this.getValue(
        `stock_movement.${rowIndex}.parent_index`,
      );
      const tableSM = this.getValue("stock_movement");

      // Find parent row
      const parentRow = tableSM.find(
        (row) =>
          row.is_split === "Yes" &&
          row.parent_or_child === "Parent" &&
          row.parent_index === parentIndex,
      );

      if (parentRow) {
        const parentReceivedQty =
          parseFloat(parentRow.received_quantity) || 0;

        // Get all sibling children (excluding current row)
        const siblingChildren = tableSM.filter(
          (row, idx) =>
            row.parent_or_child === "Child" &&
            row.parent_index === parentIndex &&
            idx !== rowIndex,
        );

        const siblingsTotal = siblingChildren.reduce(
          (sum, child) => sum + (parseFloat(child.received_quantity) || 0),
          0,
        );

        const totalChildrenQty = parseFloat(
          (siblingsTotal + quantity).toFixed(3),
        );

        if (totalChildrenQty > parentReceivedQty) {
          this.$message.warning(
            `Total split quantity (${totalChildrenQty}) exceeds parent quantity (${parentReceivedQty}).`,
          );
        }
      }
    }

    // Calculate amount for the row
    const unitPrice = smRow.unit_price || 0;
    const totalAmount = parseFloat((quantity * unitPrice).toFixed(4));

    this.setData({
      [`stock_movement.${rowIndex}.amount`]: totalAmount,
    });
  } catch (error) {
    console.error("Error in quantity change handler:", error);
    this.$message.error(
      error.message || "An error occurred while updating quantity.",
    );
  }
})();
