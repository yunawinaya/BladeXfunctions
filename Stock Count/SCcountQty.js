(async () => {
  try {
    const countQty = arguments[0].value || 0;
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

    await this.setData({
      [`table_stock_count.${rowIndex}.variance_qty`]: varianceQty,
      [`table_stock_count.${rowIndex}.variance_percentage`]: variancePercentage,
    });
  } catch (error) {
    console.error(error);
  }
})();
