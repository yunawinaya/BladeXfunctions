const allData = this.getValues();
const movementType = allData.movement_type;
const page_status = allData.page_status;

const rowIndex = arguments[0].rowIndex;

console.log("Triggered JN");
console.log("arguments[0]", arguments[0]);
console.log("page_status", page_status);

const {
  material_desc,
  based_uom,
  purchase_unit_price,
  table_uom_conversion,
  mat_purchase_tax_id,
  item_batch_management,
} = arguments[0].fieldModel.item;

console.log("page_status 2", page_status);

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

const fetchItemData = async () => {
  try {
    if (
      item_batch_management === 1 &&
      movementType === "Miscellaneous Receipt"
    ) {
      this.display("stock_movement.batch_id");
    } else {
      this.hide("stock_movement.batch_id");
    }

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

    // Set category options
    await this.setOptionData(
      [`stock_movement.${rowIndex}.category`],
      filteredCategories
    );

    await this.setData({
      [`stock_movement.${rowIndex}.stock_summary`]: "",
      [`stock_movement.${rowIndex}.received_quantity_uom`]: based_uom,
      [`stock_movement.${rowIndex}.quantity_uom`]: based_uom,
      [`stock_movement.${rowIndex}.unit_price`]: purchase_unit_price,
    });

    const altUoms = table_uom_conversion.map((data) => data.alt_uom_id);
    altUoms.push(based_uom);

    const uomOptions = [];

    const processData = async () => {
      for (let i = 0; i < altUoms.length; i++) {
        const res = await db
          .collection("unit_of_measurement")
          .where({ id: altUoms[i] })
          .get();
        uomOptions.push(res.data[0]);
      }

      console.log("UomOptions", uomOptions);
    };

    const updateUomOption = async () => {
      await processData();

      await this.setOptionData(
        [`stock_movement.${rowIndex}.received_quantity_uom`],
        uomOptions
      );
    };

    updateUomOption();
  } catch (error) {
    console.error("Error fetching item data:", error);
  }
};

if (page_status === "Add") {
  console.log("Triggering fetch Item");
  fetchItemData();
}
