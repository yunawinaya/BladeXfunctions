const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[2];
const row = data.sa_item_balance.table_item_balance[index];

const category_type = row.category;
const adjustment_type = data.adjustment_type;
const movementType = row.movement_type;

const unrestricted_field = row.unrestricted_qty;
const reserved_field = row.reserved_qty;
const quality_field = row.qualityinsp_qty;
const blocked_field = row.block_qty;

const numValue = parseFloat(value);
if (isNaN(numValue)) {
  callback("Please enter a valid number");
  return;
}

const resolveCategoryField = () => {
  switch (category_type) {
    case "Unrestricted":
      return unrestricted_field;
    case "Reserved":
      return reserved_field;
    case "Quality Inspection":
      return quality_field;
    case "Blocked":
      return blocked_field;
    default:
      return undefined;
  }
};

const checkAvailable = (requiredAbs) => {
  const selectedField = resolveCategoryField();
  if (selectedField === undefined) {
    callback("Invalid category type");
    return;
  }
  const numSelectedField = parseFloat(selectedField);
  if (isNaN(numSelectedField)) {
    callback(`Invalid quantity format for ${category_type}`);
    return;
  }
  if (numSelectedField < requiredAbs) {
    callback(`Insufficient quantity in ${category_type}`);
  } else {
    callback();
  }
};

if (adjustment_type === "Stock Count") {
  // Stock Count: negative = OUT, positive = IN
  if (numValue < 0) {
    checkAvailable(Math.abs(numValue));
  } else if (numValue > 0) {
    callback();
  } else {
    callback("Quantity cannot be zero");
  }
} else {
  if (movementType === "OUT") {
    checkAvailable(numValue);
  } else if (movementType === "IN") {
    if (numValue <= 0) {
      callback("Quantity must be greater than zero for IN movement");
      return;
    }
    callback();
  } else {
    callback("Invalid movement type. Must be 'IN' or 'OUT'");
  }
}
