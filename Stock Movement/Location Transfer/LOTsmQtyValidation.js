const data = this.getValues();
const stockMovement = data.stock_movement;
const rowIndex = data.sm_item_balance.row_index;
const fieldParts = rule.field.split(".");
const index = fieldParts[2];
const row = data.sm_item_balance.table_item_balance[index];
const materialId = row.material_id;
const balanceId = row.balance_id;
const locationId = row.location_id;
const category = row.category;

const category_type = row.category ?? row.category_from;

const unrestricted_field = row.unrestricted_qty;
const reserved_field = row.reserved_qty;
const quality_field = row.qualityinsp_qty;
const blocked_field = row.block_qty;

let selectedField;

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

// Sum already-confirmed allocations from OTHER stock_movement lines hitting the
// same balance/location/category, so cross-line over-allocation is caught.
let confirmedQuantity = 0;

for (let i = 0; i < stockMovement.length; i++) {
  if (i === rowIndex) continue;
  const item = stockMovement[i];
  if (
    item.item_selection !== materialId ||
    !item.total_quantity ||
    !item.temp_qty_data
  ) continue;

  let tempDataParsed;
  try {
    tempDataParsed = JSON.parse(item.temp_qty_data);
  } catch (e) {
    continue;
  }
  if (!Array.isArray(tempDataParsed)) continue;

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

if (selectedField < value + confirmedQuantity) {
  callback(`Quantity in ${category_type} is not enough.`);
} else {
  callback();
}
