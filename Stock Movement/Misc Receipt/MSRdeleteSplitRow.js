setTimeout(async () => {
  const data = this.getValue("split_dialog");
  const noOfSplit = data.no_of_split - 1;
  const toReceivedQty = data.to_received_qty;
  const rowIndex = data.rowIndex;
  const uom = this.getValue(
    `stock_movement.${rowIndex}.received_quantity_uom`,
  );
  const isSerializedItem = this.getValue(
    `stock_movement.${rowIndex}.is_serialized_item`,
  );

  const splitData = data.table_split;
  const qtyByRow = parseFloat((toReceivedQty / noOfSplit).toFixed(3));

  // Recalculate and redistribute quantities
  for (const [index, split] of splitData.entries()) {
    split.received_qty = qtyByRow;
    split.received_quantity_uom = uom;
    split.sub_seq = index + 1;
  }

  await this.setData({ [`split_dialog.no_of_split`]: noOfSplit });
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
}, 100);
