// split_dialog "Confirm Add" — generates the blank split rows for the entered
// number of splits, seeded with an even share of the sent quantity.
(async () => {
  try {
    const data = this.getValue("split_dialog");
    const totalQty = parseFloat(data.to_received_qty) || 0;
    const rowIndex = data.rowIndex;

    const noOfSplit = parseInt(data.no_of_split, 10);
    if (!Number.isInteger(noOfSplit) || noOfSplit < 2) {
      this.$message.error(
        "Number of splits must be a whole number of at least 2.",
      );
      return;
    }

    const uom = this.getValue(
      `stock_movement.${rowIndex}.received_quantity_uom`,
    );
    const storageLocationId = this.getValue(
      `stock_movement.${rowIndex}.storage_location_id`,
    );
    const locationId = this.getValue(`stock_movement.${rowIndex}.location_id`);

    // The shares must sum EXACTLY to the sent quantity, so the last row takes
    // the remainder. An even toFixed(3) split does not: 10/3 seeds three rows of
    // 3.333 which totals 9.999, and the confirm handler's exact-sum check would
    // reject a dialog the user never touched.
    const evenQty = parseFloat((totalQty / noOfSplit).toFixed(3));
    const splitData = [];
    let allocated = 0;

    for (let i = 0; i < noOfSplit; i++) {
      const qty =
        i === noOfSplit - 1
          ? parseFloat((totalQty - allocated).toFixed(3))
          : evenQty;
      allocated = parseFloat((allocated + qty).toFixed(3));

      splitData.push({
        sub_seq: i + 1,
        received_qty: qty,
        item_uom: uom,
        storage_location_id: storageLocationId,
        location_id: locationId,
      });
    }

    await this.setData({ [`split_dialog.table_split`]: splitData });
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || String(error));
  }
})();
