// onChange handler for location_id field
// When location changes and HU data exists, warn user and reset HU data

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;

    // rowIndex is not a usable position once table_gr is a tree -- a bundle's items
    // are not rows of it. The event hands over the row itself, so address it by its
    // own key and fall back to the index only for a row the platform has not keyed.
    const eventRow = arguments[0]?.row;
    const rowPath =
      eventRow && eventRow.fm_key
        ? `table_gr.${eventRow.fm_key}`
        : `table_gr.${rowIndex}`;

    if (rowIndex === undefined || rowIndex === null) {
      return;
    }

    // Check if line has HU data - if location changed, alert and reset
    const tempHuDataStr = this.getValue(`${rowPath}.temp_hu_data`);

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
        [`${rowPath}.temp_hu_data`]: "[]",
        [`${rowPath}.view_hu`]: "",
      });
    }
  } catch (error) {
    console.error("Error in location change handler:", error);
    this.$message.error(error.message || String(error));
  }
})();
