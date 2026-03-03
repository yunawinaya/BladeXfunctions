(async () => {
  const currentPickingArray = this.getValue(`dialog_select_picking.item_array`);
  const selectedPicking = arguments[0].$eventArgs[0];
  const referenceType = this.getValue(`dialog_select_picking.reference_type`);

  console.log("selectedPicking", selectedPicking);
  const index = currentPickingArray.findIndex(
    (item) => item.to_id === selectedPicking.id,
  );
  if (index !== -1) {
    currentPickingArray.splice(index, 1);
  } else {
    currentPickingArray.push({
      to_id: selectedPicking.id,
      to_no: selectedPicking.to_id,
      customer_id: selectedPicking.customer_id.map((customer) => customer.id),
      so_no: selectedPicking.so_no,
      pp_id: selectedPicking.to_no,
      picking_record_data: selectedPicking.table_picking_records,
      delivery_status: selectedPicking.delivery_status,
    });
  }

  console.log("currentPickingArray", currentPickingArray);

  const updatedPickingNumber = currentPickingArray.map((item) => item.to_no);

  console.log("updatedPickingNumber", updatedPickingNumber.join(", "));

  this.setData({
    ...(!referenceType || referenceType === ""
      ? { [`dialog_select_picking.reference_type`]: "Document" }
      : {}),
    [`dialog_select_picking.to_number_array`]: updatedPickingNumber.join(`\n`),
    [`dialog_select_picking.item_array`]: currentPickingArray,
  });

  console.log(
    "existing GD",
    this.getValue(`dialog_select_picking.gd_line_data`),
  );
})();
