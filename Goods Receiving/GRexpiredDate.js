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
    const isSplit = this.getValue(`table_gr.${rowIndex}.is_split`);
    const parentOrChild = this.getValue(`table_gr.${rowIndex}.parent_or_child`);

    // Only propagate to children if this is a split parent
    if (isSplit === "Yes" && parentOrChild === "Parent") {
      const parentIndex = this.getValue(`table_gr.${rowIndex}.parent_index`);
      const tableGR = this.getValue("table_gr");

      // Find all children belonging to this parent
      const updates = {};
      tableGR.forEach((row, idx) => {
        if (row.parent_or_child === "Child" && row.parent_index === parentIndex) {
          updates[`table_gr.${idx}.expired_date`] = expiredDate;
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
