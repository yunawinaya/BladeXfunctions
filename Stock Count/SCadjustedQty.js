(async () => {
  try {
    let adjustedQty = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    const systemQty =
      this.getValue(`table_stock_count.${rowIndex}.system_qty`) || 0;
    const countQty =
      this.getValue(`table_stock_count.${rowIndex}.count_qty`) || 0;

    if (
      !adjustedQty ||
      adjustedQty === null ||
      adjustedQty === undefined ||
      adjustedQty === ""
    ) {
      adjustedQty = countQty;
      await this.setData({
        [`table_stock_count.${rowIndex}.adjusted_qty`]: adjustedQty,
      });
    }

    const varianceQty = adjustedQty - systemQty;

    let variancePercentage;
    if (systemQty === 0) {
      variancePercentage = adjustedQty > 0 ? "100.00%" : "0.00%";
    } else {
      variancePercentage =
        (Math.abs(varianceQty / systemQty) * 100).toFixed(2) + "%";
    }

    await this.setData({
      [`table_stock_count.${rowIndex}.variance_qty`]: varianceQty,
      [`table_stock_count.${rowIndex}.variance_percentage`]: variancePercentage,
    });
  } catch (error) {
    console.error(error);
  }
})();
