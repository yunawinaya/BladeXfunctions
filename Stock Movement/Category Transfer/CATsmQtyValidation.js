const data = this.getValues();
const stockMovement = data.stock_movement;
const rowIndex = data.sm_item_balance.row_index;
const fieldParts = rule.field.split(".");
const index = fieldParts[2];
const row = data.sm_item_balance.table_item_balance[index];
const materialId = row.material_id;
const balanceId = row.balance_id;
const locationId = row.location_id;

// CAT validates against the source bucket (category_from). Each row carries
// both category_from and category_to; only the source bucket needs the
// over-allocation check.
const category_from = row.category_from;

let selectedField;
switch (category_from) {
  case "Unrestricted":
    selectedField = row.unrestricted_qty;
    break;
  case "Reserved":
    selectedField = row.reserved_qty;
    break;
  case "Quality Inspection":
    selectedField = row.qualityinsp_qty;
    break;
  case "Blocked":
    selectedField = row.block_qty;
    break;
  case "In Transit":
    selectedField = row.intransit_qty;
    break;
  default:
    callback("Invalid source category");
    return;
}

// Sum already-confirmed allocations from OTHER stock_movement lines hitting the
// same balance/location/source-category, so cross-line over-allocation is caught.
let confirmedQuantity = 0;

for (let i = 0; i < stockMovement.length; i++) {
  if (i === rowIndex) continue;
  const item = stockMovement[i];
  if (
    item.item_selection !== materialId ||
    !item.total_quantity ||
    !item.temp_qty_data
  )
    continue;

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
      tempItem.category_from === category_from &&
      tempItem.sm_quantity > 0
    ) {
      confirmedQuantity += tempItem.sm_quantity;
    }
  }
}

if (selectedField < value + confirmedQuantity) {
  callback(`Quantity in ${category_from} is not enough.`);
} else {
  callback();
}
