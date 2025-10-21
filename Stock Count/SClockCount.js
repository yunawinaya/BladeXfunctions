(async () => {
  try {
    const value = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    const reviewStatus = this.getValue(
      `table_stock_count.${rowIndex}.review_status`
    );
    const lineStatus = this.getValue(
      `table_stock_count.${rowIndex}.line_status`
    );

    if (value === 1) {
      this.disabled(`table_stock_count.${rowIndex}.count_qty`, true);
      if (reviewStatus !== "Stock Adjust" && lineStatus !== "Recount") {
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Counted",
        });
      } else if (lineStatus === "Recount") {
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Recounted",
        });
      }
    } else {
      this.disabled(`table_stock_count.${rowIndex}.count_qty`, false);
      if (
        reviewStatus !== "Stock Adjust" &&
        lineStatus !== "Recount" &&
        lineStatus !== "Recounted"
      ) {
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Pending",
        });
      } else if (lineStatus === "Recounted") {
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Recount",
        });
      }
    }
  } catch (error) {
    console.error(error);
  }
})();
