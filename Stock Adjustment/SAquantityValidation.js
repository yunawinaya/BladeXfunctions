const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[2];
console.log("index", index);

const category_type = data.sa_item_balance.table_item_balance[index].category;
const movementType =
  data.sa_item_balance.table_item_balance[index].movement_type;

const unrestricted_field =
  data.sa_item_balance.table_item_balance[index].unrestricted_qty;
const reserved_field =
  data.sa_item_balance.table_item_balance[index].reserved_qty;
const quality_field =
  data.sa_item_balance.table_item_balance[index].qualityinsp_qty;
const blocked_field = data.sa_item_balance.table_item_balance[index].block_qty;

if (!window.validationState) {
  window.validationState = {};
}
if (!window.validationState.stockAdjustment) {
  window.validationState.stockAdjustment = {};
}

const numValue = parseFloat(value);
if (isNaN(numValue)) {
  callback("Please enter a valid number");
  return;
}

if (movementType === "Out") {
  let selectedField;
  let fieldName;

  switch (category_type) {
    case "Unrestricted":
      selectedField = unrestricted_field;
      fieldName = "unrestricted_qty";
      break;
    case "Reserved":
      selectedField = reserved_field;
      fieldName = "reserved_qty";
      break;
    case "Quality Inspection":
      selectedField = quality_field;
      fieldName = "qualityinsp_qty";
      break;
    case "Blocked":
      selectedField = blocked_field;
      fieldName = "block_qty";
      break;
    default:
      callback("Invalid category type");
      return;
  }

  const numSelectedField = parseFloat(selectedField);
  if (isNaN(numSelectedField)) {
    callback(`Invalid quantity format for ${category_type}`);
    return;
  }

  if (numSelectedField < numValue) {
    window.validationState.stockAdjustment[index] = false;
    callback(`Insufficient quantity in ${category_type}`);
  } else {
    window.validationState.stockAdjustment[index] = true;
    callback();
  }
} else if (movementType === "In") {
  if (numValue <= 0) {
    callback("Quantity must be greater than zero for In movement");
    return;
  }
  window.validationState.stockAdjustment[index] = true;
  callback();
} else {
  callback("Invalid movement type. Must be 'In' or 'Out'");
}
