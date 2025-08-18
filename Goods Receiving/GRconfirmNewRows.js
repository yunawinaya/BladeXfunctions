(async () => {
  try {
    // Get required values
    const organizationId = this.getValue("organization_id");
    const dialogData = this.getValue("dialog_serial_number");

    // Validate inputs
    if (!organizationId) {
      console.error("Organization ID is missing");
      this.$message.error("Organization ID is required");
      return;
    }

    if (!dialogData) {
      console.error("Dialog data is missing");
      this.$message.error("Dialog data is missing");
      return;
    }

    const isAuto = dialogData.is_auto;
    const isSingle = dialogData.is_single;
    const newRows = dialogData.new_rows;
    const totalQuantity = dialogData.total_quantity;

    // Validate newRows
    if (!newRows || newRows <= 0) {
      console.error("Invalid newRows value:", newRows);
      this.$message.error(
        "Invalid number of rows. Please enter a valid positive number."
      );
      return;
    }

    // Check if newRows exceeds totalQuantity
    if (newRows > totalQuantity) {
      console.error(
        `New rows (${newRows}) cannot exceed total quantity (${totalQuantity})`
      );
      this.$message.error(
        `Number of serial numbers (${newRows}) cannot exceed total quantity (${totalQuantity}). Please adjust the quantity.`
      );
      return;
    }

    console.log(
      `Creating ${newRows} serial number rows. Auto: ${isAuto}, Single: ${isSingle}, Total Quantity: ${totalQuantity}`
    );

    // Initialize empty array for table serial numbers
    let tableSerialNumber = [];

    // Create serial number rows based on newRows count
    if (isAuto === 1) {
      // Auto mode - set system_serial_number to placeholder text
      for (let i = 0; i < newRows; i++) {
        tableSerialNumber.push({
          system_serial_number: "Auto generated serial number",
          supplier_serial_number: "",
          serial_quantity: 1,
        });
      }

      // Disable system serial number field in auto mode
      await this.disabled(
        "dialog_serial_number.table_serial_number.system_serial_number",
        true
      );

      console.log(
        `Created ${newRows} rows with auto-generated placeholder text`
      );
    } else {
      // Manual entry mode - create empty rows for user input
      tableSerialNumber = Array(newRows)
        .fill(null)
        .map(() => ({
          system_serial_number: "",
          supplier_serial_number: "",
          serial_quantity: 1,
        }));

      // Enable system serial number field in manual mode
      await this.disabled(
        "dialog_serial_number.table_serial_number.system_serial_number",
        false
      );

      console.log(
        `Created ${newRows} empty rows for manual serial number entry`
      );
    }

    // Update data using setData for better performance
    await this.setData({
      "dialog_serial_number.table_serial_number": tableSerialNumber,
      "dialog_serial_number.serial_number_qty": newRows,
    });

    // Refresh dynamic display values
    await this.refreshDynamicValue("dialog_serial_number.total_qty_display");

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

    console.log("Serial number table updated successfully:", tableSerialNumber);
    this.$message.success(
      `Successfully created ${newRows} serial number entries`
    );
  } catch (error) {
    console.error("Error in GRconfirmNewRows:", error);

    // Log additional error details
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    this.$message.error(
      "An error occurred while creating serial numbers. Please try again."
    );

    // Attempt to set a minimal fallback table
    try {
      const fallbackRows = Math.min(
        this.getValue("dialog_serial_number.new_rows") || 1,
        this.getValue("dialog_serial_number.total_quantity") || 1
      );

      const fallbackTable = Array(fallbackRows)
        .fill(null)
        .map(() => ({
          system_serial_number: "",
          supplier_serial_number: "",
          serial_quantity: 1,
        }));

      await this.setData({
        "dialog_serial_number.table_serial_number": fallbackTable,
        "dialog_serial_number.serial_number_qty": fallbackRows,
      });

      console.log(
        "Set fallback serial number table with",
        fallbackRows,
        "rows"
      );
    } catch (fallbackError) {
      console.error("Failed to set fallback table:", fallbackError);
    }
  }
})();
