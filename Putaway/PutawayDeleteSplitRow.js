setTimeout(async () => {
  const data = this.getValue("split_dialog");
  const noOfSplit = data.no_of_split - 1;
  const qtyToPutaway = data.qty_to_putaway;
  const rowIndex = data.rowIndex;
  const uom = this.getValue(`table_putaway_item.${rowIndex}.item_uom`);
  const isSerializedItem = this.getValue(
    `table_putaway_item.${rowIndex}.is_serialized_item`
  );

  const splitData = data.table_split;
  const qtyByRow = parseFloat((qtyToPutaway / noOfSplit).toFixed(3));

  for (const [index, split] of splitData.entries()) {
    split.store_in_qty = qtyByRow;
    split.item_uom = uom;
    split.sub_seq = index + 1;
  }

  await this.setData({ [`split_dialog.no_of_split`]: noOfSplit });
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
}, 100);
