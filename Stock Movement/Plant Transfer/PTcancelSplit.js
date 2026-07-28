// split_dialog Cancel. Nothing on the table has been mutated at this point:
// a fresh split has not run yet, and a re-split has already collapsed its
// siblings back into one regular row (PTclearSplit), which stays valid.
(async () => {
  try {
    this.setData({
      [`split_dialog.item_id`]: "",
      [`split_dialog.item_name`]: "",
      [`split_dialog.to_received_qty`]: 0,
      [`split_dialog.rowIndex`]: 0,
      [`split_dialog.no_of_split`]: 0,
      [`split_dialog.table_split`]: [],
    });

    await this.closeDialog("split_dialog");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || String(error));
  }
})();
