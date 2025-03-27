const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[2];

const unrestricted_field =
  data.gd_item_balance.table_item_balance[index].unrestricted_qty;

// Create or use a global validation state
if (!window.validationState) {
  window.validationState = {};
}

if (unrestricted_field < value) {
  // Set validation error for this specific row
  window.validationState[index] = false;
  callback("Quantity is not enough to deliver");
} else {
  // Clear validation error
  window.validationState[index] = true;
  callback();
}
