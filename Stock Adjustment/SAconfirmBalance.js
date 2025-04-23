const allData = this.getValues();
const temporaryData = allData.sa_item_balance.table_item_balance;
const rowIndex = allData.sa_item_balance.row_index;
const page_status = this.getParamsVariables("page_status");
if (page_status === "View") {
  this.closeDialog("sa_item_balance");
}

let isValid = true; // Flag to track validation status

// Filter out items with quantity 0 and sum up sa_quantity values
const totalSaQuantity = temporaryData
  .filter((item) => item.sa_quantity > 0) // Skip if quantity is 0
  .reduce((sum, item) => {
    const category_type = item.category;
    const movementType = item.movement_type;
    const quantity = item.sa_quantity || 0;

    // Define quantity fields
    const unrestricted_field = item.unrestricted_qty;
    const reserved_field = item.reserved_qty;
    const quality_field = item.qualityinsp_qty;
    const blocked_field = item.blocked_qty;

    // Validate only if movementType is "Out"
    if (movementType === "Out" && quantity > 0) {
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
          this.setData({ error_message: "Invalid category type" });
          isValid = false;
          return sum; // Return current sum without adding
      }

      // Check if selected field has enough quantity
      if (selectedField < quantity) {
        this.setData({
          error_message: `Quantity in ${category_type} is not enough to Adjust`,
        });
        isValid = false;
        return sum; // Return current sum without adding
      }
    }

    // Add to sum if validation passes or if movement is "In"
    return sum + quantity;
  }, 0);

console.log("Total SA quantity:", totalSaQuantity);

// Only update data and close dialog if all validations pass
if (isValid) {
  this.setData({
    [`subform_dus1f9ob.${rowIndex}.total_quantity`]: totalSaQuantity,
  });
  this.setData({
    [`subform_dus1f9ob.${rowIndex}.balance_index`]: temporaryData,
  });
  this.setData({
    [`dialog_index.table_index`]: temporaryData,
  });
  console.log("temporaryData", temporaryData);
  // Clear the error message
  this.setData({
    error_message: "",
  });

  this.closeDialog("sa_item_balance");
}
