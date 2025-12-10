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

  if (!uomConversion || !uomConversion.base_qty) {
    return baseQty;
  }

  return Math.round(baseQty / uomConversion.base_qty * 1000) / 1000;
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
  const soLineItems = this.getValue("table_so");
  const plantId = this.getValue("plant_name");

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = (this.getVarSystem("deptIds") || "").split(",")[0] || "";
  }
  const itemArray = [];

  for (const item of currentItemArray) {
    const soItem = {
      item_name: item.id,
      item_id: item.material_name,
      so_desc: item.material_desc,
      so_item_price: item.sales_unit_price || 0,
      item_category_id: item.item_category,
      so_tax_preference: item.mat_sales_tax_id || null,
      so_tax_percentage: item.sales_tax_percent || null,
      so_item_uom: item.sales_default_uom || item.based_uom,
    };

    itemArray.push(soItem);
  }

  await this.setData({
    table_so: [...soLineItems, ...itemArray],
  });

  this.closeDialog("dialog_item_selection");

  setTimeout(async () => {
    for (const [index, item] of currentItemArray.entries()) {
      const newIndex = soLineItems.length + index;

      this.disabled([`table_so.${newIndex}.so_item_uom`], false);
      this.refreshFieldOptionData([
        `table_so.${newIndex}.so_item_uom`,
        `table_so.${newIndex}.so_tax_percentage`,
      ]);

      if (item.mat_sales_tax_id) {
        this.disabled([`table_so.${newIndex}.so_tax_percentage`], false);
      }

      console.log("item", item);

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
          [`table_so.${newIndex}.so_item_uom`]: item.sales_default_uom,
          [`table_so.${newIndex}.unrestricted_qty`]: parseFloat(
            finalQty.toFixed(4)
          ),
          [`table_so.${newIndex}.base_unrestricted_qty`]: parseFloat(
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
          [`table_so.${newIndex}.so_item_uom`]: item.based_uom,
          [`table_so.${newIndex}.unrestricted_qty`]: parseFloat(
            finalQty.toFixed(4)
          ),
          [`table_so.${newIndex}.base_unrestricted_qty`]: parseFloat(
            initialQty.toFixed(4)
          ),
        });
      }
    }
  }, 50);
})();
