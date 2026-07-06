(async () => {
  const data = this.getValue("split_dialog");
  const noOfSplit = data.no_of_split;
  const toReceivedQty = data.to_received_qty;
  const rowIndex = data.rowIndex;
  const uom = this.getValue(`table_gr.${rowIndex}.item_uom`);
  const isSerializedItem = this.getValue(
    `table_gr.${rowIndex}.is_serialized_item`,
  );
  const storageLocationId = this.getValue(
    `table_gr.${rowIndex}.storage_location_id`,
  );
  const locationId = this.getValue(`table_gr.${rowIndex}.location_id`);
  const isBatchItem = data.is_batch_item;
  const batchNo = this.getValue(`table_gr.${rowIndex}.item_batch_no`);
  const manufacturingDate = this.getValue(
    `table_gr.${rowIndex}.manufacturing_date`,
  );
  const expiredDate = this.getValue(`table_gr.${rowIndex}.expired_date`);

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
      item_uom: uom,
      storage_location_id: storageLocationId,
      location_id: locationId,
      line_remark_1: "",
      line_remark_2: "",
      line_remark_3: "",
      batch_no: isBatchItem === 1 ? batchNo : "",
      manufacturing_date: isBatchItem === 1 ? manufacturingDate : "",
      expired_date: isBatchItem === 1 ? expiredDate : "",
    };
    splitData.push(lineData);
  }

  await this.setData({ [`split_dialog.table_split`]: splitData });

  if (batchNo === "") {
    await this.disabled("split_dialog.table_split.batch_no", false);
  }

  // Handle serialized items
  if (isSerializedItem === 1) {
    await this.disabled("split_dialog.table_split.received_qty", true);
    await this.setData({ [`split_dialog.table_split.received_qty`]: 0 });

    const serialNumbers = this.getValue(
      `table_gr.${rowIndex}.select_serial_number`,
    );
    for (let i = 0; i < noOfSplit; i++) {
      await this.setOptionData(
        `split_dialog.table_split.${i}.select_serial_number`,
        serialNumbers,
      );
    }
  }
})();
