// Pick the description this customer has bound to the item on the Item master.
// An item may carry several rows for the same customer -- take the first one
// that actually has a description. Falls back to the item's own material_desc.
const resolveItemDesc = (item, customerId) => {
  const fallback = item?.material_desc || "";
  if (!customerId || Array.isArray(customerId)) return fallback;

  const binds = Array.isArray(item?.table_cust_item_bind)
    ? item.table_cust_item_bind
    : [];
  const wanted = String(customerId).trim();

  for (const row of binds) {
    if (!row) continue;
    if (String(row.customer_id ?? "").trim() !== wanted) continue;
    const desc = String(row.item_desc ?? "").trim();
    if (desc) return desc;
  }

  return fallback;
};

const convertBaseToAlt = (baseQty, table_uom_conversion, uom) => {
  if (
    !Array.isArray(table_uom_conversion) ||
    table_uom_conversion.length === 0 ||
    !uom
  ) {
    return baseQty;
  }

  const uomConversion = table_uom_conversion.find(
    (conv) => conv.alt_uom_id === uom,
  );

  if (!uomConversion || !uomConversion.alt_qty) {
    return baseQty;
  }

  return Math.round(baseQty * uomConversion.alt_qty * 1000) / 1000;
};

const fetchUnrestrictedQty = async (
  itemId,
  item_batch_management,
  serial_number_management,
  stock_control,
  plantId,
  organizationId,
) => {
  try {
    let totalUnrestrictedQtyBase = 0;

    if (serial_number_management === 1) {
      const resSerialBalance = await db
        .collection("item_serial_balance")
        .where({
          material_id: itemId,
          ...(plantId !== organizationId ? { plant_id: plantId || null } : {}),
          organization_id: organizationId,
        })
        .get();

      if (resSerialBalance && resSerialBalance.data.length > 0) {
        const serialBalanceData = resSerialBalance.data;

        totalUnrestrictedQtyBase = serialBalanceData.reduce(
          (sum, balance) => sum + (balance.unrestricted_qty || 0),
          0,
        );
      }
    } else if (
      (serial_number_management !== 1 || !serial_number_management) &&
      item_batch_management === 1 &&
      (stock_control !== 0 || stock_control)
    ) {
      const resBatchBalance = await db
        .collection("item_batch_balance")
        .where({
          material_id: itemId,
          ...(plantId !== organizationId ? { plant_id: plantId || null } : {}),
          organization_id: organizationId,
        })
        .get();

      if (resBatchBalance && resBatchBalance.data.length > 0) {
        const batchBalanceData = resBatchBalance.data;

        totalUnrestrictedQtyBase = batchBalanceData.reduce(
          (sum, balance) => sum + (balance.unrestricted_qty || 0),
          0,
        );
      }
    } else if (
      (serial_number_management !== 1 || !serial_number_management) &&
      (item_batch_management !== 1 || !item_batch_management) &&
      (stock_control !== 0 || stock_control)
    ) {
      const resBalance = await db
        .collection("item_balance")
        .where({
          material_id: itemId,
          ...(plantId !== organizationId ? { plant_id: plantId || null } : {}),
          organization_id: organizationId,
        })
        .get();

      if (resBalance && resBalance.data.length > 0) {
        const balanceData = resBalance.data;

        totalUnrestrictedQtyBase = balanceData.reduce(
          (sum, balance) => sum + (balance.unrestricted_qty || 0),
          0,
        );
      }
    } else {
      totalUnrestrictedQtyBase = 0;
    }

    return totalUnrestrictedQtyBase;
  } catch (error) {
    console.error(error);
  }
};

