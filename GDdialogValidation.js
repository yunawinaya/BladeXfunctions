const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[2];

const unrestricted_field =
  data.gd_item_balance.table_item_balance[index].unrestricted_qty;

if (!window.validationState) {
  window.validationState = {};
}

if (Object.keys(window.validationState).length === 0) {
  const rowCount = data.gd_item_balance.table_item_balance.length;
  for (let i = 0; i < rowCount; i++) {
    window.validationState[i] = true;
  }
}

if (unrestricted_field < value) {
  window.validationState[index] = false;
  callback("Quantity is not enough to deliver");
} else {
  window.validationState[index] = true;
  callback();
}
