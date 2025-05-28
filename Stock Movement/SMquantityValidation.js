const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[2];
console.log("index", index);

const category_type =
  data.sm_item_balance.table_item_balance[index].category ??
  data.sm_item_balance.table_item_balance[index].category_from;
const movementType =
  data.sm_item_balance.table_item_balance[index].movement_type;

const unrestricted_field =
  data.sm_item_balance.table_item_balance[index].unrestricted_qty;
const reserved_field =
  data.sm_item_balance.table_item_balance[index].reserved_qty;
const quality_field =
  data.sm_item_balance.table_item_balance[index].qualityinsp_qty;
const blocked_field = data.sm_item_balance.table_item_balance[index].block_qty;

// Initialize global validation state if it doesn’t exist
if (!window.validationState) {
  window.validationState = {};
}

// Reset the previous error message for this index (optional, depending on callback behavior)
window.validationState[index] = undefined; // Clear previous state

let selectedField;

// Map category_type to corresponding field
switch (category_type) {
  case "Unrestricted":
    selectedField = unrestricted_field;
    break;
  case "Reserved":
    selectedField = reserved_field;
    break;
  case "Quality Inspection":
    selectedField = quality_field;
    break;
  case "Blocked":
    selectedField = blocked_field;
    break;
  default:
    callback("Invalid category type");
    return;
}

// Validate against the selected field
if (selectedField < value) {
  window.validationState[index] = false;
  callback(`Quantity in ${category_type} is not enough.`); // New message overwrites old
} else {
  window.validationState[index] = true;
  callback(""); // Clear the error message on success
}
