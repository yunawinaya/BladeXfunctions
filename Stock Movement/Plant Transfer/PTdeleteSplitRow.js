// split_dialog table_split row removed. The platform removes the row first, so
// read back on a timeout, then renumber and redistribute the sent quantity over
// the rows that remain.
setTimeout(async () => {
  try {
    const data = this.getValue("split_dialog");
    const splitData = data.table_split || [];
    const totalQty = parseFloat(data.to_received_qty) || 0;
    const rowIndex = data.rowIndex;
    const uom = this.getValue(
      `stock_movement.${rowIndex}.received_quantity_uom`,
    );

    const noOfSplit = splitData.length;

    // Same remainder-on-last-row rule as PTconfirmSplitting: the shares must
    // still sum exactly to the sent quantity or the confirm handler rejects an
    // otherwise untouched dialog.
    const evenQty =
      noOfSplit > 0 ? parseFloat((totalQty / noOfSplit).toFixed(3)) : 0;
    let allocated = 0;

    for (const [index, split] of splitData.entries()) {
      const qty =
        index === noOfSplit - 1
          ? parseFloat((totalQty - allocated).toFixed(3))
          : evenQty;
      allocated = parseFloat((allocated + qty).toFixed(3));

      split.received_qty = qty;
      split.item_uom = uom;
      split.sub_seq = index + 1;
    }

    await this.setData({ [`split_dialog.no_of_split`]: noOfSplit });
    await this.setData({ [`split_dialog.table_split`]: splitData });

    if (noOfSplit > 0 && noOfSplit < 2) {
      this.$message.warning(
        "A split needs at least 2 rows. Add a row or cancel the split.",
      );
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || String(error));
  }
}, 100);
