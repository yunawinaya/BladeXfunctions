(async () => {
  try {
    const data = this.getValues();
    const splitDialog = data.split_dialog;
    const tableSplit = splitDialog.table_split || [];
    const serialNumberDataRaw = splitDialog.serial_number_data || "";
    console.log("serialNumberDataRaw", serialNumberDataRaw);
    let serialNumberData = [];
    if (!Array.isArray(serialNumberDataRaw)) {
      serialNumberData = serialNumberDataRaw.split(",");
    } else {
      serialNumberData = serialNumberDataRaw;
    }

    let selectedSerialNumber = [];
    for (const split of tableSplit) {
      const serialNumbers = split.select_serial_number;
      if (serialNumbers && serialNumbers?.length > 0) {
        console.log("serialNumbers", serialNumbers);
        selectedSerialNumber.push(...serialNumbers);
      }
    }

    console.log("selectedSerialNumber", selectedSerialNumber);

    const availableSerialNumber = serialNumberData.filter(
      (serial) => !selectedSerialNumber.includes(serial)
    );
    console.log("availableSerialNumber", availableSerialNumber);

    for (const [index] of tableSplit.entries()) {
      await this.setOptionData(
        `split_dialog.table_split.${index}.select_serial_number`,
        availableSerialNumber
      );
    }

    const serialNumberValues = arguments[0]?.value;
    const rowIndex = arguments[0]?.rowIndex;
    if (serialNumberValues && serialNumberValues?.length > 0) {
      await this.setData({
        [`split_dialog.table_split.${rowIndex}.store_in_qty`]:
          serialNumberValues.length,
      });
    } else {
      await this.setData({
        [`split_dialog.table_split.${rowIndex}.store_in_qty`]: 0,
      });
    }
  } catch (error) {
    console.error("Error in PutawayOnChangeSN:", error);
    this.$message.error("Error updating serial numbers: " + error.message);
  }
})();
