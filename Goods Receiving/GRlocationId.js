// onChange handler for location_id field
// When location changes and HU data exists, warn user and reset HU data

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;

    if (rowIndex === undefined || rowIndex === null) {
      return;
    }

    // Check if line has HU data - if location changed, alert and reset
    const tempHuDataStr = this.getValue(`table_gr.${rowIndex}.temp_hu_data`);

    if (tempHuDataStr && tempHuDataStr !== "[]") {
      // Alert user that HU data will be reset (no cancel option)
      await this.$alert(
        "Bin location has been changed. The selected Handling Units have been reset.",
        "Warning",
        {
          confirmButtonText: "OK",
          type: "warning",
        }
      );

      // Clear temp_hu_data and view_hu
      await this.setData({
        [`table_gr.${rowIndex}.temp_hu_data`]: "[]",
        [`table_gr.${rowIndex}.view_hu`]: "",
      });
    }
  } catch (error) {
    console.error("Error in location change handler:", error);
    this.$message.error(error.message || String(error));
  }
})();
