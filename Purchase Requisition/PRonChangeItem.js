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
    [`table_pr.${rowIndex}.pr_line_material_name`]: "",
    [`table_pr.${rowIndex}.pr_line_material_desc`]: "",
    [`table_pr.${rowIndex}.pr_line_qty`]: 0,
    [`table_pr.${rowIndex}.pr_line_uom_id`]: "",
    [`table_pr.${rowIndex}.pr_line_unit_price`]: 0,
    [`table_pr.${rowIndex}.pr_line_gross`]: 0,
    [`table_pr.${rowIndex}.pr_line_discount`]: 0,
    [`table_pr.${rowIndex}.pr_line_discount_uom`]: "",
    [`table_pr.${rowIndex}.pr_line_discount_amount`]: 0,
    [`table_pr.${rowIndex}.pr_line_tax_rate_id`]: "",
    [`table_pr.${rowIndex}.pr_line_taxes_percent`]: "",
    [`table_pr.${rowIndex}.pr_line_tax_fee_amount`]: 0,
    [`table_pr.${rowIndex}.pr_tax_inclusive`]: 0,
    [`table_pr.${rowIndex}.pr_line_amount`]: 0,
    [`table_pr.${rowIndex}.item_category_id`]: "",
    [`table_pr.${rowIndex}.table_uom_conversion`]: "",
    [`table_pr.${rowIndex}.further_description`]: "",
  });
};

(async () => {
  const rowIndex = arguments[0].rowIndex;
  const prItem = arguments[0].prItem;
  const supplierID = this.getValue("pr_supplier_name");
  const plantID = this.getValue("plant_id");
  console.log("rowIndex", rowIndex);
  console.log("arguments[0]", arguments[0]);

  if (arguments[0].fieldModel && !prItem) {
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
        document_type: "PREQ",
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
          updates[`table_pr.${item.line_index}.pr_line_unit_price`] =
            item.unit_price;
          updates[`table_pr.${item.line_index}.pr_line_uom_id`] = item.uom_id;
          updates[`table_pr.${item.line_index}.pr_line_tax_rate_id`] =
            item.tax_rate;
          updates[`table_pr.${item.line_index}.pr_line_taxes_percent`] =
            item.tax_percent;
          updates[`table_pr.${item.line_index}.from_historical`] =
            item.from_historical;
          updates[`table_pr.${item.line_index}.pr_max_price`] = item.max_price;
          updates[`table_pr.${item.line_index}.pr_min_price`] = item.min_price;
          updates[`table_pr.${item.line_index}.pr_line_qty`] = item.quantity;
          updates[`table_pr.${item.line_index}.moq_qty`] = item.moq;
          updates[`table_pr.${item.line_index}.pr_line_discount`] =
            item.discount;
          updates[`table_pr.${item.line_index}.pr_line_discount_uom`] =
            item.discount_uom;
          updates[`table_pr.${item.line_index}.item_category_id`] =
            arguments[0].fieldModel.item.item_category;
          updates[`table_pr.${item.line_index}.pr_line_material_desc`] =
            resolveItemDesc(arguments[0].fieldModel.item, supplierID);
          updates[`table_pr.${item.line_index}.pr_line_material_name`] =
            arguments[0].fieldModel.item.material_name;
          updates[`table_pr.${item.line_index}.further_description`] =
            arguments[0].fieldModel.item.further_description;
        }
        await this.setData(updates);
        await this.triggerEvent("PRCalculation");
      },
      (error) => {
        console.log("error", error);
      },
    );

    this.disabled([`table_pr.${rowIndex}.pr_line_uom_id`], false);
    this.refreshFieldOptionData([
      `table_pr.${rowIndex}.pr_line_uom_id`,
      `table_pr.${rowIndex}.pr_line_taxes_percent`,
    ]);
  } else if (!arguments[0].fieldModel && prItem) {
    const rowIndex = arguments[0].index;
    if (prItem.pr_line_material_id) {
      const resItem = await db
        .collection("Item")
        .where({ id: prItem.pr_line_material_id })
        .get();

      if (resItem && resItem.data.length > 0) {
        const itemData = resItem.data[0];
      }
    }
    this.disabled([`table_pr.${rowIndex}.pr_line_uom_id`], false);
    this.refreshFieldOptionData([
      `table_pr.${rowIndex}.pr_line_uom_id`,
      `table_pr.${rowIndex}.pr_line_taxes_percent`,
    ]);
  } else if (!arguments[0].value) {
    await resetData(rowIndex);
    console.log("argument", arguments[0]);
    this.disabled(`table_pr.${rowIndex}.pr_line_uom_id`, true);
  } else {
    const tablePR = this.getValue("table_pr");
    for (const [rowIndex, pr] of tablePR.entries()) {
      console.log(pr.pr_line_uom_id);
      if (pr.pr_line_uom_id) {
        this.disabled(`table_pr.${rowIndex}.pr_line_uom_id`, false);
        this.refreshFieldOptionData([
          `table_pr.${rowIndex}.pr_line_uom_id`,
          `table_pr.${rowIndex}.pr_line_taxes_percent`,
        ]);
      }
    }
  }
})();
