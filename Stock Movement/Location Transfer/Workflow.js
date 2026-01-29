for (const [index, smLineItem] of allData.stock_movement.entries()) {
  smLineItem.organization_id = allData.organization_id;
  smLineItem.issuing_plant = allData.issuing_operation_faci || null;
  smLineItem.receiving_plant = allData.receiving_operation_faci || null;
  smLineItem.line_index = index + 1;

  updatedSM.push(smLineItem);
}

allData.stock_movement = updatedSM;

if (saveAs === "Draft") {
  if (
    allData.stock_movement_no_type !== -9999 &&
    (!allData.stock_movement_no ||
      allData.stock_movement_no === null ||
      allData.stock_movement_no === "")
  ) {
    allData.stock_movement_no = "draft";
  }
} else {
  if (
    allData.stock_movement_no_type !== -9999 &&
    (!allData.stock_movement_no ||
      allData.stock_movement_no === null ||
      allData.stock_movement_no === "" ||
      allData.stock_movement_status !== "In Progress")
  ) {
    allData.stock_movement_no = "issued";
  }
}

if (allData.acc_integration_type !== "No Accounting Integration") {
  allData.posted_status = "Unposted";
} else {
  allData.posted_status = "";
}

return {
  allData: allData,
  stock_movement_status: allData.stock_movement_status,
  is_production_order: allData.is_production_order,
};
