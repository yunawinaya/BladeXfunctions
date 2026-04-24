const fetchItemData = async (itemID) => {
  const resItem = await db
    .collection("Item")
    .field(
      "receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method,item_category,serial_number_management,table_uom_conversion,based_uom,formula",
    )
    .where({ id: itemID })
    .get();

  if (!resItem || resItem.data.length === 0) return;
  else return resItem.data[0];
};

const processData = async (tableGR, invCategoryData, putawaySetupData) => {
  for (const [rowIndex, gr] of tableGR.entries()) {
    const index = rowIndex;
    console.log(gr.item_id);
    // check item batch field
    this.disabled(
      `table_gr.${index}.item_batch_no`,
      (gr.item_batch_no !== "" && gr.item_id !== "") ||
        (!gr.item_id && gr.item_batch_no === ""),
    );

    // set inventory category option and default value
    const putawayCategory =
      putawaySetupData?.category || "In Transit";

    if (gr.inspection_required === "No") {
      if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
        const invCategoryOption = invCategoryData.filter(
          (cat) =>
            cat.dict_key === "Unrestricted" || cat.dict_key === "Blocked",
        );
        this.setOptionData(`table_gr.${index}.inv_category`, invCategoryOption);

        this.setData({
          [`table_gr.${index}.inv_category`]: "Unrestricted",
        });
      } else if (putawaySetupData && putawaySetupData.putaway_required === 1) {
        const invCategoryOption = invCategoryData.filter(
          (cat) =>
            cat.dict_key === "In Transit" ||
            cat.dict_key === "Unrestricted",
        );
        this.setOptionData(`table_gr.${index}.inv_category`, invCategoryOption);

        this.setData({
          [`table_gr.${index}.inv_category`]: putawayCategory,
        });

        this.display("assigned_to");
      }
    } else if (gr.inspection_required === "Yes") {
      if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
        const invCategoryOption = invCategoryData.filter(
          (cat) =>
            cat.dict_key === "Unrestricted" ||
            cat.dict_key === "Blocked" ||
            cat.dict_key === "Quality Inspection",
        );
        this.setOptionData(`table_gr.${index}.inv_category`, invCategoryOption);
      } else if (putawaySetupData && putawaySetupData.putaway_required === 1) {
        const invCategoryOption = invCategoryData.filter(
          (cat) =>
            cat.dict_key === putawayCategory ||
            cat.dict_key === "Quality Inspection",
        );
        this.setOptionData(`table_gr.${index}.inv_category`, invCategoryOption);
        this.display("assigned_to");
      }

      this.setData({
        [`table_gr.${index}.inv_category`]: "Quality Inspection",
      });
    }

    // disabled / enabled manufacturing & expired date
    if (gr.item_batch_no === "-") {
      this.disabled(
        [
          `table_gr.${index}.manufacturing_date`,
          `table_gr.${index}.expired_date`,
        ],
        true,
      );
    }
  }
};

const convertAltToBase = (altQty, uomConversionTable, altUOM) => {
  if (
    !Array.isArray(uomConversionTable) ||
    uomConversionTable.length === 0 ||
    !altUOM
  ) {
    return altQty;
  }

  const uomConversion = uomConversionTable.find(
    (conv) => conv.alt_uom_id === altUOM,
  );

  if (!uomConversion || !uomConversion.alt_qty) {
    return altQty;
  }

  return Math.round(altQty * uomConversion.base_qty * 1000) / 1000;
};

const fetchPredefinedData = async (plant) => {
  const [resStorageLocation, resPutAwaySetup, resCategory] = await Promise.all([
    db
      .collection("storage_location")
      .field("id")
      .where({
        plant_id: plant,
        is_deleted: 0,
        is_default: 1,
        location_type: "Common",
      })
      .get(),
    db
      .collection("putaway_setup")
      .where({
        plant_id: plant,
        is_deleted: 0,
        movement_type: "Good Receiving",
      })
      .get(),
    db.collection("blade_dict").where({ code: "inventory_category" }).get(),
  ]);

  let defaultBinLocation = "";

  if (resStorageLocation.data.length === 1) {
    await this.disabled(["table_gr.location_id"], false);

    await db
      .collection("bin_location")
      .where({
        storage_location_id: resStorageLocation.data[0].id,
        plant_id: plant,
        is_default: 1,
        is_deleted: 0,
      })
      .get()
      .then((res) => {
        if (res.data.length > 0) {
          defaultBinLocation = res.data[0].id;
        }
      });
  }

  const putawaySetup = resPutAwaySetup?.data[0] || null;
  const defaultStorageLocation = resStorageLocation?.data[0]?.id || "";
  const invCategory = resCategory?.data || null;

  const predefinedData = [
    {
      putawaySetup: putawaySetup,
      defaultStorageLocation: defaultStorageLocation,
      defaultBinLocation: defaultBinLocation,
      invCategory: invCategory,
    },
  ];

  return predefinedData;
};

