const movementTypeCategories = {
  "Inter Operation Facility Transfer": ["Unrestricted", "Blocked"],
  "Inter Operation Facility Transfer (Receiving)": [
    "Unrestricted",
    "Quality Inspection",
    "Blocked",
  ],
  "Location Transfer": ["Unrestricted", "Blocked"],
  "Miscellaneous Issue": ["Unrestricted"],
  "Miscellaneous Receipt": ["Unrestricted", "Blocked"],
  "Disposal/Scrap": ["Unrestricted", "Blocked"],
  "Inventory Category Transfer Posting": ["Unrestricted", "Blocked"],
};

const handleBatchManagement = (movementType, currentItemArray, smLineItem) => {
  if (movementType === "Miscellaneous Receipt") {
    this.display("stock_movement.batch_id");

    for (const [index, item] of currentItemArray.entries()) {
      const rowIndex = smLineItem.length + index;

      if (item.item_batch_management === 1) {
        switch (item.batch_number_genaration) {
          case "According To System Settings":
            this.setData({
              [`stock_movement.${rowIndex}.batch_id`]:
                "Auto-generated batch number",
            });
            this.disabled(`stock_movement.${rowIndex}.batch_id`, true);
            break;

          case "Manual Input":
            this.disabled(`stock_movement.${rowIndex}.batch_id`, false);
            break;
        }
      } else {
        this.setData({ [`stock_movement.${rowIndex}.batch_id`]: "-" });
        this.disabled(`stock_movement.${rowIndex}.batch_id`, true);
      }
    }
  } else {
    this.hide("stock_movement.batch_id");
  }
};

const handleBinLocation = (defaultBin, currentItemArray, smLineItem) => {
  for (const [index, item] of currentItemArray.entries()) {
    const rowIndex = smLineItem.length + index;

    if (defaultBin) {
      this.setData({
        [`stock_movement.${rowIndex}.location_id`]: defaultBin,
      });
    }

    this.disabled(`stock_movement.${rowIndex}.location_id`, false);
  }
};

const handleInvCategory = async (
  currentItemArray,
  smLineItem,
  movementType
) => {
  const categoryObjectResponse = await db
    .collection("blade_dict")
    .where({ code: "inventory_category" })
    .get();

  for (const [index, item] of currentItemArray.entries()) {
    const rowIndex = smLineItem.length + index;

    this.setData({
      [`stock_movement.${rowIndex}.category`]: "Unrestricted",
    });

    this.disabled([`stock_movement.${rowIndex}.category`], false);

    setTimeout(async () => {
      const allowedCategories = movementTypeCategories[movementType] || [
        "Unrestricted",
      ];

      const filteredCategories = categoryObjectResponse.data.filter(
        (category) => allowedCategories.includes(category.dict_key)
      );

      this.setOptionData(
        [`stock_movement.${rowIndex}.category`],
        filteredCategories
      );
    }, 50);
  }
};

const handleUOM = async (currentItemArray, smLineItem) => {
  for (const [index, item] of currentItemArray.entries()) {
    const rowIndex = smLineItem.length + index;

    const altUoms = item.table_uom_conversion.map((data) => data.alt_uom_id);
    altUoms.push(item.based_uom);

    const uomOptions = [];

    const uomPromises = altUoms.map((uomId) =>
      db.collection("unit_of_measurement").where({ id: uomId }).get()
    );
    const uomResults = await Promise.all(uomPromises);
    uomOptions.push(...uomResults.map((res) => res.data[0]));

    this.setOptionData(
      [`stock_movement.${rowIndex}.received_quantity_uom`],
      uomOptions
    );

    this.setData({
      [`stock_movement.${rowIndex}.uom_options`]: uomOptions,
    });
  }
};

const handleSerialNumberManagement = async (
  currentItemArray,
  smLineItem,
  movementType
) => {
  for (const [index, item] of currentItemArray.entries()) {
    const rowIndex = smLineItem.length + index;

    console.log("item", item);
    console.log("movementType", movementType);
    console.log(
      "item.serial_number_management === 1",
      item.serial_number_management === 1
    );
    console.log("rowIndex", rowIndex);

    if (
      movementType === "Miscellaneous Receipt" &&
      item.serial_number_management === 1
    ) {
      await this.display(`stock_movement.select_serial_number`);
      await this.disabled(
        `stock_movement.${rowIndex}.select_serial_number`,
        false
      );
    } else {
      await this.disabled(
        `stock_movement.${rowIndex}.select_serial_number`,
        true
      );
    }
  }
};

(async () => {
  const currentItemArray = this.getValue(`dialog_item_selection.item_array`);
  const smLineItem = this.getValue("stock_movement");
  const movementType = this.getValue("movement_type");
  const defaultBin = this.getValue("default_bin");
  const itemArray = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  console.log("currentItemArray", currentItemArray);

  for (const item of currentItemArray) {
    const smItem = {
      stock_summary: "",
      item_selection: item.id,
      received_quantity_uom: item.based_uom,
      item_name: item.material_name,
      item_desc: item.material_desc,
      quantity_uom: item.based_uom,
      unit_price: item.purchase_unit_price,
      item_category: item.item_category,
      is_serialized_item: item.serial_number_management,
    };

    itemArray.push(smItem);
  }

  await this.setData({
    stock_movement: [...smLineItem, ...itemArray],
    [`dialog_item_selection.item_array`]: [],
    [`dialog_item_selection.item_code_array`]: "",
    [`dialog_item_selection.item_code`]: "",
  });

  this.closeDialog("dialog_item_selection");

  await handleBatchManagement(movementType, currentItemArray, smLineItem);
  await handleBinLocation(defaultBin, currentItemArray, smLineItem);
  await handleInvCategory(currentItemArray, smLineItem, movementType);
  await handleUOM(currentItemArray, smLineItem);
  await handleSerialNumberManagement(
    currentItemArray,
    smLineItem,
    movementType
  );
})();
