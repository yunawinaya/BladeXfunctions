(async () => {
  try {
    // Get required values
    const organizationId = this.getValue("organization_id");
    const dialogData = this.getValue("dialog_serial_number");

    // Validate inputs
    if (!organizationId) {
      console.error("Organization ID is missing");
      return;
    }

    if (!dialogData) {
      console.error("Dialog data is missing");
      return;
    }

    const isAuto = dialogData.is_auto;
    const isSingle = dialogData.is_single;
    const newRows = dialogData.new_rows;

    // Validate newRows
    if (!newRows || newRows <= 0) {
      console.error("Invalid newRows value:", newRows);
      return;
    }

    console.log(
      `Creating ${newRows} serial number rows. Auto: ${isAuto}, Single: ${isSingle}`
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

      console.log(
        `Created ${newRows} empty rows for manual serial number entry`
      );
    }

    // Set the created serial number table
    await this.setData({
      [`dialog_serial_number.table_serial_number`]: tableSerialNumber,
      [`dialog_serial_number.serial_number_qty`]: newRows,
    });

    await this.refreshDynamicValue("dialog_serial_number.total_qty_display");

    // Disable serial quantity field if single mode
    if (isSingle === 1) {
      this.disabled(
        "dialog_serial_number.table_serial_number.serial_quantity",
        true
      );
    }

    console.log("Serial number table updated successfully:", tableSerialNumber);
  } catch (error) {
    console.error("Error in GRconfirmNewRows:", error);

    // Log additional error details
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    // Attempt to set a minimal fallback table
    try {
      const fallbackRows = this.getValue("dialog_serial_number.new_rows") || 1;
      const fallbackTable = Array(fallbackRows)
        .fill(null)
        .map(() => ({
          system_serial_number: "",
          supplier_serial_number: "",
          serial_quantity: 1,
        }));

      await this.setData({
        [`dialog_serial_number.table_serial_number`]: fallbackTable,
      });

      console.log("Set fallback serial number table");
    } catch (fallbackError) {
      console.error("Failed to set fallback table:", fallbackError);
    }
  }
})();
