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

const resetData = async (rowIndex) => {
  this.setData({
    [`table_po.${rowIndex}.item_name`]: "",
    [`table_po.${rowIndex}.item_desc`]: "",
    [`table_po.${rowIndex}.quantity`]: 0,
    [`table_po.${rowIndex}.quantity_uom`]: "",
    [`table_po.${rowIndex}.unit_price`]: 0,
    [`table_po.${rowIndex}.gross`]: 0,
    [`table_po.${rowIndex}.discount`]: 0,
    [`table_po.${rowIndex}.discount_uom`]: "",
    [`table_po.${rowIndex}.discount_amount`]: 0,
    [`table_po.${rowIndex}.tax_preference`]: "",
    [`table_po.${rowIndex}.tax_percent`]: "",
    [`table_po.${rowIndex}.tax_amount`]: 0,
    [`table_po.${rowIndex}.tax_inclusive`]: 0,
    [`table_po.${rowIndex}.po_amount`]: 0,
    [`table_po.${rowIndex}.received_qty`]: 0,
    [`table_po.${rowIndex}.return_quantity`]: 0,
    [`table_po.${rowIndex}.item_category_id`]: "",
    [`table_po.${rowIndex}.table_uom_conversion`]: "",
    [`table_po.${rowIndex}.alt_uom`]: "",
    [`table_po.${rowIndex}.further_description`]: "",
  });
};

(async () => {
  const rowIndex = arguments[0].rowIndex;
  const poItem = arguments[0].poItem;
  const supplierID = this.getValue("po_supplier_id");
  const plantID = this.getValue("po_plant");

  console.log("arguments line item", arguments[0]);
  if (arguments[0].fieldModel && !poItem) {
    console.log("arguments line item reset", arguments[0].fieldModel);
    console.log("arguments line item reset", poItem);
    await resetData(rowIndex);

    let defaultPurchaseDetail =
      arguments[0].fieldModel.item.table_uom_conversion.find(
        (uom) => uom.purchase_default_uom === 1,
      );

    if (!defaultPurchaseDetail) {
      defaultPurchaseDetail =
        arguments[0].fieldModel.item.table_uom_conversion.find(
          (uom) => uom.alt_uom_id === arguments[0].fieldModel.item.based_uom,
        );
    }

    await this.runWorkflow(
      "2067818102244966401",
      {
        document_type: "PO",
        supp_cust_id: supplierID,
        plant_id: plantID,
        item_data: [
          {
            item_id: arguments[0].value,
            line_index: rowIndex,
            uom_id: defaultPurchaseDetail.alt_uom_id,
          },
        ],
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
          updates[`table_po.${item.line_index}.item_category_id`] =
            arguments[0].fieldModel.item.item_category;
          updates[`table_po.${item.line_index}.item_desc`] = resolveItemDesc(
            arguments[0].fieldModel.item,
            supplierID,
          );
          updates[`table_po.${item.line_index}.item_name`] =
            arguments[0].fieldModel.item.material_name;
          updates[`table_po.${item.line_index}.further_description`] =
            arguments[0].fieldModel.item.further_description;
        }
        await this.setData(updates);
        await this.triggerEvent("POcalculation");
      },
      (error) => {
        console.log("error", error);
      },
    );

    this.setData({
      [`table_po.${rowIndex}.alt_uom`]: JSON.stringify(
        arguments[0].fieldModel.item.table_uom_conversion,
      ),
    });

    this.refreshFieldOptionData([
      `table_po.${rowIndex}.quantity_uom`,
      `table_po.${rowIndex}.tax_percent`,
    ]);
  } else if (!arguments[0].fieldModel && poItem) {
    const rowIndex = arguments[0].index;
    if (poItem.item_id) {
      const resItem = await db
        .collection("Item")
        .where({ id: poItem.item_id })
        .get();

      if (resItem && resItem.data.length > 0) {
        const itemData = resItem.data[0];
      }
    }

    this.setData({
      [`table_po.${rowIndex}.alt_uom`]: JSON.stringify(poItem.alt_uom),
    });

    this.refreshFieldOptionData([
      `table_po.${rowIndex}.quantity_uom`,
      `table_po.${rowIndex}.tax_percent`,
    ]);
  } else if (!arguments[0].value) {
    await resetData(rowIndex);
  } else {
    const tablePO = this.getValue("table_po");
    for (const [rowIndex, po] of tablePO.entries()) {
      console.log(po.quantity_uom);
      if (po.quantity_uom) {
        this.refreshFieldOptionData([
          `table_po.${rowIndex}.quantity_uom`,
          `table_po.${rowIndex}.tax_percent`,
        ]);
      }
    }
  }
})();
