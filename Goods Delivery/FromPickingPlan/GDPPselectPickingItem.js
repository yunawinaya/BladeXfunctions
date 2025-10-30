(async () => {
  const currentPPArray = this.getValue(`dialog_select_picking.item_array`);
  const selectedPPItem = arguments[0].$eventArgs[0];
  const referenceType = this.getValue(`dialog_select_picking.reference_type`);

  console.log("arguments[0].$eventArgs[0]", arguments[0].$eventArgs[0]);
  const index = currentPPArray.findIndex(
    (item) => item.picking_plan_line_id === selectedPPItem.id
  );
  if (index !== -1) {
    currentPPArray.splice(index, 1);
  } else {
    currentPPArray.push({
      picking_plan_line_id: selectedPPItem.id,
      item: selectedPPItem.material_id,
      picking_plan: selectedPPItem.picking_plan_id,
      customer_id: selectedPPItem.customer_id,
      to_desc: selectedPPItem.to_material_desc,
      more_desc: selectedPPItem.more_desc,
      to_order_quantity: selectedPPItem.to_order_quantity,
      to_qty: selectedPPItem.to_qty,
      to_order_uom_id: selectedPPItem.to_order_uom_id.id,
      base_uom_id: selectedPPItem.base_uom_id,
      temp_qty_data: selectedPPItem.temp_qty_data,
      gd_temp_qty_data: selectedPPItem.gd_temp_qty_data,
      view_stock: selectedPPItem.view_stock,
      fifo_sequence: selectedPPItem.fifo_sequence,
      item_category_id: selectedPPItem.item_category_id.id,
      line_so_id: selectedPPItem.line_so_id.id,
      line_so_no: selectedPPItem.line_so_no,
      item_costing_method: selectedPPItem.item_costing_method,
      so_line_item_id: selectedPPItem.so_line_item_id.id,
      unit_price: selectedPPItem.unit_price,
      total_price: selectedPPItem.total_price,
      line_remark_1: selectedPPItem.line_remark_1,
      line_remark_2: selectedPPItem.line_remark_2,
      gd_undelivered_qty: selectedPPItem.gd_undelivered_qty,
      gd_delivered_qty: selectedPPItem.gd_delivered_qty,
      delivery_status: selectedPPItem.delivery_status,
    });
  }

  console.log("currentPPArray", currentPPArray);

  const updatedPPNumber = currentPPArray.map(
    (item) => item.picking_plan.to_no + "\t" + item.item.material_code
  );

  console.log("updatedPPNumber", updatedPPNumber.join(", "));

  this.setData({
    ...(!referenceType || referenceType === ""
      ? { [`dialog_select_picking.reference_type`]: "Item" }
      : {}),
    [`dialog_select_picking.to_number_array`]: updatedPPNumber.join(`\n`),
    [`dialog_select_picking.item_array`]: currentPPArray,
  });
})();
