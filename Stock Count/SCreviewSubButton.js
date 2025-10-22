(async () => {
  try {
    const rowIndex = await this.models["selectedRowIndex"];
    const lineStatus = await this.getValue(
      `table_stock_count.${rowIndex}.line_status`
    );

    if (lineStatus === "Pending") {
      this.$message.warning("Please count the item first");
      return;
    }

    await this.setData({
      [`table_stock_count.${rowIndex}.review_status`]: "Approved",
    });

    this.triggerEvent("onChange_lineReview", { rowIndex, value: "Approved" });
  } catch (error) {
    console.error(error);
  }
})();
