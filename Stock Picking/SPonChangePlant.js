const resetFormData = () => {
  this.setData({
    src_id: "",
    src_no: "",
    assigned_to: "",
    table_picking_items: [],
  });
};

(async () => {
  const plant = arguments[0].value;

  if (plant) {
    if (arguments[0].fieldModel) {
      this.disabled(["src_id", "table_picking_items"]);
      await resetFormData();
    }
  } else {
    await resetFormData();
    this.disabled(["src_id", "table_picking_items"]);
  }

  // resetFormData replaces the table, which brings the per-row add-child-record
  // control back.
  this.getComponent("table_picking_items")?.hideChildRecord();
})();
