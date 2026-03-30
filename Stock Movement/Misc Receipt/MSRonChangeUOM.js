(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;

    if (rowIndex === undefined || rowIndex === null) {
      return;
    }

    // Check if line has HU data - if uom changed, alert and reset
    const tempHuDataStr = this.getValue(
      `stock_movement.${rowIndex}.temp_hu_data`,
    );

    if (tempHuDataStr && tempHuDataStr !== "[]") {
      await this.$alert(
        "UOM has been changed. The selected Handling Units have been reset.",
        "Warning",
        {
          confirmButtonText: "OK",
          type: "warning",
        },
      );

      // Clear temp_hu_data and view_hu
      await this.setData({
        [`stock_movement.${rowIndex}.temp_hu_data`]: "[]",
        [`stock_movement.${rowIndex}.view_hu`]: "",
      });
    }
  } catch (error) {
    console.error("Error in UOM change handler:", error);
    this.$message.error(error.message || String(error));
  }
})();
