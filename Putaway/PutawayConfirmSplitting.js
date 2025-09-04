(async () => {
  const data = this.getValue("split_dialog");
  const noOfSplit = data.no_of_split;
  const qtyToPutaway = data.qty_to_putaway;
  const rowIndex = data.rowIndex;
  const uom = this.getValue(`table_putaway_item.${rowIndex}.item_uom`);
  const isSerializedItem = this.getValue(
    `table_putaway_item.${rowIndex}.is_serialized_item`
  );

  if (isSerializedItem === 1 && noOfSplit > qtyToPutaway) {
    this.$message.error(
      "Number of split cannot be greater than quantity to putaway for serialized item"
    );
    return;
  }

  const splitData = [];
  const qtyByRow = parseFloat((qtyToPutaway / noOfSplit).toFixed(3));

  for (let i = 0; i < noOfSplit; i++) {
    const lineData = {
      sub_seq: i + 1,
      store_in_qty: qtyByRow,
      item_uom: uom,
    };

    splitData.push(lineData);
  }

  await this.setData({ [`split_dialog.table_split`]: splitData });

  if (isSerializedItem === 1) {
    await this.disabled("split_dialog.table_split.store_in_qty", true);
    await this.setData({
      [`split_dialog.table_split.store_in_qty`]: 0,
    });
    const serialNumbers = this.getValue(
      `table_putaway_item.${rowIndex}.select_serial_number`
    );
    for (let i = 0; i < noOfSplit; i++) {
      await this.setOptionData(
        `split_dialog.table_split.${i}.select_serial_number`,
        serialNumbers
      );
    }
  }
})();
