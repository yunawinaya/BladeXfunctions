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

const handleBatchManagement = (movementType, itemData, rowIndex) => {
  if (movementType === "Miscellaneous Receipt") {
    this.display("stock_movement.batch_id");

    if (itemData.item_batch_management === 1) {
      switch (itemData.batch_number_genaration) {
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
  } else {
    this.hide("stock_movement.batch_id");
  }
};

const handleManufacturingAndExpiredDate = async () => {
  const tableSM = this.getValue("stock_movement");

  const hasBatch = tableSM.some((item) => item.batch_id !== "-");
  if (hasBatch) {
    await this.display([
      "stock_movement.manufacturing_date",
      "stock_movement.expired_date",
    ]);
  }

  for (const [index, item] of tableSM.entries()) {
    if (item.batch_id !== "-") {
      await this.disabled(
        [
          `stock_movement.${index}.manufacturing_date`,
          `stock_movement.${index}.expired_date`,
        ],
        false,
      );
    } else {
      await this.disabled(
        [
          `stock_movement.${index}.manufacturing_date`,
          `stock_movement.${index}.expired_date`,
        ],
        true,
      );
    }
  }
};

const handleBinLocation = (defaultBin, defaultStorageLocation, rowIndex) => {
  if (defaultBin) {
    this.setData({
      [`stock_movement.${rowIndex}.location_id`]: defaultBin,
      [`stock_movement.${rowIndex}.storage_location_id`]:
        defaultStorageLocation,
    });
  }

  this.disabled(`stock_movement.${rowIndex}.location_id`, false);
  this.disabled(`stock_movement.${rowIndex}.storage_location_id`, false);
};

const handleInvCategory = async (rowIndex, movementType) => {
  this.setData({
    [`stock_movement.${rowIndex}.category`]: "Unrestricted",
  });

  this.disabled([`stock_movement.${rowIndex}.category`], false);

  const categoryObjectResponse = await db
    .collection("blade_dict")
    .where({ code: "inventory_category" })
    .get();

  setTimeout(async () => {
    const allowedCategories = movementTypeCategories[movementType] || [
      "Unrestricted",
    ];

    const filteredCategories = categoryObjectResponse.data.filter((category) =>
      allowedCategories.includes(category.dict_key),
    );

    this.setOptionData(
      [`stock_movement.${rowIndex}.category`],
      filteredCategories,
    );
  }, 50);
};

const handleUOM = async (itemData, rowIndex) => {
  const altUoms = itemData.table_uom_conversion.map((data) => data.alt_uom_id);

  const uomOptions = [];

  const uomPromises = altUoms.map((uomId) =>
    db.collection("unit_of_measurement").where({ id: uomId }).get(),
  );
  const uomResults = await Promise.all(uomPromises);
  uomOptions.push(...uomResults.map((res) => res.data[0]));

  this.setOptionData(
    [`stock_movement.${rowIndex}.received_quantity_uom`],
    uomOptions,
  );

  this.setData({
    [`stock_movement.${rowIndex}.uom_options`]: uomOptions,
  });
};

const handleSerialNumberManagement = async (
  itemData,
  rowIndex,
  movementType,
) => {
  if (
    movementType === "Miscellaneous Receipt" &&
    itemData.serial_number_management === 1
  ) {
    await this.setData({
      [`stock_movement.${rowIndex}.is_serialized_item`]: 1,
    });
    await this.display(`stock_movement.select_serial_number`);
    await this.disabled(
      `stock_movement.${rowIndex}.select_serial_number`,
      false,
    );
    await this.disabled(`stock_movement.${rowIndex}.received_quantity`, true);
  } else {
    await this.setData({
      [`stock_movement.${rowIndex}.is_serialized_item`]: 0,
    });
    await this.disabled(
      `stock_movement.${rowIndex}.select_serial_number`,
      true,
    );
    await this.disabled(`stock_movement.${rowIndex}.received_quantity`, false);
  }
};

(async () => {
  const rowIndex = arguments[0].rowIndex;

  if (arguments[0].value) {
    const allData = this.getValues();

    const movementType = allData.movement_type;
    const defaultBin = allData.default_bin;
    const defaultStorageLocation = allData.default_storage_location;
    const itemData = arguments[0]?.fieldModel?.item;

    if (itemData) {
      await handleBatchManagement(movementType, itemData, rowIndex);
      await handleBinLocation(defaultBin, defaultStorageLocation, rowIndex);
      await handleInvCategory(rowIndex, movementType);
      await handleUOM(itemData, rowIndex);
      await handleSerialNumberManagement(itemData, rowIndex, movementType);

      await this.setData({
        [`stock_movement.${rowIndex}.stock_summary`]: "",
        [`stock_movement.${rowIndex}.received_quantity_uom`]:
          itemData.based_uom,
        [`stock_movement.${rowIndex}.item_name`]: itemData.material_name,
        [`stock_movement.${rowIndex}.item_desc`]: itemData.material_desc,
        [`stock_movement.${rowIndex}.quantity_uom`]: itemData.based_uom,
        [`stock_movement.${rowIndex}.unit_price`]: itemData.purchase_unit_price,
      });

      await handleManufacturingAndExpiredDate();
    } else {
      const tableSM = this.getValue("stock_movement");
      for (const [rowIndex, sm] of tableSM.entries()) {
        console.log(sm.uom_options);
        await this.setOptionData(
          [`stock_movement.${rowIndex}.quantity_uom`],
          sm.uom_options,
        );
        await this.setOptionData(
          [`stock_movement.${rowIndex}.received_quantity_uom`],
          sm.uom_options,
        );
      }
    }
  } else {
    this.setData({
      [`stock_movement.${rowIndex}.requested_qty`]: 0,
      [`stock_movement.${rowIndex}.total_quantity`]: 0,
      [`stock_movement.${rowIndex}.to_recv_qty`]: 0,
      [`stock_movement.${rowIndex}.received_quantity`]: 0,
      [`stock_movement.${rowIndex}.received_quantity_uom`]: "",
      [`stock_movement.${rowIndex}.quantity_uom`]: "",
      [`stock_movement.${rowIndex}.unit_price`]: 0,
      [`stock_movement.${rowIndex}.amount`]: 0,
      [`stock_movement.${rowIndex}.storage_location_id`]: "",
      [`stock_movement.${rowIndex}.location_id`]: "",
      [`stock_movement.${rowIndex}.batch_id`]: "-",
      [`stock_movement.${rowIndex}.category`]: "",
      [`stock_movement.${rowIndex}.stock_summary`]: "",
      [`stock_movement.${rowIndex}.balance_id`]: "",
      [`stock_movement.${rowIndex}.temp_qty_data`]: "",
      [`stock_movement.${rowIndex}.item_name`]: "",
      [`stock_movement.${rowIndex}.item_desc`]: "",
    });

    this.disabled(
      [
        `stock_movement.${rowIndex}.category`,
        `stock_movement.${rowIndex}.location_id`,
        `stock_movement.${rowIndex}.storage_location_id`,
      ],
      true,
    );
  }
})();
