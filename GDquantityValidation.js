const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];

const undelivered_quantity = data.table_gd[index].gd_undelivered_qty;

// Create or use a global validation state
if (!window.validationState) {
  window.validationState = {};
}

if (undelivered_quantity < value) {
  // Set validation error for this specific row
  window.validationState[index] = false;
  callback("Quantity exceeded undelivered qty");
} else {
  // Clear validation error
  window.validationState[index] = true;
  callback();
}
