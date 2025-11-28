(async () => {
  try {
    const value = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    if (value > 0) {
      await this.setData({
        [`table_hu.${rowIndex}.status`]: "Packed",
      });
    } else {
      await this.setData({
        [`table_hu.${rowIndex}.status`]: "Unpacked",
      });
    }
  } catch (error) {
    this.$message.error("Error in PackingOnChangeHUqty: " + error.message);
    console.error("Error in PackingOnChangeHUqty:", error);
  }
})();
