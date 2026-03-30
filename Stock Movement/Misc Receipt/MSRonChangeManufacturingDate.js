// onChange handler for manufacturing_date field
// When parent's manufacturing_date changes, auto-update all children

(async () => {
  try {
    const manufacturingDate = arguments[0].value;
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
          updates[`stock_movement.${idx}.manufacturing_date`] =
            manufacturingDate;
        }
      });

      // Update all children's manufacturing_date
      if (Object.keys(updates).length > 0) {
        await this.setData(updates);
      }
    }
  } catch (error) {
    console.error("Error updating manufacturing date:", error);
  }
})();
