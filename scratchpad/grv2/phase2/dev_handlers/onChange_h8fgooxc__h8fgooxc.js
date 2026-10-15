// onChange handler for manufacturing_date field
// When parent's manufacturing_date changes, auto-update all children

(async () => {
  try {
    const manufacturingDate = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    if (rowIndex === undefined || rowIndex === null) {
      return;
    }

    const eventRow = arguments[0].row;

    // A bundle's items are not rows of table_gr, so `table_gr.<rowIndex>` does not
    // address them -- it addresses some unrelated top-level line, and this handler
    // would read that line's split state and propagate onto its children. Split
    // propagation means nothing inside a bundle, so bundle rows stop here.
    if (eventRow && eventRow.item_bundle_id) {
      return;
    }

    const readRow = (field) =>
      eventRow ? eventRow[field] : this.getValue(`table_gr.${rowIndex}.${field}`);

    // Check if this is a split parent row
    const isSplit = readRow("is_split");
    const parentOrChild = readRow("parent_or_child");

    // Only propagate to children if this is a split parent
    if (isSplit === "Yes" && parentOrChild === "Parent") {
      const parentIndex = readRow("parent_index");
      const tableGR = this.getValue("table_gr");

      // Find all children belonging to this parent
      const updates = {};
      tableGR.forEach((row, idx) => {
        if (row.parent_or_child === "Child" && row.parent_index === parentIndex) {
          updates[`table_gr.${idx}.manufacturing_date`] = manufacturingDate;
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
