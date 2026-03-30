// onChange handler for expired_date field
// When parent's expired_date changes, auto-update all children

(async () => {
  try {
    const expiredDate = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    if (rowIndex === undefined || rowIndex === null) {
      return;
    }

    // Check if this is a split parent row
    const isSplit = this.getValue(`stock_movement.${rowIndex}.is_split`);
    const parentOrChild = this.getValue(
      `stock_movement.${rowIndex}.parent_or_child`,
    );

    // Only propagate to children if this is a split parent
    if (isSplit === "Yes" && parentOrChild === "Parent") {
      const parentIndex = this.getValue(
        `stock_movement.${rowIndex}.parent_index`,
      );
      const tableSM = this.getValue("stock_movement");

      // Find all children belonging to this parent
      const updates = {};
      tableSM.forEach((row, idx) => {
        if (
          row.parent_or_child === "Child" &&
          row.parent_index === parentIndex
        ) {
          updates[`stock_movement.${idx}.expired_date`] = expiredDate;
        }
      });

      // Update all children's expired_date
      if (Object.keys(updates).length > 0) {
        await this.setData(updates);
      }
    }
  } catch (error) {
    console.error("Error updating expired date:", error);
  }
})();
