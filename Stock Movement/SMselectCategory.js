const allData = this.getValues();
const movementType = allData.movement_type;
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

    // Filter categories based on movement type
    const allowedCategories = movementTypeCategories[movementType] || [
      "Unrestricted",
    ]; // Default to Unrestricted if movementType not found
    const filteredCategories = categoryObjectResponse.data.filter((category) =>
      allowedCategories.includes(category.inventory_category_name)
    );

    console.log("Filtered categories:", filteredCategories);

    await this.setData({
      [`sm_item_balance.table_item_balance.${rowIndex}.category`]: [],
    });

    await this.setOptions(
      [`sm_item_balance.table_item_balance.${rowIndex}.category`],
      {
        remote: false,
        remoteType: "datasource",
        datasource: { source: "static" },
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    // Set the filtered categories to the option data
    await this.setOptionData(
      [`sm_item_balance.table_item_balance.${rowIndex}.category`],
      allowedCategories
    );
  } catch (error) {
    console.error("Error fetching category:", error);
  }
};

fetchCategory();
