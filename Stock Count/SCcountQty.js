(async () => {
  try {
    const value = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    const systemQty = this.getValue(`table_stock_count.${rowIndex}.system_qty`);

    const varianceQty = systemQty - value;

    const variancePercentage =
      ((varianceQty / systemQty) * 100).toFixed(2) + "%";

    await this.setData({
      [`table_stock_count.${rowIndex}.variance_qty`]: varianceQty,
      [`table_stock_count.${rowIndex}.variance_percentage`]: variancePercentage,
    });
  } catch (error) {
    console.error(error);
  }
})();
