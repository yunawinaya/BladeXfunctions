const fetchItemData = async (itemID) => {
  const resItem = await db
    .collection("Item")
    .field(
      "receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method,item_category,serial_number_management,table_uom_conversion,based_uom,formula,table_default_bin",
    )
    .where({ id: itemID })
    .get();

  if (!resItem || resItem.data.length === 0) return;
  else return resItem.data[0];
};

// Item master default bin for this plant. Takes priority over the plant-level
// default; a row without a bin is treated as unconfigured so we never stamp a
// blank bin on the line.
const getItemDefaultBin = (tableDefaultBin, plantId) => {
  if (!plantId || !Array.isArray(tableDefaultBin)) return null;

  const matchingBin = tableDefaultBin.find(
    (bin) => bin.plant_id === plantId && bin.bin_location,
  );

  if (!matchingBin) return null;

  return {
    binLocation: matchingBin.bin_location,
    storageLocation: matchingBin.storage_location || null,
  };
};

// The bundle row carries the bundle id and no item of its own; a bundle's items
// carry the bundle id and an item.
const isBundleParentRow = (gr) => Boolean(gr.item_bundle_id) && !gr.item_id;

const isBundleChildRow = (gr) =>
  Boolean(gr.item_bundle_id) && Boolean(gr.item_id);

