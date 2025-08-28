(async () => {
  try {
    const dialogData = this.getValue("dialog_serial_number");

    console.log("Original dialogData:", dialogData);

    // Validate dialog data
    if (!dialogData) {
      console.error("Dialog data is missing");
      this.$message.error("Dialog data is missing");
      return;
    }

    // Validate serial number table
    if (
      !dialogData.table_serial_number ||
      !Array.isArray(dialogData.table_serial_number)
    ) {
      console.error("Serial number table is missing or invalid");
      this.$message.error("Serial number table is missing or invalid");
      return;
    }

    // Map to extract only useful data
    const mappedData = {
      // Item Information
      row_index: dialogData.row_index,
      item_id: dialogData.item_id,
      item_code: dialogData.item_code,
      item_name: dialogData.item_name,
      item_image_url: dialogData.item_image_url || "",

      // Quantity Information
      serial_number_qty: dialogData.serial_number_qty,
      total_quantity_uom: dialogData.total_quantity_uom,
      total_quantity_uom_id: dialogData.total_quantity_uom_id,
      total_qty_display: dialogData.total_qty_display,

      // Serial Number Configuration
      is_auto: dialogData.is_auto,
      is_single: dialogData.is_single,

      // Serial Number Table (clean version)
      table_serial_number:
        dialogData.table_serial_number?.map((item) => ({
          system_serial_number: item.system_serial_number,
          supplier_serial_number: item.supplier_serial_number,
          passed: item.passed,
          fm_key: item.fm_key,
        })) || [],
    };

    // Save mapped data to the main table
    await this.setData({
      [`table_insp_mat.${dialogData.row_index}.serial_number_data`]:
        JSON.stringify(mappedData),
    });

    const PassedCount = mappedData.table_serial_number.filter(
      (sn) => sn.passed === 1
    ).length;

    const FailedCount = mappedData.table_serial_number.filter(
      (sn) => sn.passed === 0
    ).length;

    await this.setData({
      [`table_insp_mat.${dialogData.row_index}.passed_qty`]: PassedCount,
      [`table_insp_mat.${dialogData.row_index}.failed_qty`]: FailedCount,
    });

    // Close the dialog
    this.closeDialog("dialog_serial_number");

    console.log("Serial number data confirmed and saved:", mappedData);
    this.$message.success(
      `Serial number data confirmed successfully. ${dialogData.table_serial_number.length} entries saved.`
    );
  } catch (error) {
    console.error("Error in confirm serial number:", error);

    // Log additional error details
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    this.$message.error(
      "An error occurred while confirming serial numbers. Please try again."
    );
  }
})();
