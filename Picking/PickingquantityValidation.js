const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];

const pending_process_qty = parseFloat(
  data.table_picking_items[index].pending_process_qty || 0
);

if (!window.validationState) {
  window.validationState = {};
}

const parsedValue = parseFloat(value);

if (pending_process_qty < parsedValue) {
  window.validationState[index] = false;
  callback("Quantity is not enough to pick");
} else {
  // Clear validation error
  window.validationState[index] = true;
  callback();
}
