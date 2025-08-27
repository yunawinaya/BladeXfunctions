(async () => {
  try {
    const dialogData = this.getValue("dialog_serial_number");
    const uomConversion = this.getValue(
      `table_gr.${dialogData.row_index}.uom_conversion`
    );
    const baseOrderedQty = this.getValue(
      `table_gr.${dialogData.row_index}.base_ordered_qty`
    );

    console.log("Original dialogData:", dialogData);

    // Validate dialog data
    if (!dialogData) {
      console.error("Dialog data is missing");
      this.$message.error("Dialog data is missing");
      return;
    }

    // Validate row index
    if (dialogData.row_index === undefined || dialogData.row_index === null) {
      console.error("Row index is missing");
      this.$message.error("Row index is missing");
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

    if (dialogData.table_serial_number.length === 0) {
      this.$message.error("Fill in the serial number table before confirming");
      return;
    }

    // Additional validation for manual mode
    if (dialogData.is_auto === 0) {
      // Check if all system serial numbers are filled in manual mode
      const emptySerialNumbers = dialogData.table_serial_number.filter(
        (item) =>
          !item.system_serial_number || item.system_serial_number.trim() === ""
      );

      if (emptySerialNumbers.length > 0) {
        console.error(`${emptySerialNumbers.length} serial numbers are empty`);
        this.$message.error(
          `Please fill in all system serial numbers. ${emptySerialNumbers.length} entries are empty.`
        );
        return;
      }

      // Check for duplicate serial numbers in manual mode
      const serialNumbers = dialogData.table_serial_number.map((item) =>
        item.system_serial_number.trim()
      );
      const uniqueSerialNumbers = [...new Set(serialNumbers)];

      if (serialNumbers.length !== uniqueSerialNumbers.length) {
        console.error("Duplicate serial numbers found");
        this.$message.error(
          "Duplicate serial numbers are not allowed. Please ensure all serial numbers are unique."
        );
        return;
      }

      // Check if serial numbers already exist in database
      console.log("Checking serial numbers against database...");

      // Create array of promises to check each serial number
      const databaseCheckPromises = serialNumbers.map(
        async (serialNumber, index) => {
          try {
            const { data } = await db
              .collection("serial_number")
              .where({ system_serial_number: serialNumber })
              .get();

            return {
              serialNumber,
              index,
              exists: data.length > 0,
              data: data,
            };
          } catch (error) {
            console.error(
              `Error checking serial number ${serialNumber}:`,
              error
            );
            throw new Error(
              `Database check failed for serial number: ${serialNumber}`
            );
          }
        }
      );

      // Wait for all database checks to complete
      const checkResults = await Promise.all(databaseCheckPromises);

      // Find existing serial numbers
      const existingSerialNumbers = checkResults.filter(
        (result) => result.exists
      );

      if (existingSerialNumbers.length > 0) {
        console.error("Existing serial numbers found:", existingSerialNumbers);

        const existingNumbers = existingSerialNumbers.map(
          (result) => result.serialNumber
        );

        this.$message.error(
          `The following serial numbers already exist in the database: ${existingNumbers.join(
            ", "
          )}. Please use different serial numbers.`
        );
        return;
      }

      console.log("All serial numbers are unique in database");
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
      total_quantity: dialogData.total_quantity,
      total_quantity_uom: dialogData.total_quantity_uom,
      total_quantity_uom_id: dialogData.total_quantity_uom_id,
      total_qty_display: dialogData.total_qty_display,

      // Serial Number Configuration
      is_auto: dialogData.is_auto,
      is_single: dialogData.is_single,
      new_rows: dialogData.new_rows,

      // Serial Number Table (clean version)
      table_serial_number:
        dialogData.table_serial_number?.map((item) => ({
          system_serial_number: item.system_serial_number,
          supplier_serial_number: item.supplier_serial_number,
          serial_quantity: item.serial_quantity,
          fm_key: item.fm_key,
        })) || [],
    };

    // Save mapped data to the main table
    await this.setData({
      [`table_gr.${dialogData.row_index}.serial_number_data`]:
        JSON.stringify(mappedData),
    });

    let receivedQty = dialogData.new_rows;
    if (uomConversion > 0) {
      receivedQty = dialogData.new_rows / uomConversion;
    }

    const toReceivedQty = parseFloat(
      (baseOrderedQty - dialogData.new_rows).toFixed(3)
    );

    console.log("toReceivedQty", toReceivedQty);

    await this.setData({
      [`table_gr.${dialogData.row_index}.base_received_qty`]:
        dialogData.new_rows,
      [`table_gr.${dialogData.row_index}.received_qty`]: receivedQty,
      [`table_gr.${dialogData.row_index}.to_received_qty`]: toReceivedQty,
    });

    if (dialogData.new_rows > 0) {
      this.setData({
        [`table_gr.${dialogData.row_index}.is_serial_allocated`]: 1,
      });
    }

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
