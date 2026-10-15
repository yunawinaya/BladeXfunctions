const ITEM_FIELDS =
  "receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method,serial_number_management,table_uom_conversion,based_uom,formula,table_default_bin";

// Item master for all lines at once: one projected query per 500 items.
const fetchItemMap = async (itemIds) => {
  const ids = [...new Set(itemIds.map(String))];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 500) {
    chunks.push(ids.slice(i, i + 500));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      db
        .collection("Item")
        .field(ITEM_FIELDS)
        .filter(new Filter().in("id", chunk).build())
        .get(),
    ),
  );

  const itemMap = new Map();
  results.forEach((res) => {
    (res?.data || []).forEach((item) => itemMap.set(String(item.id), item));
  });
  return itemMap;
};

// Over-receive tolerance by UOM (first row per UOM, like find()); 0 = none.
const toleranceEntry = (uomRows) => {
  const entry = {};
  const seen = new Set();
  (uomRows || []).forEach((conv) => {
    if (seen.has(conv.alt_uom_id)) return;
    seen.add(conv.alt_uom_id);
    if (conv.over_receive_tolerance) {
      entry[conv.alt_uom_id] = conv.over_receive_tolerance;
    }
  });
  return Object.keys(entry).length > 0 ? entry : 0;
};

// Kept in _data for the received quantity handlers and validator.
const cacheTolerances = (itemMap) => {
  if (itemMap.size === 0) return;
  const store = this.models["_data"] || {};
  const tolerances = { ...(store.gr_item_tol || {}) };
  itemMap.forEach((item, id) => {
    tolerances[id] = toleranceEntry(item.table_uom_conversion);
  });
  this.models["_data"] = { ...store, gr_item_tol: tolerances };
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
  // Edit of a converted GR: only lines never enriched (no inspection_required)
  // are built; saved lines keep their bins, batches, categories and splits.
  const newRowsOnly = arguments[0]?.newRowsOnly === true;
  const isNewRow = (row) => !newRowsOnly || !row.inspection_required;

  const plantID = this.getValue("plant_id");
  const tableGR = this.getValue("table_gr");

  const itemIds = [];
  tableGR.filter(isNewRow).forEach((row) => {
    if (row.item_id) itemIds.push(row.item_id);
    (Array.isArray(row.children) ? row.children : []).forEach((child) => {
      if (child.item_id) itemIds.push(child.item_id);
    });
  });

  const [predefinedData, itemMap] = await Promise.all([
    fetchPredefinedData(plantID),
    fetchItemMap(itemIds),
  ]);
  cacheTolerances(itemMap);

  const putawaySetupData = predefinedData[0].putawaySetup;
  const defaultStorageLocationID = predefinedData[0].defaultStorageLocation;
  const defaultBinLocationID = predefinedData[0].defaultBinLocation;
  const invCategoryData = predefinedData[0].invCategory;
  const putawayCategory = putawaySetupData?.category || "In Transit";

  const buildContext = {
    plantID,
    defaultStorageLocationID,
    defaultBinLocationID,
  };

  const showColumns = {
    baseQty: false,
    serial: false,
    formula: false,
    dates: false,
  };

  // One table_gr row, enriched from the item master and the plant's defaults.
  // A bundle's items go through here too — they are stock lines in their own
  // right and need the same batch, bin and UOM treatment as any other line.
  const buildGrLineRecord = (item, context) => {
    let itemData;
    if (item.item_id) {
      itemData = itemMap.get(String(item.item_id));
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
      showColumns.baseQty = true;

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
      showColumns.serial = true;

      newTableGrRecord.is_serialized_item = 1;
    }

    if (itemData?.formula && itemData?.formula !== "") {
      showColumns.formula = true;

      newTableGrRecord.has_formula = 1;
      newTableGrRecord.formula = itemData?.formula;
    }

    if (itemData?.item_batch_management === 1) {
      showColumns.dates = true;
    }

    return newTableGrRecord;
  };

  // Inventory category options (and the default for a new line) by inspection
  // and the plant's putaway setup. null: the line gets neither.
  const categoryOptionCache = new Map();
  const categoryOptions = (key, keep) => {
    if (!categoryOptionCache.has(key)) {
      categoryOptionCache.set(key, (invCategoryData || []).filter(keep));
    }
    return categoryOptionCache.get(key);
  };

  const categoryFor = (gr) => {
    if (gr.inspection_required === "No") {
      if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
        return {
          options: categoryOptions(
            "no",
            (cat) =>
              cat.dict_key === "Unrestricted" || cat.dict_key === "Blocked",
          ),
          value: "Unrestricted",
        };
      } else if (putawaySetupData && putawaySetupData.putaway_required === 1) {
        return {
          options: categoryOptions("no-putaway", (cat) =>
            putawayCategory === "In Transit"
              ? cat.dict_key === "In Transit"
              : cat.dict_key === "In Transit" ||
                cat.dict_key === "Unrestricted",
          ),
          value: putawayCategory,
          assignedTo: true,
        };
      }
      return null;
    } else if (gr.inspection_required === "Yes") {
      if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
        return {
          options: categoryOptions(
            "yes",
            (cat) =>
              cat.dict_key === "Unrestricted" ||
              cat.dict_key === "Blocked" ||
              cat.dict_key === "Quality Inspection",
          ),
          value: "Quality Inspection",
        };
      } else if (putawaySetupData && putawaySetupData.putaway_required === 1) {
        return {
          options: categoryOptions(
            "yes-putaway",
            (cat) =>
              cat.dict_key === putawayCategory ||
              cat.dict_key === "Quality Inspection",
          ),
          value: "Quality Inspection",
          assignedTo: true,
        };
      }
      return { options: null, value: "Quality Inspection" };
    }
    return null;
  };

  const newTableGR = [];
  const builtRows = new Set();
  let hasNewRows = false;

  for (const item of tableGR) {
    if (!isNewRow(item)) {
      newTableGR.push(item);
      continue;
    }
    hasNewRows = true;

    const newTableGrRecord = buildGrLineRecord(item, buildContext);

    // A bundle keeps its items under `children`, so they are enriched the same
    // way and stay under the row they belong to.
    const bundleChildren = Array.isArray(item.children) ? item.children : [];

    if (bundleChildren.length > 0) {
      newTableGrRecord.children = bundleChildren.map((child) =>
        buildGrLineRecord(child, buildContext),
      );
    }

    [newTableGrRecord, ...(newTableGrRecord.children || [])].forEach((row) => {
      builtRows.add(row);
      const category = isBundleParentRow(row) ? null : categoryFor(row);
      if (category) row.inv_category = category.value;
    });

    if (newTableGrRecord.received_qty !== 0) {
      newTableGR.push(newTableGrRecord);
    }
  }

  // Per-row field states, applied once per state. The runtime copies its whole
  // state map for every path, so a line only gets the states that differ from
  // the column's own default (serial / formula buttons: the column expressions);
  // bundle lines keep the full set.
  const disabledByPath = new Map();
  const setDisabled = (paths, flag) => {
    [].concat(paths).forEach((path) => disabledByPath.set(path, flag));
  };
  const optionPaths = new Map();
  let showAssignedTo = false;
  // Base qty is typed per line only where its column shows: lines with an
  // alternate UOM here, or (Edit) the lines mounted's viewBaseQty looked at.
  const baseColumnsShown =
    showColumns.baseQty ||
    (newRowsOnly && tableGR.some((gr) => gr.item_uom !== gr.base_item_uom));

  const collectRowStates = (gr, path) => {
    const isSaved = !builtRows.has(gr);
    if (isSaved && gr.has_formula === 1) showColumns.formula = true;

    // A saved manual batch number stays editable (it used to be reset to "").
    const batchNo =
      isSaved &&
      gr.item_id &&
      gr.item_batch_no !== "-" &&
      gr.item_batch_no !== "Auto-generated batch number"
        ? ""
        : gr.item_batch_no;

    // check item batch field
    const isBundleLine = Boolean(gr.item_bundle_id);
    const batchDisabled =
      (batchNo !== "" && gr.item_id !== "") || (!gr.item_id && batchNo === "");
    if (batchDisabled || isBundleLine) {
      setDisabled(`${path}.item_batch_no`, batchDisabled);
    }

    // The bundle row is not stock: no batch, no bin, no inventory category. All
    // of that belongs to the items underneath it.
    //
    // Locked here rather than by the columns' own disabled expressions, because
    // onChange_plant and this handler both disable the whole location_id column
    // imperatively — a column-level call overrides the per-row expression, so the
    // row has to be locked per row too.
    if (isBundleParentRow(gr)) {
      setDisabled(
        [
          `${path}.storage_location_id`,
          `${path}.location_id`,
          `${path}.inv_category`,
          `${path}.manufacturing_date`,
          `${path}.expired_date`,
        ],
        true,
      );
    } else {
      const category = categoryFor(gr);
      if (category?.options) {
        if (!optionPaths.has(category.options)) {
          optionPaths.set(category.options, []);
        }
        optionPaths.get(category.options).push(`${path}.inv_category`);
      }
      if (category?.assignedTo) showAssignedTo = true;

      // disabled / enabled manufacturing & expired date
      if (gr.item_batch_no === "-" && isBundleLine) {
        setDisabled(
          [`${path}.manufacturing_date`, `${path}.expired_date`],
          true,
        );
      }
    }
  };

  const collectRowButtons = (row, path) => {
    // A bundle child's quantity is filled in from its parent's by ratio, so
    // it stays read-only whatever the serial number setting says.
    const isBundleChild = isBundleChildRow(row);
    // The bundle row's base quantity is derived from its own received_qty,
    // never typed: editing it runs the plain-item path, which does not spread
    // to the items under it and silently desyncs the bundle.
    const isBundleRow = Boolean(row.item_bundle_id);

    if (row.is_serialized_item === 1) {
      setDisabled(`${path}.received_qty`, true);
      if (isBundleRow) setDisabled(`${path}.base_received_qty`, true);
    } else if (isBundleRow) {
      setDisabled(`${path}.received_qty`, isBundleChild);
      setDisabled(`${path}.base_received_qty`, true);
    } else if (baseColumnsShown) {
      setDisabled(`${path}.base_received_qty`, false);
    }
  };

  newTableGR.forEach((gr, rowIndex) => {
    const path = `table_gr.${rowIndex}`;
    collectRowStates(gr, path);

    // A bundle's items are rows of the tree, not of table_gr, so they are
    // reached through their parent.
    const bundleChildren = Array.isArray(gr.children) ? gr.children : [];
    bundleChildren.forEach((child, childIndex) => {
      collectRowStates(child, `${path}.children.${childIndex}`);
    });
  });

  newTableGR.forEach((gr, rowIndex) => {
    collectRowButtons(gr, `table_gr.${rowIndex}`);

    const bundleChildren = Array.isArray(gr.children) ? gr.children : [];
    bundleChildren.forEach((child, childIndex) => {
      collectRowButtons(child, `table_gr.${rowIndex}.children.${childIndex}`);
    });
  });

  if (showColumns.baseQty) {
    this.display([
      "table_gr.ordered_qty_uom",
      "table_gr.base_ordered_qty",
      "table_gr.base_ordered_qty_uom",
      "table_gr.to_received_qty_uom",
      "table_gr.base_received_qty_uom",
      "table_gr.base_received_qty",
      "table_gr.base_item_uom",
    ]);
  }
  if (showColumns.serial) this.display("table_gr.select_serial_number");
  if (showColumns.formula) this.display("table_gr.button_formula");
  if (showColumns.dates) {
    this.display(["table_gr.manufacturing_date", "table_gr.expired_date"]);
  }

  console.log(
    "func_processGRLineItem rows:",
    newTableGR.length,
    "built:",
    builtRows.size,
  );
  await this.setData(
    hasNewRows
      ? { table_gr: newTableGR, predefined_data: predefinedData }
      : { predefined_data: predefinedData },
  );

  setTimeout(() => {
    optionPaths.forEach((paths, options) => {
      this.setOptionData(paths, options);
    });
    if (showAssignedTo) this.display("assigned_to");

    const disablePaths = [];
    const enablePaths = [];
    disabledByPath.forEach((flag, path) => {
      (flag ? disablePaths : enablePaths).push(path);
    });
    if (disablePaths.length > 0) this.disabled(disablePaths, true);
    if (enablePaths.length > 0) this.disabled(enablePaths, false);
  }, 50);
})();
