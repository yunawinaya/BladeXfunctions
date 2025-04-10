const data = this.getValues();
const temporaryData = data.confirm_inventory.table_item_balance;
const rowIndex = data.confirm_inventory.row_index;

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

// Continue with the original logic if validation passed
const textareaContent = JSON.stringify(temporaryData);

this.setData({
  [`table_prt.${rowIndex}.temp_qty_data`]: textareaContent,
});

this.setData({
  [`confirm_inventory.table_item_balance`]: [],
});

console.log("Input data:", temporaryData);
console.log("Row index:", rowIndex);

const totalCategoryQuantity = temporaryData.reduce(
  (sum, item) => sum + (item.return_quantity || 0),
  0
);
console.log("Total category quantity:", totalCategoryQuantity);

// Store the total in the form
this.setData({
  [`table_prt.${rowIndex}.return_quantity`]: totalCategoryQuantity,
});

this.closeDialog("confirm_inventory");
