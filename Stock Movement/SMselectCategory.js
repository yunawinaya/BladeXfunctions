const allData = this.getValues();
const movementTypeId = allData.movement_type;
const rowIndex = arguments[0]?.rowIndex;
const movementTypeCategories = {
  "Inter Operation Facility Transfer": [
    "Unrestricted",
    "Quality Inspection",
    "Blocked",
  ],
  "Inter Operation Facility Transfer (Receiving)": [
    "Unrestricted",
    "Quality Inspection",
    "Blocked",
  ],
  "Location Transfer": ["Unrestricted"],
  "Miscellaneous Issue": ["Unrestricted"],
  "Miscellaneous Receipt": ["Unrestricted", "Quality Inspection", "Blocked"],
  "Disposal/Scrap": ["Unrestricted", "Quality Inspection", "Blocked"],
  "Inventory Category Transfer Posting": [
    "Unrestricted",
    "Quality Inspection",
    "Blocked",
  ],
};

const fetchCategory = async () => {
  try {
    console.log("Fetching category");
    const categoryObjectResponse = await db
      .collection("inventory_category")
      .get();

    const response = await db
      .collection("stock_movement_type")
      .where({ id: movementTypeId })
      .get();
    if (!response.data[0]) {
      throw new Error("Invalid movement type ID");
    }
    const movementType = response.data[0].sm_type_name;

    // Filter categories based on movement type
    const allowedCategories = movementTypeCategories[movementType] || [
      "Unrestricted",
    ]; // Default to Unrestricted if movementType not found
    const filteredCategories = categoryObjectResponse.data.filter((category) =>
      allowedCategories.includes(category.inventory_category_name)
    );

    console.log("Filtered categories:", filteredCategories);

    // Set the filtered categories to the option data
    this.setOptionData(
      [`sm_item_balance.table_item_balance.${rowIndex}.category`],
      filteredCategories
    );
  } catch (error) {
    console.error("Error fetching category:", error);
  }
};

fetchCategory();
