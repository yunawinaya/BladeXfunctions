(async () => {
  try {
    const tableStockCount = this.getValue("table_stock_count") || [];

    if (!tableStockCount || tableStockCount.length === 0) {
      this.$message.warning("No stock count items to lock/unlock");
      return;
    }

    const hasUnlocked = tableStockCount.some(
      (item) => item.is_counted === 0 || !item.is_counted
    );

    const newIsCountedValue = hasUnlocked ? 1 : 0;

    const updatedTableStockCount = tableStockCount.map((item) => ({
      ...item,
      is_counted: newIsCountedValue,
    }));

    await this.setData({ table_stock_count: updatedTableStockCount });

    const action = newIsCountedValue === 1 ? "locked" : "unlocked";
    this.$message.success(`All count quantities have been ${action}`);
  } catch (error) {
    console.error(error);
    this.$message.error("Failed to lock/unlock count quantities");
  }
})();
