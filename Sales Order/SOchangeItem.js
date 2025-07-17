const resetData = async (rowIndex) => {
  this.setData({
    [`table_so.${rowIndex}.so_desc`]: "",
    [`table_so.${rowIndex}.so_quantity`]: 0,
    [`table_so.${rowIndex}.so_item_uom`]: "",
    [`table_so.${rowIndex}.so_item_price`]: 0,
    [`table_so.${rowIndex}.so_gross`]: 0,
    [`table_so.${rowIndex}.so_discount`]: 0,
    [`table_so.${rowIndex}.so_discount_uom`]: "",
    [`table_so.${rowIndex}.so_discount_amount`]: 0,
    [`table_so.${rowIndex}.so_tax_preference`]: "",
    [`table_so.${rowIndex}.so_tax_percentage`]: "",
    [`table_so.${rowIndex}.so_tax_amount`]: 0,
    [`table_so.${rowIndex}.so_tax_inclusive`]: 0,
    [`table_so.${rowIndex}.so_brand`]: "",
    [`table_so.${rowIndex}.so_packaging_style`]: "",
    [`table_so.${rowIndex}.so_amount`]: 0,
    [`table_so.${rowIndex}.delivered_qty`]: 0,
  });
};

const fetchUomData = async (uomIds) => {
  try {
    const resUOM = await Promise.all(
      uomIds.map((id) =>
        db.collection("unit_of_measurement").where({ id }).get()
      )
    );

    const uomData = resUOM.map((response) => response.data[0]);

    return uomData;
  } catch (error) {
    console.error("Error fetching UOM data:", error);
    return [];
  }
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
    (conv) => conv.alt_uom_id === uom
  );

  if (!uomConversion || !uomConversion.base_qty) {
    return baseQty;
  }

  return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
};

const fetchUnrestrictedQty = async (
  itemId,
  item_batch_management,
  stock_control,
  plantId,
  organizationId
) => {
  try {
    let totalUnrestrictedQtyBase = 0;

    if (item_batch_management === 1 && stock_control !== 0) {
      const resBatchBalance = await db
        .collection("item_batch_balance")
        .where({
          material_id: itemId,
          plant_id: plantId,
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
    } else if (item_batch_management === 0 && stock_control !== 0) {
      const resBalance = await db
        .collection("item_balance")
        .where({
          material_id: itemId,
          plant_id: plantId,
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
  const rowIndex = arguments[0].rowIndex;
  const soItem = arguments[0].soItem;
  const plantId = this.getValue("plant_name");

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  if (arguments[0].fieldModel && !soItem) {
    await resetData(rowIndex);
    const {
      material_desc,
      material_name,
      based_uom,
      sales_default_uom,
      sales_unit_price,
      table_uom_conversion,
      mat_sales_tax_id,
      item_batch_management,
      stock_control,
    } = arguments[0].fieldModel.item;
    const altUoms = table_uom_conversion.map((data) => data.alt_uom_id);
    let uomOptions = [];

    await altUoms.push(based_uom);

    this.setData({
      [`table_so.${rowIndex}.so_desc`]: material_desc,
      [`table_so.${rowIndex}.item_id`]: material_name,
      [`table_so.${rowIndex}.so_item_price`]: sales_unit_price,
    });

    if (mat_sales_tax_id) {
      this.setData({
        [`table_so.${rowIndex}.so_tax_preference`]: mat_sales_tax_id,
      });

      const taxPercent =
        arguments[0]?.fieldModel?.item?.sales_tax_percent || null;

      if (taxPercent) {
        setTimeout(() => {
          this.setData({
            [`table_so.${rowIndex}.so_tax_percentage`]: taxPercent,
          });
        }, 1000);
      }
    }

    const res = await fetchUomData(altUoms);
    uomOptions.push(...res);

    console.log("uomOption", uomOptions);

    await this.setOptionData([`table_so.${rowIndex}.so_item_uom`], uomOptions);
    this.disabled([`table_so.${rowIndex}.so_item_uom`], false);

    const initialQty = await fetchUnrestrictedQty(
      arguments[0].value,
      item_batch_management,
      stock_control,
      plantId,
      organizationId
    );

    if (sales_default_uom) {
      const finalQty = await convertBaseToAlt(
        initialQty,
        table_uom_conversion,
        sales_default_uom
      );

      this.setData({
        [`table_so.${rowIndex}.so_item_uom`]: sales_default_uom,
        [`table_so.${rowIndex}.unrestricted_qty`]: finalQty,
        [`table_so.${rowIndex}.base_unrestricted_qty`]: initialQty,
      });
    } else {
      const finalQty = await convertBaseToAlt(
        initialQty,
        table_uom_conversion,
        based_uom
      );

      this.setData({
        [`table_so.${rowIndex}.so_item_uom`]: based_uom,
        [`table_so.${rowIndex}.unrestricted_qty`]: finalQty,
        [`table_so.${rowIndex}.base_unrestricted_qty`]: initialQty,
      });
    }
  } else if (soItem) {
    let uomOptions = [];
    const rowIndex = arguments[0].index;
    if (soItem.item_name) {
      const resItem = await db
        .collection("Item")
        .where({ id: soItem.item_name })
        .get();

      if (resItem && resItem.data.length > 0) {
        const itemData = resItem.data[0];

        const itemUOM = itemData.table_uom_conversion.map(
          (data) => data.alt_uom_id
        );

        await itemUOM.push(itemData.based_uom);

        const resUOM = await fetchUomData(itemUOM);
        uomOptions.push(...resUOM);
      }
    } else if (!soItem.item_name && soItem.so_desc !== "") {
      const resUOM = await db.collection("unit_of_measurement").get();
      uomOptions.push(...resUOM.data);
    }

    await this.setOptionData([`table_so.${rowIndex}.so_item_uom`], uomOptions);
    this.disabled([`table_so.${rowIndex}.so_item_uom`], false);
  } else {
    await resetData(rowIndex);
  }
})();
