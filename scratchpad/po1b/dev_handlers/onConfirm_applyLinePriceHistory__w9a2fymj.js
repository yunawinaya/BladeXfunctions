(async () => {
  const currentItemArray = arguments[0].selectedRecords;
  const rowIndex = arguments[0].rowIndex;
  const poLineItems = this.getValue("table_po");
  let updates = {};
  let latestPOItems = [];

  if (currentItemArray.length === 0) {
    return;
  }

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  const currentItem = currentItemArray[0];
  const resPOItem = await db
    .collection("purchase_order_2ukyuanr_sub")
    .doc(currentItem.id)
    .get();

  const poItemData = resPOItem.data[0];

  const resItem = await db
    .collection("Item")
    .doc(poItemData.item_id)
    .get();

  const itemData = resItem.data[0];

  const itemUOM = itemData?.table_uom_conversion?.find(
    (uomItem) => uomItem.alt_uom_id === poItemData.quantity_uom,
  );
  
  const poItem = {
    item_id: poItemData.item_id,
    item_name: poItemData.item_name,
    item_desc: poItemData.item_desc,
    more_desc: poItemData.more_desc,
    quantity: currentItem.quantity,
    quantity_uom: poItemData.quantity_uom,
    unit_price: currentItem.unit_price,
    gross: poItemData.gross,
    discount: poItemData.discount,
    discount_uom: poItemData.discount_uom,
    discount_amount: poItemData.discount_amount,
    tax_preference: poItemData.tax_preference,
    tax_percent: poItemData.tax_percent,
    tax_amount: poItemData.tax_amount,
    tax_inclusive: poItemData.tax_inclusive,
    po_amount: poItemData.po_amount,
    line_remark_1: poItemData.line_remark_1,
    line_remark_2: poItemData.line_remark_2,
    item_category_id: poItemData.item_category_id,
    further_description: poItemData.further_description,
    min_qty: parseFloat(itemUOM?.min_purchase_qty) || 0,
    max_qty: parseFloat(itemUOM?.max_purchase_qty) || 0,
    min_price: parseFloat(itemUOM?.purchase_min_price) || 0,
    max_price: parseFloat(itemUOM?.purchase_max_price) || 0,
  };

  const findRowByFmKey = (rows, fmKey) => {
    for (const row of rows || []) {
      if (String(row.fm_key) === String(fmKey)) {
        return row;
      }

      const child = findRowByFmKey(row.children, fmKey);

      if (child) return child;
    }

    return null;
  };

  const updateRowByFmKey = (rows, fmKey, changes) => {
    return (rows || []).map((row) => {
      if (String(row.fm_key) === String(fmKey)) {
        return { ...row, ...changes };
      }

      if (Array.isArray(row.children)) {
        return {
          ...row,
          children: updateRowByFmKey(row.children, fmKey, changes),
        };
      }

      return row;
    });
  };

  const currentPOLine = findRowByFmKey(poLineItems, rowIndex);

  if (!currentPOLine) {
    console.log("Target row not found:", rowIndex);
    return;
  }

  // A manual bundle child takes the history quantity too, so its ratio to the
  // parent has to follow, the same as an Overwrite in onBlur_quantity.
  const parentKey = currentPOLine.parent_fm_key ?? currentPOLine.parent_id;

  if (parentKey != null && !currentPOLine.item_bundle_id) {
    const parentRow =
      findRowByFmKey(poLineItems, currentPOLine.parent_fm_key) ||
      poLineItems.find(
        (row) => row.id != null && String(row.id) === String(currentPOLine.parent_id),
      );
    const parentQty = Number(parentRow?.quantity) || 0;

    if (parentQty > 0) {
      poItem.bundle_ratio = (Number(poItem.quantity) || 0) / parentQty;
    }
  }

  latestPOItems = updateRowByFmKey(poLineItems, rowIndex, poItem);

  updates = {
    table_po: latestPOItems,
  };

  setTimeout(async () => {
    await this.setData(updates);
    this.triggerEvent("POcalculation");
  }, 50);
})();
