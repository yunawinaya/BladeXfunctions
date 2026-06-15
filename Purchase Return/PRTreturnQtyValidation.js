const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[2];

const balance_quantity =
  data.confirm_inventory.table_item_balance[index].balance_quantity;
const category_type =
  data.confirm_inventory.table_item_balance[index].inventory_category || null;

if (!window.validationState) {
  window.validationState = {};
}

if (category_type === null) {
  window.validationState[index] = false;
  callback("Invalid category type");
}

if (Object.keys(window.validationState).length === 0) {
  const rowCount = data.confirm_inventory.table_item_balance.length;
  for (let i = 0; i < rowCount; i++) {
    window.validationState[i] = true;
  }
}
if (balance_quantity < value) {
  window.validationState[index] = false;
  callback("Not enough quantity to be returned");
} else {
  window.validationState[index] = true;
  callback();
}
