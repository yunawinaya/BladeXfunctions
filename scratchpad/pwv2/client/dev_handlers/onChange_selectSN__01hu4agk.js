(async () => {
  try {
    const selectedSN = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    console.log("Selected SN", selectedSN);
    if (selectedSN.length > 0) {
      console.log("Selected SN length", selectedSN.length);
      await this.setData({
        [`table_putaway_item.${rowIndex}.putaway_qty`]: selectedSN.length,
      });
    } else {
      await this.setData({
        [`table_putaway_item.${rowIndex}.putaway_qty`]: 0,
      });
    }
  } catch (error) {
    console.error("Unexpected error in selected SN handler:", error);
  }
})();
