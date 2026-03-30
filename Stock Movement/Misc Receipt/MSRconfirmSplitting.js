(async () => {
  const data = this.getValue("split_dialog");
  const noOfSplit = data.no_of_split;
  const toReceivedQty = data.to_received_qty;
  const rowIndex = data.rowIndex;
  const uom = this.getValue(
    `stock_movement.${rowIndex}.received_quantity_uom`,
  );
  const isSerializedItem = this.getValue(
    `stock_movement.${rowIndex}.is_serialized_item`,
  );

  // Validation for serialized items
  if (isSerializedItem === 1 && noOfSplit > toReceivedQty) {
    this.$message.error(
      "Number of split cannot be greater than quantity to receive for serialized item",
    );
    return;
  }

  const splitData = [];
  const qtyByRow = parseFloat((toReceivedQty / noOfSplit).toFixed(3));

  for (let i = 0; i < noOfSplit; i++) {
    const lineData = {
      sub_seq: i + 1,
      received_qty: qtyByRow,
      received_quantity_uom: uom,
      storage_location_id: "",
      location_id: "",
      line_remark_1: "",
      line_remark_2: "",
      line_remark_3: "",
    };
    splitData.push(lineData);
  }

  await this.setData({ [`split_dialog.table_split`]: splitData });

  // Handle serialized items
  if (isSerializedItem === 1) {
    await this.disabled("split_dialog.table_split.received_qty", true);
    await this.setData({ [`split_dialog.table_split.received_qty`]: 0 });

    const serialNumbers = this.getValue(
      `stock_movement.${rowIndex}.select_serial_number`,
    );
    for (let i = 0; i < noOfSplit; i++) {
      await this.setOptionData(
        `split_dialog.table_split.${i}.select_serial_number`,
        serialNumbers,
      );
    }
  }
})();
