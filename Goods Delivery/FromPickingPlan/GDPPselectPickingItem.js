(async () => {
  const currentPickingArray = this.getValue(`dialog_select_picking.item_array`);
  const selectedPickingItem = arguments[0].$eventArgs[0];
  const referenceType = this.getValue(`dialog_select_picking.reference_type`);

  console.log("arguments[0].$eventArgs[0]", arguments[0].$eventArgs[0]);
  const index = currentPickingArray.findIndex(
    (item) => item.picking_record_id === selectedPickingItem.id,
  );
  if (index !== -1) {
    currentPickingArray.splice(index, 1);
  } else {
    currentPickingArray.push({
      picking_record_id: selectedPickingItem.id,
      picking_data: selectedPickingItem.transfer_order_id,
      item: selectedPickingItem.item_code,
      store_out_qty: selectedPickingItem.store_out_qty,
      delivered_qty: selectedPickingItem.delivered_qty,
      uom_id: selectedPickingItem.item_uom.id,
      location_id: selectedPickingItem.target_location.id,
      pp_id: selectedPickingItem.to_id.id,
      pp_line_id: selectedPickingItem.to_line_id.id,
      delivery_status: selectedPickingItem.delivery_status,
      // SO information
      so_id: selectedPickingItem.so_id.id,
      so_no: selectedPickingItem.so_no,
      so_line_id: selectedPickingItem.so_line_id.id,
      // Batch information
      batch_no: selectedPickingItem.target_batch.id,
      // Customer information (from picking/transfer_order)
      customer_id: selectedPickingItem.transfer_order_id?.customer_id,
    });
  }

  console.log("currentPickingArray", currentPickingArray);

  const updatedPickingNumber = currentPickingArray.map(
    (item) => item.picking_data.to_id + "\t" + item.item.material_code,
  );

  console.log("updatedPickingNumber", updatedPickingNumber.join(", "));

  this.setData({
    ...(!referenceType || referenceType === ""
      ? { [`dialog_select_picking.reference_type`]: "Item" }
      : {}),
    [`dialog_select_picking.to_number_array`]: updatedPickingNumber.join(`\n`),
    [`dialog_select_picking.item_array`]: currentPickingArray,
  });
})();
