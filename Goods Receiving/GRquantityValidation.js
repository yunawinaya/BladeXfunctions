const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];

const to_received_qty = parseFloat(data.table_gr[index].to_received_qty || 0);

if (!window.validationState) {
  window.validationState = {};
}

const parsedValue = parseFloat(value);

if (to_received_qty < parsedValue) {
  window.validationState[index] = false;
  callback("Quantity is not enough to receive");
} else {
  // Clear validation error
  window.validationState[index] = true;
  callback();
}
