(async () => {
  try {
    // Input validation
    const args = arguments[0];
    if (!args) {
      console.error("No arguments provided");
      return;
    }

    const { row: lineItemData, rowIndex } = args;

    // Validate required data
    if (!lineItemData) {
      console.error("Line item data is missing");
      return;
    }

    if (rowIndex === undefined || rowIndex === null) {
      console.error("Row index is missing");
      return;
    }

    const isSerializedItem = lineItemData.is_serialized_item;

    if (!isSerializedItem) {
      this.$message.error("Non serialized item");
      return;
    }

    console.log("Processing line item data:", lineItemData);

    let serialNumberData = JSON.parse(lineItemData.serial_number_data);
    serialNumberData.total_qty_display = serialNumberData.serial_number_qty;
    serialNumberData.row_index = rowIndex;

    if (!serialNumberData) {
      throw new Error("Serial number data not found");
    }

    await this.setData({ dialog_serial_number: serialNumberData });

    this.openDialog("dialog_serial_number");
  } catch (error) {
    console.error("Unexpected error in serial number handler:", error);

    // Log stack trace for debugging
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
  }
})();
