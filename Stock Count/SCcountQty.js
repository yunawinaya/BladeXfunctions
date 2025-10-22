(async () => {
  try {
    const countQty = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    const systemQty =
      this.getValue(`table_stock_count.${rowIndex}.system_qty`) || 0;

    const varianceQty = Math.abs(systemQty - countQty);

    let variancePercentage;
    if (systemQty === 0) {
      variancePercentage = countQty > 0 ? "100.00%" : "0.00%";
    } else {
      variancePercentage = ((countQty / systemQty) * 100).toFixed(2) + "%";
    }

    // Auto-lock: if count_qty is not empty/null, set is_counted = 1 (locked)
    // Otherwise, set is_counted = 0 (unlocked)
    const isCounted =
      countQty !== null && countQty !== undefined && countQty !== "" ? 1 : 0;

    // Get current statuses to determine line_status
    const reviewStatus = this.getValue(
      `table_stock_count.${rowIndex}.review_status`
    );
    const lineStatus = this.getValue(
      `table_stock_count.${rowIndex}.line_status`
    );

    // Determine new line_status based on is_counted value
    let newLineStatus = lineStatus;
    if (isCounted === 1) {
      // Locked (counted)
      if (reviewStatus !== "Stock Adjust" && lineStatus !== "Recount") {
        newLineStatus = "Counted";
      } else if (lineStatus === "Recount") {
        newLineStatus = "Recounted";
      }
    } else {
      // Unlocked (not counted)
      if (
        reviewStatus !== "Stock Adjust" &&
        lineStatus !== "Recount" &&
        lineStatus !== "Recounted"
      ) {
        newLineStatus = "Pending";
      } else if (lineStatus === "Recounted") {
        newLineStatus = "Recount";
      }
    }

    await this.setData({
      [`table_stock_count.${rowIndex}.variance_qty`]: varianceQty,
      [`table_stock_count.${rowIndex}.variance_percentage`]: variancePercentage,
      [`table_stock_count.${rowIndex}.is_counted`]: isCounted,
      [`table_stock_count.${rowIndex}.adjusted_qty`]: countQty,
      [`table_stock_count.${rowIndex}.line_status`]: newLineStatus,
    });
  } catch (error) {
    console.error(error);
  }
})();
