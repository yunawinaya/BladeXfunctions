(async () => {
  try {
    const value = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    if (value !== 1) return;

    const tableTargetHU =
      this.getValue("dialog_repack.table_target_hu") || [];

    const updates = {};
    for (let i = 0; i < tableTargetHU.length; i++) {
      if (i === rowIndex) continue;
      if (tableTargetHU[i].select_hu === 1) {
        updates[`dialog_repack.table_target_hu.${i}.select_hu`] = 0;
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.setData(updates);
    }
  } catch (error) {
    this.$message.error("Error in ROonChangeSelectTargetHU: " + error.message);
    console.error("Error in ROonChangeSelectTargetHU:", error);
  }
})();
