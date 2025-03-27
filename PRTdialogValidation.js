const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[2];

const balance_quantity =
  data.confirm_inventory.table_item_balance[index].balance_quantity;

const category_balance =
  data.confirm_inventory.table_item_balance[index].category_balance;

// Create or use a global validation state
if (!window.validationState) {
  window.validationState = {};
}

if (balance_quantity < value || category_balance < value) {
  // Set validation error for this specific row
  window.validationState[index] = false;
  callback("Not enough quantity to be returned");
} else {
  // Clear validation error
  window.validationState[index] = true;
  callback();
}
