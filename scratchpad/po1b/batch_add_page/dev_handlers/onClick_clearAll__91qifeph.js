(async () => {
  this.setData({
    [`item_code_array`]: "",
    [`item_array`]: [],
  });
  this.getComponent("item_table").$refs.crud.clearSelection();
})();
