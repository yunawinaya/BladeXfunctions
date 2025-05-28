const data = this.getValues();
const stockMovement = data.stock_movement;
console.log("stockMovement", stockMovement);
const rowIndex = data.sm_item_balance.row_index;
console.log("rowIndex", rowIndex);
const fieldParts = rule.field.split(".");
const index = fieldParts[2];
const materialId = data.sm_item_balance.table_item_balance[index].material_id;
const balanceId = data.sm_item_balance.table_item_balance[index].balance_id;
const locationId = data.sm_item_balance.table_item_balance[index].location_id;
const category = data.sm_item_balance.table_item_balance[index].category;
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

let confirmedQuantity = 0;

for (const item of stockMovement) {
  if (
    item.item_selection === materialId &&
    item.total_quantity > 0 &&
    item.total_quantity !== null
  ) {
    const tempDataParsed = JSON.parse(item.temp_qty_data);
    for (const tempItem of tempDataParsed) {
      if (
        tempItem.material_id === materialId &&
        tempItem.balance_id === balanceId &&
        tempItem.location_id === locationId &&
        tempItem.category === category &&
        tempItem.sm_quantity > 0
      ) {
        confirmedQuantity += tempItem.sm_quantity;
      }
    }
  }
}

console.log("selectedField", selectedField);
console.log("confirmedQuantity", confirmedQuantity);

// Validate against the selected field
if (selectedField < value + confirmedQuantity) {
  window.validationState[index] = false;
  callback(`Quantity in ${category_type} is not enough.`); // New message overwrites old
} else {
  window.validationState[index] = true;
  callback(""); // Clear the error message on success
}
