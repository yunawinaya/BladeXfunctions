const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];
console.log("index", index);
console.log("fieldParts", fieldParts);

const requiredQuantity =
  data.table_mat_confirmation[index].material_required_qty;
const actualQuantity = data.table_mat_confirmation[index].material_actual_qty;
console.log("requiredQuantity", requiredQuantity);
console.log("actualQuantity", actualQuantity);

if (!window.validationState) {
  window.validationState = {};
}
if (!window.validationState.productionOrder) {
  window.validationState.productionOrder = {};
}

const numValue = parseFloat(value);
if (isNaN(numValue)) {
  callback("Please enter a valid number");
  return;
}

// Add validation for actualQuantity vs requiredQuantity
if (numValue > requiredQuantity) {
  callback(
    `Actual quantity cannot exceed required quantity (${requiredQuantity})`
  );
  this.hide([`button_complete`], true);
  return;
}

this.display([`button_complete`], true);
window.validationState.productionOrder[index] = true;
callback();
