(async () => {
  try {
    const value = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    const reviewStatus = this.getValue(
      `table_stock_count.${rowIndex}.review_status`
    );

    if (value === 1) {
      this.disabled(`table_stock_count.${rowIndex}.count_qty`, true);
      if (reviewStatus !== "Stock Adjust") {
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Counted",
        });
      }
    } else {
      this.disabled(`table_stock_count.${rowIndex}.count_qty`, false);
      if (reviewStatus !== "Stock Adjust") {
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Pending",
        });
      }
    }
  } catch (error) {
    console.error(error);
  }
})();
