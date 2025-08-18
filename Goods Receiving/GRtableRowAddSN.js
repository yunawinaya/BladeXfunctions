(async () => {
  try {
    const dialogData = this.getValue("dialog_serial_number");
    const tableSerialNumber = this.getValue(
      "dialog_serial_number.table_serial_number"
    );

    if (!tableSerialNumber || !Array.isArray(tableSerialNumber)) {
      console.error("Table serial number data is missing or invalid");
      return;
    }

    if (!dialogData) {
      console.error("Dialog data is missing");
      return;
    }

    const tableRows = tableSerialNumber.length;
    const totalQuantity = dialogData.total_quantity;
    const isAuto = dialogData.is_auto;
    const isSingle = dialogData.is_single;

    console.log("Table rows changed to:", tableRows);
    console.log("Configuration - Auto:", isAuto, "Single:", isSingle);

    // Validate that rows don't exceed total quantity
    if (tableRows > totalQuantity) {
      console.error(
        `Table rows (${tableRows}) cannot exceed total quantity (${totalQuantity})`
      );
      this.$message.error(
        `Number of serial numbers (${tableRows}) cannot exceed total quantity (${totalQuantity}). Please adjust the quantity.`
      );

      // Revert to previous valid state by removing excess rows
      const validTableData = tableSerialNumber.slice(0, totalQuantity);
      await this.setData({
        "dialog_serial_number.table_serial_number": validTableData,
        "dialog_serial_number.serial_number_qty": validTableData.length,
        "dialog_serial_number.new_rows": validTableData.length,
      });
      return;
    }

    // Process each row to ensure it follows the configuration
    const processedTableData = tableSerialNumber.map((row, index) => {
      let processedRow = { ...row };

      // If this is a new row (empty or missing required fields), apply configuration
      const isNewRow =
        !row.system_serial_number ||
        (isAuto === 1 && row.system_serial_number === "") ||
        (isAuto === 0 &&
          row.system_serial_number === "Auto generated serial number");

      if (isNewRow) {
        if (isAuto === 1) {
          // Auto mode - set placeholder text
          processedRow.system_serial_number = "Auto generated serial number";
        } else {
          // Manual mode - set empty for user input
          processedRow.system_serial_number = "";
        }

        // Ensure other fields have default values
        if (!processedRow.supplier_serial_number) {
          processedRow.supplier_serial_number = "";
        }
        if (!processedRow.serial_quantity) {
          processedRow.serial_quantity = 1;
        }

        console.log(
          `Row ${index} configured for ${isAuto === 1 ? "auto" : "manual"} mode`
        );
      }

      return processedRow;
    });

    // Update the data
    await this.setData({
      "dialog_serial_number.table_serial_number": processedTableData,
      "dialog_serial_number.serial_number_qty": tableRows,
      "dialog_serial_number.new_rows": tableRows,
    });

    // Apply field restrictions based on configuration
    if (isAuto === 1) {
      // Disable system serial number field in auto mode
      await this.disabled(
        "dialog_serial_number.table_serial_number.system_serial_number",
        true
      );
    } else {
      // Enable system serial number field in manual mode
      await this.disabled(
        "dialog_serial_number.table_serial_number.system_serial_number",
        false
      );
    }

    // Disable serial quantity field if single mode
    if (isSingle === 1) {
      await this.disabled(
        "dialog_serial_number.table_serial_number.serial_quantity",
        true
      );
    } else {
      await this.disabled(
        "dialog_serial_number.table_serial_number.serial_quantity",
        false
      );
    }

    // Refresh dynamic display values
    await this.refreshDynamicValue("dialog_serial_number.total_qty_display");

    console.log("Table row change processed successfully:", processedTableData);
  } catch (error) {
    console.error("Error in table row change handler:", error);

    // Log additional error details
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    this.$message.error(
      "An error occurred while processing table changes. Please try again."
    );
  }
})();
