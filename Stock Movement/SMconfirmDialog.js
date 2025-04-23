const allData = this.getValues();
const temporaryData = allData.sm_item_balance.table_item_balance;
const rowIndex = allData.sm_item_balance.row_index;

let isValid = true; // Flag to track validation status

// Filter out items with quantity 0 and sum up sm_quantity values with validation
const totalSmQuantity = temporaryData
  .filter((item) => (item.sm_quantity || 0) > 0) // Skip if quantity is 0 or falsy
  .reduce((sum, item) => {
    const category_type = item.category ?? item.category_from;
    const quantity = item.sm_quantity || 0;

    // Define quantity fields
    const unrestricted_field = item.unrestricted_qty;
    const reserved_field = item.reserved_qty;
    const quality_field = item.qualityinsp_qty;
    const blocked_field = item.block_qty;
    const intransit_field = item.intransit_qty;

    // Validate only if movementType is "Out"
    if (quantity > 0) {
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
        case "In Transit":
          selectedField = intransit_field;
          break;
        default:
          this.setData({ error_message: "Invalid category type" });
          isValid = false;
          return sum; // Return current sum without adding
      }

      // Check if selected field has enough quantity
      if (selectedField < quantity) {
        this.setData({
          error_message: `Quantity in ${category_type} is not enough.`,
        });
        isValid = false;
        return sum; // Return current sum without adding
      }
    }

    // Add to sum if validation passes or if movement is "In"
    return sum + quantity;
  }, 0);

console.log("Total SM quantity:", totalSmQuantity);

// Only update data and close dialog if all validations pass
if (isValid) {
  // Update total quantity
  this.setData({
    [`stock_movement.${rowIndex}.total_quantity`]: totalSmQuantity,
  });

  // Update balance index
  const currentBalanceIndex = this.getValues().balance_index || [];
  const rowsToUpdate = temporaryData.filter(
    (item) => (item.sm_quantity || 0) > 0
  );

  let updatedBalanceIndex = [...currentBalanceIndex];

  rowsToUpdate.forEach((newRow) => {
    const existingIndex = updatedBalanceIndex.findIndex(
      (item) => item.balance_id === newRow.balance_id
    );
    console.log("existingIndex", existingIndex);
    if (existingIndex !== -1) {
      updatedBalanceIndex[existingIndex] = { ...newRow };
    } else {
      updatedBalanceIndex.push({ ...newRow });
    }
  });

  console.log("updatedBalanceIndex", updatedBalanceIndex);

  const textareaContent = JSON.stringify(temporaryData);

  this.setData({
    [`stock_movement.${rowIndex}.temp_qty_data`]: textareaContent,
  });

  this.setData({
    balance_index: updatedBalanceIndex,
  });

  // Clear the error message
  this.setData({
    error_message: "",
  });

  this.closeDialog("sm_item_balance");
}
