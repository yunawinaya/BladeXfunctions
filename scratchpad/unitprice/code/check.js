const documentType = {{workflowparams:document_type}};
const suppCustId = {{workflowparams:supp_cust_id}};
const plantId = {{workflowparams:plant_id}};
const itemData = {{workflowparams:item_data}};
const errors = [];

// 1. Check if document type is missing
if (!documentType || documentType.trim() === "") {
  errors.push("Document type is required.");
}

// 2. Check if supplier/customer ID is missing for SO/PO
if (documentType === "SO" || documentType === "PO") {
  if (!suppCustId) {
    errors.push(
      `${documentType === "PO" ? "Supplier" : "Customer"} ID is required for document type "${documentType}".`,
    );
  }
}

// 3. Check if plant ID is missing
if (!plantId || plantId.trim() === "") {
  errors.push("Plant ID is required.");
}

// 4. Check if item data is missing or empty
if (!itemData || itemData.length === 0) {
  errors.push("Item data is required.");
} else {
  // 5. Check if any item is missing item ID
  const missingItemIds = itemData.filter(
    (item) => !item.item_id || item.item_id.trim() === "",
  );
  if (missingItemIds.length > 0) {
    errors.push(`Item ID is required.`);
  }
}

// Return error if any validation fails
if (errors.length > 0) {
  return {
    status: "Failed",
    message: "Validation Error:<br><br>" + errors.join("<br>"),
  };
}

// If all validations pass
return {
  status: "Success",
  message: "All input validation passed.",
};
