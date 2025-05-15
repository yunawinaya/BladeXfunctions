const allData = this.getValues();
const movementType = String(allData.movement_type || "");
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
  "Location Transfer": [
    "Unrestricted",
    "Quality Inspection",
    "Blocked",
    "Reserved",
  ],
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
    const categoryObjectResponse = await db
      .collection("inventory_category")
      .get();

    // Filter categories based on movement type
    const allowedCategories = movementTypeCategories[movementType] || [
      "Unrestricted",
    ];
    const filteredCategories = categoryObjectResponse.data.filter((category) =>
      allowedCategories.includes(category.inventory_category_name)
    );

    // Conditionally set fields based on movement type
    if (movementType === "Inventory Category Transfer Posting") {
      this.setOptionData(
        [
          `sm_item_balance.table_item_balance.${rowIndex}.category_from`,
          `sm_item_balance.table_item_balance.${rowIndex}.category_to`,
        ],
        filteredCategories
      );
    } else {
      this.setOptionData(
        [`sm_item_balance.table_item_balance.${rowIndex}.category`],
        filteredCategories
      );
    }
  } catch (error) {
    console.error("Error fetching category:", error);
  }
};

fetchCategory();
