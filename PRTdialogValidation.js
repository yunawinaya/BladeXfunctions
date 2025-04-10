const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[2];

const balance_quantity =
  data.confirm_inventory.table_item_balance[index].balance_quantity;

const category_balance =
  data.confirm_inventory.table_item_balance[index].category_balance;

if (!window.validationState) {
  window.validationState = {};
}

if (Object.keys(window.validationState).length === 0) {
  const rowCount = data.confirm_inventory.table_item_balance.length;
  for (let i = 0; i < rowCount; i++) {
    window.validationState[i] = true;
  }
}
if (balance_quantity < value || category_balance < value) {
  window.validationState[index] = false;
  callback("Not enough quantity to be returned");
} else {
  window.validationState[index] = true;
  callback();
}
