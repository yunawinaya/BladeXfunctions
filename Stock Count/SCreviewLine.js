(async () => {
  try {
    const value = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    if (value === "Stock Adjust") {
      await this.disabled(`table_stock_count.${rowIndex}.is_counted`, false);
      await this.setData({
        [`table_stock_count.${rowIndex}.is_counted`]: 0,
      });
    } else {
      await this.setData({
        [`table_stock_count.${rowIndex}.is_counted`]: 1,
      });
      await this.disabled(`table_stock_count.${rowIndex}.count_qty`, true);
      await this.disabled(`table_stock_count.${rowIndex}.is_counted`, true);
    }

    switch (value) {
      case "Approved":
        await this.setData({
          [`table_stock_count.${rowIndex}.line_status`]: "Approved",
        });
        break;
      case "Stock Adjust":
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
