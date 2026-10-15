(async () => {
  const currentItemArray = arguments[0].selectedRecords;
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

  const resPOItem = await Promise.all(
    currentItemArray.map((record) =>
      db.collection("purchase_order_2ukyuanr_sub").doc(record.id).get(),
    ),
  );

  const poItemData = resPOItem.map((response) => response.data[0]);
  const itemArray = [];

  for (const item of poItemData) {
    const matchedSelectedRecord = currentItemArray.find(
      (record) => record.id === item.id,
    );

    const resItem = await db.collection("Item").doc(item.item_id).get();
    const itemData = resItem.data[0];
  
    const itemUOM = itemData?.table_uom_conversion?.find(
      (uomItem) => uomItem.alt_uom_id === item.quantity_uom,
    );
    
    const poItem = {
      item_id: item.item_id,
      item_name: item.item_name,
      item_desc: item.item_desc,
      more_desc: item.more_desc,
      quantity: matchedSelectedRecord
        ? matchedSelectedRecord.quantity
        : item.quantity,
      quantity_uom: item.quantity_uom,
      unit_price: matchedSelectedRecord
        ? matchedSelectedRecord.unit_price
        : item.unit_price,
      gross: item.gross,
      discount: item.discount,
      discount_uom: item.discount_uom,
      discount_amount: item.discount_amount,
      tax_preference: item.tax_preference,
      tax_percent: item.tax_percent,
      tax_amount: item.tax_amount,
      tax_inclusive: item.tax_inclusive,
      po_amount: item.po_amount,
      line_remark_1: item.line_remark_1,
      line_remark_2: item.line_remark_2,
      item_category_id: item.item_category_id,
      further_description: item.further_description,
      min_qty: parseFloat(itemUOM?.min_purchase_qty) || 0,
      max_qty: parseFloat(itemUOM?.max_purchase_qty) || 0,
      min_price: parseFloat(itemUOM?.purchase_min_price) || 0,
      max_price: parseFloat(itemUOM?.purchase_max_price) || 0,
    };

    itemArray.push(poItem);
  }

  latestPOItems = [...poLineItems, ...itemArray];
  updates["table_po"] = latestPOItems;
  setTimeout(async () => {
    await this.setData(updates);
    this.triggerEvent("POcalculation");
  }, 50);
})();
