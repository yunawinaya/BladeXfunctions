(async () => {
  try {
    const allData = this.getValues();
    const movementType = String(allData.movement_type || "");
    const rowIndex = arguments[0]?.rowIndex;

    console.log("Movement Type:", movementType);

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
      "Miscellaneous Receipt": [
        "Unrestricted",
        "Quality Inspection",
        "Blocked",
      ],
      "Disposal/Scrap": ["Unrestricted", "Quality Inspection", "Blocked"],
      "Inventory Category Transfer Posting": [
        "Unrestricted",
        "Quality Inspection",
        "Blocked",
      ],
    };

    // Fetch and filter categories
    const categoryObjectResponse = await db
      .collection("inventory_category")
      .get();
    const allowedCategories = movementTypeCategories[movementType] || [
      "Unrestricted",
    ];
    const filteredCategories = categoryObjectResponse.data.filter((category) =>
      allowedCategories.includes(category.inventory_category_name)
    );

    console.log("filteredCategories", filteredCategories);

    // Only proceed if we have a valid row index
    await this.setOptionData(
      [`sm_item_balance.table_item_balance.${rowIndex}.category`],
      filteredCategories
    );
  } catch (error) {
    console.error("Error in category filter function:", error);
  }
})();
