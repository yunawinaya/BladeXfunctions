(async () => {
  try {
    const tableStockCount = this.getValue("table_stock_count") || [];

    if (!tableStockCount || tableStockCount.length === 0) {
      this.$message.warning("No stock count items to approve");
      return;
    }

    // Check if all items are already approved
    const allApproved = tableStockCount.every(
      (item) => item.review_status === "Approved"
    );

    // Toggle: if all approved, set to empty; if not all approved, set to "Approved"
    const newReviewStatus = allApproved ? "" : "Approved";

    const updatedTableStockCount = tableStockCount.map((item) => ({
      ...item,
      review_status: newReviewStatus,
    }));

    await this.setData({ table_stock_count: updatedTableStockCount });

    const action = allApproved ? "unapproved" : "approved";
    this.$message.success(`All items have been ${action}`);
  } catch (error) {
    console.error(error);
    this.$message.error("Failed to update approval status");
  }
})();
