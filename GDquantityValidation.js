const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];

const order_quantity = data.table_gd[index].gd_order_quantity;
const delivered_quantity = data.table_gd[index].gd_delivered_qty;

// Create or use a global validation state
if (!window.validationState) {
  window.validationState = {};
}

if (delivered_quantity > order_quantity) {
  // Set validation error for this specific row
  window.validationState[index] = false;
  callback("Quantity is exceeded to deliver");
} else {
  // Clear validation error
  window.validationState[index] = true;
  callback();
}
