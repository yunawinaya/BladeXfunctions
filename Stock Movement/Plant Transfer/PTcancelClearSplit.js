// confirm_split_dialog Cancel — the user declined to redo an existing split.
// Nothing to restore: the collapse only happens on Confirm (PTclearSplit), and
// no row fields are disabled on the way into this dialog.
(async () => {
  try {
    this.setData({ [`confirm_split_dialog.rowIndex`]: 0 });
    await this.closeDialog("confirm_split_dialog");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || String(error));
  }
})();
