(async () => {
  try {
    const data = this.getValues();
    const value = arguments[0]?.value;

    if (!value || value <= 0) {
      await this.setData({ serial_number_data: undefined });
      await this.disabled("select_serial_number", true);
      return;
    }

    const isSerializedItem = data.is_serialized_item;
    if (isSerializedItem !== 1) {
      return;
    }

    if (value > 0) {
      await this.disabled("select_serial_number", false);
    }

    const isSingle = data.is_single || 0;
    const isAuto = data.is_auto || 0;

    const generateSerialEntry = () => {
      if (isSingle === 1 && isAuto === 1) {
        return {
          system_serial_number: "Auto generated serial number",
          serial_quantity: 1,
        };
      } else if (isSingle === 1 && isAuto === 0) {
        return {
          system_serial_number: "",
          serial_quantity: 1,
        };
      } else {
        return {
          system_serial_number: "",
          serial_quantity: 0,
        };
      }
    };

    let tableSerialNumber = [];

    // Check if we have existing serial number data
    const existingData = data.serial_number_data;
    if (existingData) {
      try {
        const parsedData = JSON.parse(existingData);
        if (
          parsedData.table_serial_number &&
          Array.isArray(parsedData.table_serial_number)
        ) {
          tableSerialNumber = [...parsedData.table_serial_number];
        }
      } catch {
        tableSerialNumber = [];
      }
    }

    const currentLength = tableSerialNumber.length;

    if (value > currentLength) {
      // Add new entries
      const newEntries = Array.from({ length: value - currentLength }, () =>
        generateSerialEntry()
      );
      tableSerialNumber.push(...newEntries);
    } else if (value < currentLength) {
      // Remove entries from the end
      tableSerialNumber = tableSerialNumber.slice(0, value);
    }

    const serialNumberData = {
      item_id: data.material_id,
      item_name: data.material_name,
      serial_number_qty: value,
      total_quantity_uom_id: data.planned_qty_uom,
      total_qty_display: value,
      is_auto: isAuto,
      is_single: isSingle,
      table_serial_number: tableSerialNumber,
    };

    await this.setData({
      serial_number_data: JSON.stringify(serialNumberData),
    });
  } catch (error) {
    console.error("Yield quantity change error:", error);
    if (this.$message) {
      this.$message.error(`Yield Quantity Error: ${error.message}`);
    } else {
      alert(`Yield Quantity Error: ${error.message}`);
    }
  }
})();