(async () => {
  const plantID = this.getValue("plant_id");
  const tableGR = this.getValue("table_gr");
  const predefinedData = await fetchPredefinedData(plantID);
  const putawaySetupData = predefinedData[0].putawaySetup;
  const defaultStorageLocationID = predefinedData[0].defaultStorageLocation;
  const defaultBinLocationID = predefinedData[0].defaultBinLocation;
  const invCategoryData = predefinedData[0].invCategory;
  let newTableGR = [];

  for (const item of tableGR) {
    let itemData;
    if (item.item_id) {
      itemData = await fetchItemData(item.item_id);
    }

    const newTableGrRecord = {
      ...item,
      base_ordered_qty: item.ordered_qty,
      base_ordered_qty_uom: item.ordered_qty_uom || null,
      base_item_uom: item.ordered_qty_uom || null,
      base_received_qty_uom: item.ordered_qty_uom || null,
      inspection_required: itemData?.receiving_inspection === 1 ? "Yes" : "No",
      to_received_qty: 0,
      base_received_qty: parseFloat(
        (item.ordered_qty - (item.initial_received_qty || 0)).toFixed(3),
      ),
      storage_location_id: defaultStorageLocationID,
      location_id: defaultBinLocationID,
      item_batch_no: itemData
        ? itemData?.item_batch_management === 0
          ? "-"
          : itemData?.batch_number_genaration === "According To System Settings"
            ? "Auto-generated batch number"
            : ""
        : "-",
      inv_category: "",
      item_costing_method: itemData?.material_costing_method || null,
      uom_conversion: 0,
    };

    const isAltUOM = itemData?.table_uom_conversion?.find(
      (conv) =>
        conv.alt_uom_id === item.ordered_qty_uom &&
        conv.alt_uom_id !== itemData.based_uom,
    );

    if (isAltUOM) {
      this.display([
        "table_gr.ordered_qty_uom",
        "table_gr.base_ordered_qty",
        "table_gr.base_ordered_qty_uom",
        "table_gr.to_received_qty_uom",
        "table_gr.base_received_qty_uom",
        "table_gr.base_received_qty",
        "table_gr.base_item_uom",
      ]);

      const baseQty = convertAltToBase(
        item.ordered_qty,
        itemData.table_uom_conversion,
        item.ordered_qty_uom,
      );

      let baseReceivedQty = item.initial_received_qty;
      if (item.initial_received_qty > 0) {
        baseReceivedQty = convertAltToBase(
          item.initial_received_qty,
          itemData.table_uom_conversion,
          item.ordered_qty_uom,
        );
      }

      newTableGrRecord.base_ordered_qty = baseQty;
      newTableGrRecord.base_ordered_qty_uom = itemData?.based_uom;
      newTableGrRecord.base_received_qty_uom = itemData?.based_uom;
      newTableGrRecord.base_item_uom = itemData?.based_uom;
      newTableGrRecord.base_received_qty = parseFloat(
        (baseQty - baseReceivedQty || 0).toFixed(3),
      );
      newTableGrRecord.uom_conversion = isAltUOM.base_qty;
    }

    if (itemData?.serial_number_management === 1) {
      this.display("table_gr.select_serial_number");

      newTableGrRecord.is_serialized_item = 1;
    }

    if (itemData?.formula && itemData?.formula !== "") {
      this.display("table_gr.button_formula");

      newTableGrRecord.has_formula = 1;
      newTableGrRecord.formula = itemData?.formula;
    }

    if (itemData?.item_batch_management === 1) {
      this.display(["table_gr.manufacturing_date", "table_gr.expired_date"]);
    }

    newTableGR.push(newTableGrRecord);
  }

  newTableGR = newTableGR.filter((gr) => gr.received_qty !== 0);

  console.log(newTableGR);
  await this.setData({ table_gr: newTableGR, predefined_data: predefinedData });

  setTimeout(async () => {
    await processData(newTableGR, invCategoryData, putawaySetupData);
  }, 50);

  setTimeout(async () => {
    newTableGR.forEach((gr, rowIndex) => {
      if (gr.is_serialized_item === 1) {
        this.disabled(`table_gr.${rowIndex}.received_qty`, true);
        this.disabled(`table_gr.${rowIndex}.base_received_qty`, true);
      } else {
        this.disabled(`table_gr.${rowIndex}.select_serial_number`, true);
        this.disabled(`table_gr.${rowIndex}.received_qty`, false);
        this.disabled(`table_gr.${rowIndex}.base_received_qty`, false);
      }

      if (gr.has_formula === 1) {
        this.disabled(`table_gr.${rowIndex}.button_formula`, false);
      } else {
        this.disabled(`table_gr.${rowIndex}.button_formula`, true);
      }
    });
  }, 100);
})();
