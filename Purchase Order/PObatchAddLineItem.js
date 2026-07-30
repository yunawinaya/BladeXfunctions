// Pick the description this supplier has bound to the item on the Item master.
// Reads table_sup_item_bind (supplier_id / item_description) -- NOT the customer
// twin. An item may carry several rows for the same supplier: take the first one
// that actually has a description. Falls back to the item's own material_desc.
const resolveItemDesc = (item, supplierId) => {
  const fallback = item?.material_desc || "";
  if (!supplierId || Array.isArray(supplierId)) return fallback;

  const binds = Array.isArray(item?.table_sup_item_bind)
    ? item.table_sup_item_bind
    : [];
  const wanted = String(supplierId).trim();

  for (const row of binds) {
    if (!row) continue;
    if (String(row.supplier_id ?? "").trim() !== wanted) continue;
    const desc = String(row.item_description ?? "").trim();
    if (desc) return desc;
  }

  return fallback;
};

(async () => {
  const currentItemArray = arguments[0].itemArray;
  const poLineItems = this.getValue("table_po");
  const itemArray = [];
  const supplierID = this.getValue("po_supplier_id");
  const plantID = this.getValue("po_plant");

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  for (const item of currentItemArray) {
    let defaultPurchaseDetail = item.table_uom_conversion.find(
      (uom) => uom.purchase_default_uom === 1,
    );

    if (!defaultPurchaseDetail) {
      defaultPurchaseDetail = item.table_uom_conversion.find(
        (uom) => uom.alt_uom_id === item.based_uom,
      );
    }

    const poItem = {
      item_id: item.id,
      item_name: item.material_name,
      item_desc: resolveItemDesc(item, supplierID),
      unit_price: defaultPurchaseDetail.purchase_unit_price || 0,
      item_category_id: item.item_category,
      tax_preference: defaultPurchaseDetail.mat_purchase_tax_id || null,
      tax_percent: defaultPurchaseDetail.purchase_tax_percent || null,
      quantity_uom: defaultPurchaseDetail.alt_uom_id || null,
      further_description: item.further_description,
    };

    itemArray.push(poItem);
  }

  await this.setData({
    table_po: [...poLineItems, ...itemArray],
  });

  this.closeDialog("dialog_item_selection");

  setTimeout(async () => {
    for (const [index, item] of currentItemArray.entries()) {
      const newIndex = poLineItems.length + index;
      this.setData({
        [`table_po.${newIndex}.alt_uom`]: JSON.stringify(
          item.table_uom_conversion,
        ),
      });

      this.disabled([`table_po.${newIndex}.quantity_uom`], false);
      this.refreshFieldOptionData([`table_po.${newIndex}.quantity_uom`]);

      if (item.mat_purchase_tax_id) {
        this.disabled([`table_po.${newIndex}.tax_percent`], false);
      }
    }

    await this.runWorkflow(
      "2067818102244966401",
      {
        document_type: "PO",
        supp_cust_id: supplierID,
        plant_id: plantID,
        item_data: itemArray.map((item, index) => {
          return {
            item_id: item.item_id,
            unit_price: item.unit_price,
            line_index: poLineItems.length + index,
            uom_id: item.quantity_uom,
            tax_rate: item.tax_preference || null,
            tax_percent: item.tax_percent || null,
          };
        }),
      },
      async (result) => {
        console.log("result", result);
        const updates = {};

        for (const item of result.data.data) {
          updates[`table_po.${item.line_index}.unit_price`] = item.unit_price;
          updates[`table_po.${item.line_index}.quantity_uom`] = item.uom_id;
          updates[`table_po.${item.line_index}.tax_preference`] = item.tax_rate;
          updates[`table_po.${item.line_index}.tax_percent`] = item.tax_percent;
          updates[`table_po.${item.line_index}.from_historical`] =
            item.from_historical;
          updates[`table_po.${item.line_index}.max_price`] = item.max_price;
          updates[`table_po.${item.line_index}.min_price`] = item.min_price;
          updates[`table_po.${item.line_index}.quantity`] = item.quantity;
          updates[`table_po.${item.line_index}.moq_qty`] = item.moq;
          updates[`table_po.${item.line_index}.discount`] = item.discount;
          updates[`table_po.${item.line_index}.discount_uom`] =
            item.discount_uom;
        }

        await this.setData(updates);
        await this.triggerEvent("POcalculation");
      },
      (error) => {
        console.log("error", error);
      },
    );
  }, 50);
})();
