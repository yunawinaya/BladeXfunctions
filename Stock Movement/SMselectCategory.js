(async () => {
  const allData = this.getValues();
  const movementType = allData.movement_type;
  const rowIndex = arguments[0]?.rowIndex;
  const movementTypeCategories = {
    "Inter Operation Facility Transfer": [
      {
        value: "Unrestricted",
        label: "Unrestricted",
      },
      {
        value: "Quality Inspection",
        label: "Quality Inspection",
      },
      {
        value: "Blocked",
        label: "Blocked",
      },
    ],
    "Inter Operation Facility Transfer (Receiving)": [
      {
        value: "Unrestricted",
        label: "Unrestricted",
      },
      {
        value: "Quality Inspection",
        label: "Quality Inspection",
      },
      {
        value: "Blocked",
        label: "Blocked",
      },
    ],
    "Location Transfer": [
      {
        value: "Unrestricted",
        label: "Unrestricted",
      },
    ],
    "Miscellaneous Issue": [
      {
        value: "Unrestricted",
        label: "Unrestricted",
      },
    ],
    "Miscellaneous Receipt": [
      {
        value: "Unrestricted",
        label: "Unrestricted",
      },
      {
        value: "Quality Inspection",
        label: "Quality Inspection",
      },
      {
        value: "Blocked",
        label: "Blocked",
      },
    ],
    "Disposal/Scrap": [
      {
        value: "Unrestricted",
        label: "Unrestricted",
      },
      {
        value: "Quality Inspection",
        label: "Quality Inspection",
      },
      {
        value: "Blocked",
        label: "Blocked",
      },
    ],
    "Inventory Category Transfer Posting": [
      {
        value: "Unrestricted",
        label: "Unrestricted",
      },
      {
        value: "Quality Inspection",
        label: "Quality Inspection",
      },
      {
        value: "Blocked",
        label: "Blocked",
      },
    ],
  };

  const allowedCategories = movementTypeCategories[movementType];

  await this.setOptionData(
    [`sm_item_balance.table_item_balance.${rowIndex}.category`],
    allowedCategories
  );
})();
