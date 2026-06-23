(async () => {
  try {
    const itemData = arguments[0].fieldModel.item;
    const value = arguments[0].value;

    if (value && value !== "") {
      this.setData({ buyer_uom_id: itemData.based_uom });
    } else {
      this.setData({ buyer_uom_id: "" });
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
