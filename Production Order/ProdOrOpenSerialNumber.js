(async () => {
  try {
    const data = this.getValues();

    if (!data?.serial_number_data) {
      this.$message.error(
        "Please input Total Yield Quantity to generate serial number"
      );
      return;
    }

    let serialNumberData;
    try {
      serialNumberData = JSON.parse(data.serial_number_data);
    } catch {
      throw new Error("Invalid serial number data format");
    }

    const requiredFields = ["item_id", "total_quantity_uom_id"];
    const missingFields = requiredFields.filter(
      (field) => !serialNumberData[field]
    );
    if (missingFields.length > 0) {
      throw new Error(`Missing fields: ${missingFields.join(", ")}`);
    }

    const {
      item_id: itemId,
      total_quantity_uom_id: baseUOMId,
      is_auto: isAuto = 0,
      is_single: isSingle = 0,
    } = serialNumberData;

    const itemResponse = await db
      .collection("Item")
      .where({ id: itemId })
      .get();

    if (!itemResponse?.data || itemResponse.data.length === 0) {
      throw new Error(`Item not found: ${itemId}`);
    }

    const itemData = itemResponse.data[0];
    if (itemData.serial_number_management !== 1) {
      throw new Error(
        `Item ${
          itemData.material_name || itemId
        } does not support serial numbers`
      );
    }

    const uomResponse = await db
      .collection("unit_of_measurement")
      .where({ id: baseUOMId })
      .get();

    if (!uomResponse?.data || uomResponse.data.length === 0) {
      throw new Error(`UOM not found: ${baseUOMId}`);
    }

    const baseUOM = uomResponse.data[0].uom_name;

    const enhancedData = {
      ...serialNumberData,
      total_quantity_uom: baseUOM,
      item_image_url: itemData.item_image || null,
      item_name: itemData.material_name || "Unknown Item",
      item_code: itemData.material_code || itemId,
    };

    await this.setData({ dialog_serial_number: enhancedData });

    const systemSerialPath =
      "dialog_serial_number.table_serial_number.system_serial_number";
    const serialQtyPath =
      "dialog_serial_number.table_serial_number.serial_quantity";

    if (isSingle === 1 && isAuto === 1) {
      this.disabled(systemSerialPath, true);
      this.disabled(serialQtyPath, true);
    } else if (isSingle === 1 && isAuto === 0) {
      this.disabled(systemSerialPath, false);
      this.disabled(serialQtyPath, true);
    } else {
      this.disabled(systemSerialPath, false);
      this.disabled(serialQtyPath, false);
    }

    this.openDialog("dialog_serial_number");
  } catch (error) {
    console.error("Serial number dialog error:", error);
    const message = `Serial Number Error: ${error.message}`;

    if (this.$message) {
      this.$message.error(message);
    } else {
      alert(message);
    }
  }
})();
