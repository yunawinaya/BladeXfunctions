(async () => {
  const currentPOArray = this.getValue(`dialog_select_item.item_array`);
  const selectedPO = arguments[0].$eventArgs[0];
  const referenceType = this.getValue(`dialog_select_item.reference_type`);

  const index = currentPOArray.findIndex(
    (item) => item.purchase_order_id === selectedPO.id
  );
  if (index !== -1) {
    currentPOArray.splice(index, 1);
  } else {
    currentPOArray.push({
      purchase_order_id: selectedPO.id,
      table_po: selectedPO.table_po,
      supplier_id: selectedPO.po_supplier_id.id,
      purchase_order_number: selectedPO.purchase_order_no,
      currency: selectedPO.po_currency,
    });
  }

  console.log("currentPOArray", currentPOArray);

  const updatedPONumber = currentPOArray.map(
    (item) => item.purchase_order_number
  );

  console.log("updatedPONumber", updatedPONumber.join(", "));

  this.setData({
    ...(!referenceType || referenceType === ""
      ? { [`dialog_select_item.reference_type`]: "Document" }
      : {}),
    [`dialog_select_item.po_number_array`]: updatedPONumber.join(`\n`),
    [`dialog_select_item.item_array`]: currentPOArray,
  });
})();
