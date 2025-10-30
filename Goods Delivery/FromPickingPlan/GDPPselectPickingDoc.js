(async () => {
  const currentPPArray = this.getValue(`dialog_select_picking.item_array`);
  const selectedPP = arguments[0].$eventArgs[0];
  const referenceType = this.getValue(`dialog_select_picking.reference_type`);

  console.log("selectedPP", selectedPP);
  const index = currentPPArray.findIndex(
    (item) => item.picking_plan_id === selectedPP.id
  );
  if (index !== -1) {
    currentPPArray.splice(index, 1);
  } else {
    currentPPArray.push({
      picking_plan_id: selectedPP.id,
      table_to: selectedPP.table_to,
      customer_id: selectedPP.customer_name.map((customer) => customer.id),
      to_no: selectedPP.to_no,
      so_no: selectedPP.so_no,
      so_currency: selectedPP.so_id
        .map((so) => so.so_currency)
        .filter((currency) => currency !== null),
      delivery_status: selectedPP.delivery_status,
    });
  }

  console.log("currentPPArray", currentPPArray);

  const updatedPPNumber = currentPPArray.map((item) => item.to_no);

  console.log("updatedPPNumber", updatedPPNumber.join(", "));

  this.setData({
    ...(!referenceType || referenceType === ""
      ? { [`dialog_select_picking.reference_type`]: "Document" }
      : {}),
    [`dialog_select_picking.to_number_array`]: updatedPPNumber.join(`\n`),
    [`dialog_select_picking.item_array`]: currentPPArray,
  });

  console.log(
    "existing GD",
    this.getValue(`dialog_select_picking.gd_line_data`)
  );
})();
