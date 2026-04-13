(async () => {
  try {
    const value = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    if (value !== 1) return;

    const tableSourceHU =
      this.getValue("dialog_repack.table_source_hu") || [];

    const updates = {};
    for (let i = 0; i < tableSourceHU.length; i++) {
      if (i === rowIndex) continue;
      if (tableSourceHU[i].select_hu === 1) {
        updates[`dialog_repack.table_source_hu.${i}.select_hu`] = 0;
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.setData(updates);
    }
  } catch (error) {
    this.$message.error("Error in ROonChangeSelectSourceHU: " + error.message);
    console.error("Error in ROonChangeSelectSourceHU:", error);
  }
})();
