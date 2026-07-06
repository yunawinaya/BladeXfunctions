setTimeout(async () => {
  const data = this.getValue("split_dialog");
  const noOfSplit = data.no_of_split - 1;
  const toReceivedQty = data.to_received_qty;
  const rowIndex = data.rowIndex;
  const uom = this.getValue(`table_gr.${rowIndex}.item_uom`);
  const isSerializedItem = this.getValue(
    `table_gr.${rowIndex}.is_serialized_item`,
  );

  const splitData = data.table_split;
  const qtyByRow = parseFloat((toReceivedQty / noOfSplit).toFixed(3));

  // Imported rows carry their own per-row quantities (and UOM conversions), so
  // don't redistribute them evenly on delete — only renumber. Manual splits are
  // still redistributed evenly. Import is detectable by a populated import_data.
  const imp = data.import_data;
  const isImported =
    imp &&
    (typeof imp === "object"
      ? Object.keys(imp).length > 0
      : String(imp).trim() !== "");

  // Recalculate/redistribute quantities (skipped for imported rows)
  for (const [index, split] of splitData.entries()) {
    if (!isImported) {
      split.received_qty = qtyByRow;
    }
    split.item_uom = uom;
    split.sub_seq = index + 1;
  }

  await this.setData({ [`split_dialog.no_of_split`]: noOfSplit });
  await this.setData({ [`split_dialog.table_split`]: splitData });
  await this.disabled("split_dialog.is_parent_split", false);

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
}, 100);
