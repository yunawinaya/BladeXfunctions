const convertBaseToAlt = (baseQty, table_uom_conversion, uom) => {
  if (
    !Array.isArray(table_uom_conversion) ||
    table_uom_conversion.length === 0 ||
    !uom
  ) {
    return baseQty;
  }

  const uomConversion = table_uom_conversion.find(
    (conv) => conv.alt_uom_id === uom
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
  organizationId
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
          0
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
          0
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
          0
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
    const sqtItem = {
      material_id: item.id,
      material_name: item.material_name,
      sqt_desc: item.material_desc,
      unit_price: item.sales_unit_price || 0,
      item_category_id: item.item_category,
      sqt_taxes_rate_id: item.mat_sales_tax_id || null,
      sqt_tax_rate_percent: item.sales_tax_percent || null,
      sqt_order_uom_id: item.sales_default_uom || item.based_uom,
    };

    itemArray.push(sqtItem);
  }

  await this.setData({
    table_sqt: [...sqtLineItems, ...itemArray],
  });

  this.closeDialog("dialog_item_selection");

  setTimeout(async () => {
    for (const [index, item] of currentItemArray.entries()) {
      const newIndex = sqtLineItems.length + index;

      this.disabled([`table_sqt.${newIndex}.sqt_order_uom_id`], false);
      this.refreshFieldOptionData([
        `table_sqt.${newIndex}.sqt_order_uom_id`,
        `table_sqt.${newIndex}.sqt_tax_rate_percent`,
      ]);

      if (item.mat_sales_tax_id) {
        this.disabled([`table_sqt.${newIndex}.sqt_tax_rate_percent`], false);
      }

      const initialQty = await fetchUnrestrictedQty(
        item.id,
        item.item_batch_management,
        item.serial_number_management,
        item.stock_control,
        plantId,
        organizationId
      );

      if (item.sales_default_uom) {
        const finalQty = await convertBaseToAlt(
          initialQty,
          item.table_uom_conversion,
          item.sales_default_uom
        );
        await this.setData({
          [`table_sqt.${newIndex}.sqt_order_uom_id`]: item.sales_default_uom,
          [`table_sqt.${newIndex}.unrestricted_qty`]: parseFloat(
            finalQty.toFixed(4)
          ),
          [`table_sqt.${newIndex}.base_unrestricted_qty`]: parseFloat(
            initialQty.toFixed(4)
          ),
        });
      } else {
        const finalQty = await convertBaseToAlt(
          initialQty,
          item.table_uom_conversion,
          item.based_uom
        );
        await this.setData({
          [`table_sqt.${newIndex}.sqt_order_uom_id`]: item.based_uom,
          [`table_sqt.${newIndex}.unrestricted_qty`]: parseFloat(
            finalQty.toFixed(4)
          ),
          [`table_sqt.${newIndex}.base_unrestricted_qty`]: parseFloat(
            initialQty.toFixed(4)
          ),
        });
      }
    }
  }, 50);
})();