(async () => {
  const currentItemArray = arguments[0].itemArray;
  const sqtLineItems = this.getValue("table_sqt");
  const plantId = this.getValue("sqt_plant");
  const customerID = this.getValue("sqt_customer_id");
  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  const itemArray = [];

  for (const item of currentItemArray) {
    let defaultSalesDetail = item.table_uom_conversion.find(
      (uom) => uom.sales_default_uom === 1,
    );

    if (!defaultSalesDetail) {
      defaultSalesDetail = item.table_uom_conversion.find(
        (uom) => uom.alt_uom_id === item.based_uom,
      );
    }

    const sqtItem = {
      material_id: item.id,
      material_name: item.material_name,
      sqt_desc: resolveItemDesc(item, customerID),
      unit_price: defaultSalesDetail.sales_unit_price || 0,
      item_category_id: item.item_category,
      sqt_taxes_rate_id: defaultSalesDetail.mat_sales_tax_id || null,
      sqt_tax_rate_percent: defaultSalesDetail.sales_tax_percent || null,
      sqt_order_uom_id: defaultSalesDetail.alt_uom_id || null,
      further_description: item.further_description,
    };

    itemArray.push(sqtItem);
  }

  await this.setData({
    table_sqt: [...sqtLineItems, ...itemArray],
  });

  this.closeDialog("dialog_item_selection");

  setTimeout(async () => {
    for (const [index, item] of currentItemArray.entries()) {
      let defaultSalesDetail = item.table_uom_conversion.find(
        (uom) => uom.sales_default_uom === 1,
      );

      if (!defaultSalesDetail) {
        defaultSalesDetail = item.table_uom_conversion.find(
          (uom) => uom.alt_uom_id === item.based_uom,
        );
      }
      const newIndex = sqtLineItems.length + index;

      this.disabled([`table_sqt.${newIndex}.sqt_order_uom_id`], false);
      this.refreshFieldOptionData([`table_sqt.${newIndex}.sqt_order_uom_id`]);

      if (item.mat_sales_tax_id) {
        this.disabled([`table_sqt.${newIndex}.sqt_tax_rate_percent`], false);
      }

      const initialQty = await fetchUnrestrictedQty(
        item.id,
        item.item_batch_management,
        item.serial_number_management,
        item.stock_control,
        plantId,
        organizationId,
      );

      const finalQty = await convertBaseToAlt(
        initialQty,
        item.table_uom_conversion,
        defaultSalesDetail.alt_uom_id,
      );
      await this.setData({
        [`table_sqt.${newIndex}.unrestricted_qty`]: parseFloat(
          finalQty.toFixed(4),
        ),
        [`table_sqt.${newIndex}.base_unrestricted_qty`]: parseFloat(
          initialQty.toFixed(4),
        ),
      });
    }

    await this.runWorkflow(
      "2067818102244966401",
      {
        document_type: "SQT",
        supp_cust_id: customerID,
        plant_id: plantId,
        item_data: itemArray.map((item, index) => {
          return {
            item_id: item.material_id,
            unit_price: item.unit_price,
            line_index: sqtLineItems.length + index,
            uom_id: item.sqt_order_uom_id,
            tax_rate: item.sqt_taxes_rate_id || null,
            tax_percent: item.sqt_tax_rate_percent || null,
          };
        }),
      },
      async (result) => {
        console.log("result", result);
        const updates = {};

        for (const item of result.data.data) {
          updates[`table_sqt.${item.line_index}.unit_price`] = item.unit_price;
          updates[`table_sqt.${item.line_index}.sqt_order_uom_id`] =
            item.uom_id;
          updates[`table_sqt.${item.line_index}.sqt_taxes_rate_id`] =
            item.tax_rate;
          updates[`table_sqt.${item.line_index}.sqt_tax_rate_percent`] =
            item.tax_percent;
          updates[`table_sqt.${item.line_index}.from_historical`] =
            item.from_historical;
          updates[`table_sqt.${item.line_index}.max_price`] = item.max_price;
          updates[`table_sqt.${item.line_index}.min_price`] = item.min_price;
          updates[`table_sqt.${item.line_index}.quantity`] = item.quantity;
          updates[`table_sqt.${item.line_index}.sqt_discount`] = item.discount;
          updates[`table_sqt.${item.line_index}.sqt_discount_uom_id`] =
            item.discount_uom;
        }

        await this.setData(updates);
        await this.triggerEvent("SQTCalculation");
      },
      (error) => {
        console.log("error", error);
      },
    );
  }, 50);
})();
