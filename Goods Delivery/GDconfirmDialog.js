const data = this.getValues();
const temporaryData = data.gd_item_balance.table_item_balance;
const rowIndex = data.gd_item_balance.row_index;

// Check if all rows have passed validation
const allValid = temporaryData.every((item, idx) => {
  const isValid =
    window.validationState && window.validationState[idx] !== false;
  console.log(`Row ${idx} validation: ${isValid}`);
  return isValid;
});

if (!allValid) {
  console.log("Validation failed, canceling confirm");
  return;
}

// Filter out items where gd_quantity is less than or equal to 0
const filteredData = temporaryData.filter((item) => item.gd_quantity > 0);
console.log("Filtered data (excluding gd_quantity <= 0):", filteredData);

// Continue with the original logic using filteredData instead of temporaryData
const textareaContent = JSON.stringify(filteredData);

this.setData({
  [`table_gd.${rowIndex}.temp_qty_data`]: textareaContent,
});

this.setData({
  [`gd_item_balance.table_item_balance`]: [],
});

console.log("Input data (filtered):", filteredData);
console.log("Row index:", rowIndex);

// Sum up all gd_quantity values from filtered data
const totalGdQuantity = filteredData.reduce(
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