// Everything that has to be applied to a row once it exists in the form.
// Addressed by path rather than row index, because a bundle child lives under
// its parent (`table_gr.3.children.1`) and has no index of its own.
const processGrRow = async (gr, path, invCategoryData, putawaySetupData) => {
  console.log(gr.item_id);
  // check item batch field
  this.disabled(
    `${path}.item_batch_no`,
    (gr.item_batch_no !== "" && gr.item_id !== "") ||
      (!gr.item_id && gr.item_batch_no === ""),
  );

  // The bundle row is not stock: no batch, no bin, no inventory category. All
  // of that belongs to the items underneath it.
  //
  // Locked here rather than by the columns' own disabled expressions, because
  // onChange_plant and this handler both disable the whole location_id column
  // imperatively — a column-level call overrides the per-row expression, so the
  // row has to be locked per row too.
  if (isBundleParentRow(gr)) {
    this.disabled(
      [
        `${path}.storage_location_id`,
        `${path}.location_id`,
        `${path}.inv_category`,
        `${path}.manufacturing_date`,
        `${path}.expired_date`,
      ],
      true,
    );

    return;
  }

  // set inventory category option and default value
  const putawayCategory = putawaySetupData?.category || "In Transit";

  if (gr.inspection_required === "No") {
    if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
      const invCategoryOption = invCategoryData.filter(
        (cat) => cat.dict_key === "Unrestricted" || cat.dict_key === "Blocked",
      );
      this.setOptionData(`${path}.inv_category`, invCategoryOption);

      this.setData({
        [`${path}.inv_category`]: "Unrestricted",
      });
    } else if (putawaySetupData && putawaySetupData.putaway_required === 1) {
      const invCategoryOption = invCategoryData.filter((cat) =>
        putawayCategory === "In Transit"
          ? cat.dict_key === "In Transit"
          : cat.dict_key === "In Transit" || cat.dict_key === "Unrestricted",
      );
      this.setOptionData(`${path}.inv_category`, invCategoryOption);

      this.setData({
        [`${path}.inv_category`]: putawayCategory,
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
      this.setOptionData(`${path}.inv_category`, invCategoryOption);
    } else if (putawaySetupData && putawaySetupData.putaway_required === 1) {
      const invCategoryOption = invCategoryData.filter(
        (cat) =>
          cat.dict_key === putawayCategory ||
          cat.dict_key === "Quality Inspection",
      );
      this.setOptionData(`${path}.inv_category`, invCategoryOption);
      this.display("assigned_to");
    }

    this.setData({
      [`${path}.inv_category`]: "Quality Inspection",
    });
  }

  // disabled / enabled manufacturing & expired date
  if (gr.item_batch_no === "-") {
    this.disabled([`${path}.manufacturing_date`, `${path}.expired_date`], true);
  }
};

const processData = async (tableGR, invCategoryData, putawaySetupData) => {
  for (const [rowIndex, gr] of tableGR.entries()) {
    const path = `table_gr.${rowIndex}`;

    await processGrRow(gr, path, invCategoryData, putawaySetupData);

    // A bundle's items are rows of the tree, not of table_gr, so they are
    // reached through their parent.
    const bundleChildren = Array.isArray(gr.children) ? gr.children : [];

    for (const [childIndex, child] of bundleChildren.entries()) {
      await processGrRow(
        child,
        `${path}.children.${childIndex}`,
        invCategoryData,
        putawaySetupData,
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

  return altQty * uomConversion.base_qty;
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

  const buildContext = {
    plantID,
    defaultStorageLocationID,
    defaultBinLocationID,
  };

  // One table_gr row, enriched from the item master and the plant's defaults.
  // A bundle's items go through here too — they are stock lines in their own
  // right and need the same batch, bin and UOM treatment as any other line.
  const buildGrLineRecord = async (item, context) => {
    let itemData;
    if (item.item_id) {
      itemData = await fetchItemData(item.item_id);
    }

    const itemDefaultBin = getItemDefaultBin(
      itemData?.table_default_bin,
      context.plantID,
    );

    // The bundle row holds no stock, so it gets no storage location, no bin and
    // no batch — those belong to the items underneath it.
    const isBundleParent = isBundleParentRow(item);

    const newTableGrRecord = {
      ...item,
      base_ordered_qty: item.ordered_qty,
      base_ordered_qty_uom: item.ordered_qty_uom || null,
      base_item_uom: item.ordered_qty_uom || null,
      base_received_qty_uom: item.ordered_qty_uom || null,
      inspection_required: itemData?.receiving_inspection === 1 ? "Yes" : "No",
      to_received_qty: 0,
      base_received_qty: parseFloat(
        (item.ordered_qty - (item.initial_received_qty || 0)),
      ),
      storage_location_id: isBundleParent
        ? null
        : itemDefaultBin?.storageLocation || context.defaultStorageLocationID,
      location_id: isBundleParent
        ? null
        : itemDefaultBin?.binLocation || context.defaultBinLocationID,
      item_batch_no: isBundleParent
        ? ""
        : itemData
          ? itemData?.item_batch_management === 0
            ? "-"
            : itemData?.batch_number_genaration ===
                "According To System Settings"
              ? "Auto-generated batch number"
              : ""
          : "-",
      inv_category: "",
      item_costing_method: itemData?.material_costing_method || null,
      uom_conversion: 0,
      is_split: "No",
      parent_or_child: "Parent",
      parent_index: 0,
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
        (baseQty - baseReceivedQty || 0),
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

    return newTableGrRecord;
  };

  for (const item of tableGR) {
    const newTableGrRecord = await buildGrLineRecord(item, buildContext);

    // A bundle keeps its items under `children`, so they are enriched the same
    // way and stay under the row they belong to.
    const bundleChildren = Array.isArray(item.children) ? item.children : [];

    if (bundleChildren.length > 0) {
      newTableGrRecord.children = [];

      for (const child of bundleChildren) {
        newTableGrRecord.children.push(
          await buildGrLineRecord(child, buildContext),
        );
      }
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
    const applyRowButtons = (row, path) => {
      // A bundle child's quantity is filled in from its parent's by ratio, so
      // it stays read-only whatever the serial number setting says.
      const isBundleChild = isBundleChildRow(row);
      // The bundle row's base quantity is derived from its own received_qty,
      // never typed: editing it runs the plain-item path, which does not spread
      // to the items under it and silently desyncs the bundle.
      const isBundleRow = Boolean(row.item_bundle_id);

      if (row.is_serialized_item === 1) {
        this.disabled(`${path}.received_qty`, true);
        this.disabled(`${path}.base_received_qty`, true);
      } else {
        this.disabled(`${path}.select_serial_number`, true);
        this.disabled(`${path}.received_qty`, isBundleChild);
        this.disabled(`${path}.base_received_qty`, isBundleRow);
      }

      if (row.has_formula === 1) {
        this.disabled(`${path}.button_formula`, false);
      } else {
        this.disabled(`${path}.button_formula`, true);
      }
    };

    newTableGR.forEach((gr, rowIndex) => {
      applyRowButtons(gr, `table_gr.${rowIndex}`);

      const bundleChildren = Array.isArray(gr.children) ? gr.children : [];

      bundleChildren.forEach((child, childIndex) => {
        applyRowButtons(child, `table_gr.${rowIndex}.children.${childIndex}`);
      });
    });
  }, 100);
})();
