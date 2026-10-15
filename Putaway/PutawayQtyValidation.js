const fieldParts = rule.field.split(".");
const index = fieldParts[1];
// the validated row only (getValues() per cell was O(n²) on a 2,000-line form)
const row = this.getValue(`table_putaway_item.${index}`) || {};
const pending_process_qty = parseFloat(row.pending_process_qty || 0);

if (!window.validationState) {
  window.validationState = {};
}

const parsedValue = parseFloat(value);

if (pending_process_qty < parsedValue) {
  window.validationState[index] = false;
  callback("Quantity is not enough to putaway");
} else {
  // Clear validation error
  window.validationState[index] = true;
  callback();
}
