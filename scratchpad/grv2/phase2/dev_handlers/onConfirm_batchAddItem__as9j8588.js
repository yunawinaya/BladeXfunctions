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

// The bundle row itself: it carries the bundle id but no item, so it is a
// grouping row rather than stock. Its items are the rows underneath it.
const isBundleParentRow = (gr) => Boolean(gr.item_bundle_id) && !gr.item_id;

// An item under a bundle: it carries the bundle id and is a real item. Its
// quantity is derived from the parent's, so it is never typed directly.
const isBundleChildRow = (gr) =>
  Boolean(gr.item_bundle_id) && Boolean(gr.item_id);

// The inventory category a freshly added line lands on — the same rule
// processGrRow applies, expressed as a plain value. A bundle child is built
// before the tree exists, so its category is stamped on the record instead of
// being written to a row path afterwards.
const resolveDefaultInvCategory = (inspectionRequired, putawaySetupData) => {
  if (inspectionRequired === "Yes") return "Quality Inspection";

  if (putawaySetupData && putawaySetupData.putaway_required === 1) {
    return putawaySetupData.category || "In Transit";
  }

  return "Unrestricted";
};

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
  if (isBundleParentRow(gr)) {
    this.disabled([`${path}.manufacturing_date`, `${path}.expired_date`], true);

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

const processData = async (
  existingGR,
  tableGR,
  invCategoryData,
  putawaySetupData,
) => {
  for (const [rowIndex, gr] of tableGR.entries()) {
    const path = `table_gr.${existingGR.length + rowIndex}`;

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

// A bundle's items reach us in one of two shapes, and both mean the same thing:
// nested under the parent line's `children`, or sitting in the same flat
// table_po array pointing back at the parent through parent_id. The Document
// reference reads table_po straight off the purchase order, which is flat.
const getBundleChildren = (poItem, poLines) => {
  if (Array.isArray(poItem.children) && poItem.children.length > 0) {
    return poItem.children;
  }

  if (!Array.isArray(poLines) || poItem.id === undefined || poItem.id === null) {
    return [];
  }

  return poLines.filter(
    (line) =>
      line !== poItem &&
      line.parent_id !== undefined &&
      line.parent_id !== null &&
      String(line.parent_id) === String(poItem.id),
  );
};

// One table_gr row from one PO line of a selected purchase order ("Document"
// reference). The same builder runs over the bundle's items and hangs them under
// the row's own `children`, so the bundle is a tree in the GR however it arrived.
// The bundle row itself is not an item — it has no item_id, so no item is
// fetched for it and it receives no batch, UOM or costing method.
const buildGrRecordFromPoLine = async (poItem, po, context, poLines) => {
  let itemData;
  if (poItem.item_id) {
    itemData = await fetchItemData(poItem.item_id);
  }

  const isBundleParent = !poItem.item_id && Boolean(poItem.item_bundle_id);

  const itemDefaultBin = getItemDefaultBin(
    itemData?.table_default_bin,
    context.plantId,
  );

  const newTableGrRecord = {
    item_id: poItem.item_id || null,
    item_name: poItem.item_name,
    item_desc: poItem.item_desc,
    more_desc: poItem.more_desc,
    ordered_qty: poItem.quantity,
    ordered_qty_uom: poItem.quantity_uom || null,
    base_ordered_qty: poItem.quantity,
    base_ordered_qty_uom: poItem.quantity_uom || null,
    base_item_uom: poItem.quantity_uom || null,
    base_received_qty_uom: poItem.quantity_uom || null,
    inspection_required: itemData?.receiving_inspection === 1 ? "Yes" : "No",
    to_received_qty: poItem.created_received_qty || 0,
    to_received_qty_uom: poItem.quantity_uom || null,
    received_qty: parseFloat(
      (
        poItem.quantity -
        (poItem.received_qty || 0) -
        (poItem.created_received_qty || 0)
      ),
    ),
    base_received_qty: parseFloat(
      (
        poItem.quantity -
        (poItem.received_qty || 0) -
        (poItem.created_received_qty || 0)
      ),
    ),
    item_uom: poItem.quantity_uom || null,
    // The bundle row holds no stock, so it gets no bin and no batch.
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
          : itemData?.batch_number_genaration === "According To System Settings"
            ? "Auto-generated batch number"
            : ""
        : "-",
    inv_category: "",
    line_po_no: po.purchase_order_number,
    initial_received_qty: parseFloat((poItem.received_qty || 0)),
    line_po_id: po.purchase_order_id,
    unit_price: poItem.unit_price,
    total_price: poItem.po_amount,
    item_costing_method: itemData?.material_costing_method || null,
    line_remark_1: poItem.line_remark_1,
    line_remark_2: poItem.line_remark_2,
    po_line_item_id: poItem.id,
    item_bundle_id: poItem.item_bundle_id || null,
    item_category_id: itemData?.item_category || null,
    uom_conversion: 0,
    is_split: "No",
    parent_or_child: "Parent",
    parent_index: 0,
  };

  const isAltUOM = itemData?.table_uom_conversion?.find(
    (conv) =>
      conv.alt_uom_id === poItem.quantity_uom &&
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
      poItem.quantity,
      itemData.table_uom_conversion,
      poItem.quantity_uom,
    );

    let baseReceivedQty = poItem.received_qty;
    if (poItem.received_qty > 0) {
      baseReceivedQty = convertAltToBase(
        poItem.received_qty,
        itemData.table_uom_conversion,
        poItem.quantity_uom,
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

  const bundleChildren = getBundleChildren(poItem, poLines);

  if (bundleChildren.length > 0) {
    newTableGrRecord.children = [];

    for (const child of bundleChildren) {
      const childRecord = await buildGrRecordFromPoLine(
        child,
        po,
        context,
        poLines,
      );

      childRecord.inv_category = resolveDefaultInvCategory(
        childRecord.inspection_required,
        context.putawaySetupData,
      );

      newTableGrRecord.children.push(childRecord);
    }
  }

  return newTableGrRecord;
};

// One table_gr row from one row picked in the "Item" tab. Those rows are already
// mapped by rowClick_addPOItem, and a bundle keeps its items under `children`
// there too, so this builder recurses the same way as the Document one.
const buildGrRecordFromPoItem = (poItem, context) => {
  const isBundleParent = !poItem.item?.id && Boolean(poItem.item_bundle_id);

  const itemDefaultBin = getItemDefaultBin(
    context.defaultBinByItem.get(poItem.item?.id),
    context.plantId,
  );

  const newTableGrRecord = {
    item_id: poItem.item?.id || null,
    item_name: poItem.item?.material_name,
    item_desc: poItem.item_desc,
    more_desc: poItem.more_desc,
    ordered_qty: poItem.ordered_qty,
    ordered_qty_uom: poItem.item_uom || null,
    base_ordered_qty: poItem.ordered_qty,
    base_ordered_qty_uom: poItem.item_uom || null,
    base_item_uom: poItem.item_uom || null,
    base_received_qty_uom: poItem.item_uom || null,
    inspection_required: poItem.item?.receiving_inspection === 1 ? "Yes" : "No",
    to_received_qty: poItem.created_received_qty || 0,
    to_received_qty_uom: poItem.item_uom || null,
    received_qty: parseFloat(
      (
        poItem.ordered_qty -
        (poItem.received_qty || 0) -
        (poItem.created_received_qty || 0)
      ),
    ),
    base_received_qty: parseFloat(
      (
        poItem.ordered_qty -
        (poItem.received_qty || 0) -
        (poItem.created_received_qty || 0)
      ),
    ),
    item_uom: poItem.item_uom || null,
    // The bundle row holds no stock, so it gets no bin and no batch.
    storage_location_id: isBundleParent
      ? null
      : itemDefaultBin?.storageLocation || context.defaultStorageLocationID,
    location_id: isBundleParent
      ? null
      : itemDefaultBin?.binLocation || context.defaultBinLocationID,
    item_batch_no: isBundleParent
      ? ""
      : poItem.item
        ? poItem.item?.item_batch_management === 0
          ? "-"
          : poItem.item?.batch_number_genaration ===
              "According To System Settings"
            ? "Auto-generated batch number"
            : ""
        : "-",
    inv_category: "",
    line_po_no: poItem.purchase_order.purchase_order_no,
    initial_received_qty: parseFloat((poItem.received_qty || 0)),
    line_po_id: poItem.purchase_order.id,
    unit_price: poItem.unit_price,
    total_price: poItem.total_price,
    item_costing_method: poItem.item?.material_costing_method || null,
    line_remark_1: poItem.line_remark_1,
    line_remark_2: poItem.line_remark_2,
    po_line_item_id: poItem.purchase_order_line_id,
    item_bundle_id: poItem.item_bundle_id || null,
    item_category_id: poItem.item?.item_category || null,
    uom_conversion: 0,
    is_split: "No",
    parent_or_child: "Parent",
    parent_index: 0,
  };

  console.log("poItem.item", poItem.item);
  console.log("poItem", poItem);

  // A bundle row is not an item: it has no UOM of its own and no item record to
  // read a base UOM off, so there is nothing to convert. Its alt_uom is stored
  // as the string "null" — truthy, and parsing to null — so without this the
  // wrap below turns it into [null] and the lookup throws on null.alt_uom_id.
  if (poItem.alt_uom && !isBundleParent) {
    let poItemAltUOM = JSON.parse(poItem.alt_uom);
    if (typeof poItemAltUOM === "string") {
      poItemAltUOM = JSON.parse(poItemAltUOM);
    }
    poItemAltUOM = Array.isArray(poItemAltUOM) ? poItemAltUOM : [poItemAltUOM];
    poItemAltUOM = poItemAltUOM.filter(Boolean);
    console.log("poItemAltUOM", poItemAltUOM);

    const isAltUOM = poItemAltUOM.find(
      (conv) =>
        conv.alt_uom_id === poItem.item_uom &&
        conv.alt_uom_id !== poItem.item?.based_uom,
    );

    console.log("isAltUOM", isAltUOM);

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
        poItem.ordered_qty,
        poItemAltUOM,
        poItem.item_uom,
      );

      let baseReceivedQty = poItem.received_qty;
      if (poItem.received_qty > 0) {
        baseReceivedQty = convertAltToBase(
          poItem.received_qty,
          poItemAltUOM,
          poItem.item_uom,
        );
      }

      newTableGrRecord.base_ordered_qty = baseQty;
      newTableGrRecord.base_ordered_qty_uom = poItem.item.based_uom;
      newTableGrRecord.base_received_qty_uom = poItem.item.based_uom;
      newTableGrRecord.base_item_uom = poItem.item.based_uom;
      newTableGrRecord.base_received_qty = parseFloat(
        (baseQty - baseReceivedQty || 0),
      );
      newTableGrRecord.uom_conversion = isAltUOM.base_qty;
    }
  }

  if (poItem.item?.serial_number_management === 1) {
    this.display("table_gr.select_serial_number");

    newTableGrRecord.is_serialized_item = 1;
  }

  if (poItem.item?.formula && poItem.item?.formula !== "") {
    this.display("table_gr.button_formula");

    newTableGrRecord.has_formula = 1;
    newTableGrRecord.formula = poItem.item?.formula;
  }

  if (poItem.item?.item_batch_management === 1) {
    this.display(["table_gr.manufacturing_date", "table_gr.expired_date"]);
  }
  console.log("poItem.children", poItem);
  const bundleChildren = Array.isArray(poItem.children) ? poItem.children : [];

  if (bundleChildren.length > 0) {
    newTableGrRecord.children = [];

    for (const child of bundleChildren) {
      const childRecord = buildGrRecordFromPoItem(child, context);

      childRecord.inv_category = resolveDefaultInvCategory(
        childRecord.inspection_required,
        context.putawaySetupData,
      );

      newTableGrRecord.children.push(childRecord);
    }
  }

  return newTableGrRecord;
};

(async () => {
  const referenceType = this.getValue(`dialog_select_item.reference_type`);
  const currentItemArray = this.getValue(`dialog_select_item.item_array`);
  let existingGR = this.getValue("table_gr");
  const predefinedData = this.getValue("predefined_data");
  const previousReferenceType = this.getValue("reference_type");
  const supplierName = this.getValue("supplier_name");
  const plantId = this.getValue("plant_id");

  const putawaySetupData = predefinedData[0].putawaySetup;
  const defaultStorageLocationID = predefinedData[0].defaultStorageLocation;
  const defaultBinLocationID = predefinedData[0].defaultBinLocation;
  const invCategoryData = predefinedData[0].invCategory;

  let tableGR = [];
  let purchaseOrderNumber = [];
  let poId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one purchase order / item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  if (previousReferenceType && previousReferenceType !== referenceType) {
    await this.$confirm(
      `You've selected a different reference type than previously used. <br><br>Current Reference Type: ${referenceType} <br>Previous Reference Type: ${previousReferenceType} <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Reference Type Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingGR = [];
  }

  const uniqueSuppliers = new Set(
    currentItemArray.map((po) =>
      referenceType === "Document"
        ? po.supplier_id
        : po.purchase_order.po_supplier_id,
    ),
  );
  const allSameSupplier = uniqueSuppliers.size === 1;

  if (!allSameSupplier) {
    this.$alert(
      "Received item(s) from more than two different suppliers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    return;
  }

  if (supplierName && supplierName !== [...uniqueSuppliers][0]) {
    await this.$confirm(
      `You've selected a different supplier than previously used. <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Supplier Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingGR = [];
  }

  this.closeDialog("dialog_select_item");
  this.showLoading();

  // "Item" reference builds its lines straight from the dialog rows without an
  // item fetch. Reuse the subform the row already carries and resolve only the
  // ones missing it, in ONE batched fetch.
  const defaultBinByItem = new Map();

  if (referenceType === "Item") {
    const missingItemIds = [];

    // A bundle contributes no item of its own, only the items underneath it.
    const flattenSelectedRows = (rows) =>
      rows.flatMap((row) =>
        Array.isArray(row.children) && row.children.length > 0
          ? [row, ...flattenSelectedRows(row.children)]
          : [row],
      );

    for (const poItem of flattenSelectedRows(currentItemArray)) {
      const itemId = poItem.item?.id;
      if (!itemId || defaultBinByItem.has(itemId)) continue;

      if (Array.isArray(poItem.item.table_default_bin)) {
        defaultBinByItem.set(itemId, poItem.item.table_default_bin);
      } else if (!missingItemIds.includes(itemId)) {
        missingItemIds.push(itemId);
      }
    }

    if (missingItemIds.length > 0) {
      const resItems = await db
        .collection("Item")
        .filter(new Filter().in("id", missingItemIds).build())
        .get();

      for (const item of resItems?.data || []) {
        defaultBinByItem.set(item.id, item.table_default_bin);
      }
    }
  }

  const buildContext = {
    plantId,
    defaultStorageLocationID,
    defaultBinLocationID,
    putawaySetupData,
    defaultBinByItem,
  };

  switch (referenceType) {
    case "Document":
      for (const po of currentItemArray) {
        const poLines = Array.isArray(po.table_po) ? po.table_po : [];

        for (const poItem of poLines) {
          // In the flat shape a bundle's items sit in table_po next to their
          // parent. They are built as that parent's children, not as lines in
          // their own right, so they are skipped here.
          if (poItem.parent_id) continue;

          tableGR.push(
            await buildGrRecordFromPoLine(poItem, po, buildContext, poLines),
          );
        }
      }

      break;

    case "Item":
      for (const poItem of currentItemArray) {
        tableGR.push(buildGrRecordFromPoItem(poItem, buildContext));

        purchaseOrderNumber.push(poItem.purchase_order.purchase_order_no);
        poId.push(poItem.purchase_order.id);
      }
      break;
  }

  // Only top-level rows are filtered: a bundle is added or skipped as a whole,
  // and its items ride along with the parent.
  tableGR = tableGR.filter(
    (gr) =>
      (gr.initial_received_qty || 0) < (gr.ordered_qty || 0) && // Not fully received yet
      !existingGR.find(
        (grItem) => grItem.po_line_item_id === gr.po_line_item_id,
      ),
  );

  const latestTableGR = [...existingGR, ...tableGR];

  // Update parent_index for all Parent items to reflect their actual position
  for (let i = 0; i < latestTableGR.length; i++) {
    if (latestTableGR[i].parent_or_child === "Parent") {
      latestTableGR[i].parent_index = i;
    }
  }

  poId = [...new Set(latestTableGR.map((gr) => gr.line_po_id))];
  purchaseOrderNumber = [...new Set(latestTableGR.map((gr) => gr.line_po_no))];
  console.log(latestTableGR);
  await this.setData({
    currency_code:
      referenceType === "Document"
        ? currentItemArray[0].currency
        : currentItemArray[0].purchase_order.po_currency,
    supplier_name:
      referenceType === "Document"
        ? currentItemArray[0].supplier_id
        : currentItemArray[0].purchase_order.po_supplier_id,
    table_gr: [...existingGR, ...tableGR],
    purchase_order_number: purchaseOrderNumber.join(", "),
    po_id: poId,
    reference_type: referenceType,
  });

  setTimeout(async () => {
    await processData(existingGR, tableGR, invCategoryData, putawaySetupData);
  }, 50);

  setTimeout(async () => {
    tableGR.forEach((gr, index) => {
      const rowIndex = existingGR.length + index;

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

      applyRowButtons(gr, `table_gr.${rowIndex}`);

      const bundleChildren = Array.isArray(gr.children) ? gr.children : [];

      bundleChildren.forEach((child, childIndex) => {
        applyRowButtons(child, `table_gr.${rowIndex}.children.${childIndex}`);
      });
    });
  }, 100);

  this.hideLoading();
})();
