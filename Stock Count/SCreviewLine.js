(async () => {
  try {
    const value = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    switch (value) {
      case "Approved":
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Approved",
        });
        break;
      case "Recount":
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Recount",
        });
        break;
      case "Cancel":
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Cancel",
        });
        break;
      default:
        break;
    }
  } catch (error) {
    console.error(error);
  }
})();
