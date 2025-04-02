const page_status = this.getParamsVariables("page_status");
const data = this.getValues();
const temporaryData = data.gd_item_balance.table_item_balance;
const rowIndex = data.gd_item_balance.row_index;

// Check if all rows have passed validation
const allValid = temporaryData.every(
  (item, idx) => window.validationState && window.validationState[idx] !== false
);

if (!allValid) {
  console.log("Validation failed, canceling confirm");
  return;
}

// Continue with the original logic if validation passed
const textareaContent = JSON.stringify(temporaryData);

this.setData({
  [`table_gd.${rowIndex}.temp_qty_data`]: textareaContent,
});

console.log("Input data:", temporaryData);
console.log("Row index:", rowIndex);

// Sum up all gd_quantity values
const totalGdQuantity = temporaryData.reduce(
  (sum, item) => sum + (item.gd_quantity || 0),
  0
);
console.log("Total GD quantity:", totalGdQuantity);

// Get the initial delivered quantity from the table_gd
const initialDeliveredQty =
  data.table_gd[rowIndex].gd_initial_delivered_qty || 0;
console.log("Initial delivered quantity:", initialDeliveredQty);

const deliveredQty = initialDeliveredQty + totalGdQuantity;
console.log("Final delivered quantity:", deliveredQty);

// Store the total in the form
this.setData({
  [`table_gd.${rowIndex}.gd_delivered_qty`]: deliveredQty,
});
this.setData({
  [`table_gd.${rowIndex}.gd_qty`]: totalGdQuantity,
});
this.setData({
  [`table_gd.${rowIndex}.base_qty`]: totalGdQuantity,
});

// Clear the error message if any
this.setData({
  error_message: "",
});

this.closeDialog("gd_item_balance");
