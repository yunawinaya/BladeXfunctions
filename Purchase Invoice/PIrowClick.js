(async () => {
  const currentGRArray = this.getValue(`dialog_select_item.item_array`);
  const selectedGRItem = arguments[0].$eventArgs[0];
  const referenceType = this.getValue(`dialog_select_item.reference_type`);

  console.log("arguments[0].$eventArgs[0]", arguments[0].$eventArgs[0]);

  const index = currentGRArray.findIndex(
    (item) => item.goods_receiving_line_id === selectedGRItem.id,
  );
  if (index !== -1) {
    currentGRArray.splice(index, 1);
  } else {
    currentGRArray.push({
      goods_receiving_line_id: selectedGRItem.id,
      item: selectedGRItem.item_id,
      supplier: selectedGRItem.supplier_id,
      received_qty: selectedGRItem.received_qty,
      invoiced_qty: selectedGRItem.invoiced_qty,
      po_line_item: selectedGRItem.po_line_item_id,
      line_remark_1: selectedGRItem.line_remark_1,
      line_remark_2: selectedGRItem.line_remark_2,
      goods_receiving_number: selectedGRItem.goods_receiving_id.gr_no,
      purchase_order_id: JSON.parse(selectedGRItem.goods_receiving_id.po_id),
      goods_receiving_id: selectedGRItem.goods_receiving_id.id,
      uom: selectedGRItem.item_uom.id,
      more_desc: selectedGRItem.more_desc,
      item_desc: selectedGRItem.item_desc,
      ordered_qty: selectedGRItem.ordered_qty,
      line_po_no: selectedGRItem.line_po_no,
      line_po_id: selectedGRItem.line_po_id,
      is_split: selectedGRItem.is_split,
      parent_or_child: selectedGRItem.parent_or_child,
    });
  }

  console.log("currentGRArray", currentGRArray);

  const updatedGRNumber = currentGRArray.map(
    (item) => item.goods_receiving_number + "\t" + item.item.material_code,
  );

  console.log("updatedGRNumber", updatedGRNumber.join(", "));

  this.setData({
    ...(!referenceType || referenceType === ""
      ? { [`dialog_select_item.reference_type`]: "Item - GR" }
      : {}),
    [`dialog_select_item.doc_number_array`]: updatedGRNumber.join(`\n`),
    [`dialog_select_item.item_array`]: currentGRArray,
  });
})();
