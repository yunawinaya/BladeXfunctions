(async () => {
  try {
    const tableStockCount = this.getValue("table_stock_count") || [];

    console.log("tableStockCount", tableStockCount);

    if (!tableStockCount || tableStockCount.length === 0) {
      this.$message.warning("No stock count items to approve");
      return;
    }

    // Filter out Pending and Cancel items
    const filteredTableStockCount = tableStockCount.filter(
      (item) => item.line_status !== "Pending" && item.line_status !== "Cancel"
    );

    if (filteredTableStockCount.length === 0) {
      this.$message.warning("No stock count items to approve (all items are pending or cancelled)");
      return;
    }

    // Check if all items are already approved
    const allApproved = filteredTableStockCount.every(
      (item) => item.review_status === "Approved"
    );

    // Toggle: if all approved, set to empty; if not all approved, set to "Approved"
    const newReviewStatus = allApproved ? "" : "Approved";
    const newLineStatus = allApproved ? "Counted" : "Approved";

    // Create a Set of IDs from filtered items for quick lookup
    const filteredIds = new Set(filteredTableStockCount.map((item) => item.id));

    // Update the entire table: modify filtered items, keep others unchanged
    const allTableStockCount = tableStockCount.map((item) => {
      if (filteredIds.has(item.id)) {
        // This item should be updated
        return {
          ...item,
          review_status: newReviewStatus,
          line_status: newLineStatus,
        };
      }
      // This item stays unchanged (e.g., Pending items)
      return item;
    });

    await this.setData({ table_stock_count: allTableStockCount });

    const action = allApproved ? "unapproved" : "approved";
    this.$message.success(`All items have been ${action}`);
  } catch (error) {
    console.error(error);
    this.$message.error("Failed to update approval status");
  }
})();
