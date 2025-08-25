const resetData = async (rowIndex) => {
  this.setData({
    [`table_sqt.${rowIndex}.material_name`]: "",
    [`table_sqt.${rowIndex}.sqt_desc`]: "",
    [`table_sqt.${rowIndex}.quantity`]: 0,
    [`table_sqt.${rowIndex}.sqt_order_uom_id`]: "",
    [`table_sqt.${rowIndex}.unit_price`]: 0,
    [`table_sqt.${rowIndex}.sqt_gross`]: 0,
    [`table_sqt.${rowIndex}.sqt_discount`]: 0,
    [`table_sqt.${rowIndex}.sqt_discount_uom_id`]: "",
    [`table_sqt.${rowIndex}.sqt_discount_amount`]: 0,
    [`table_sqt.${rowIndex}.sqt_taxes_rate_id`]: "",
    [`table_sqt.${rowIndex}.sqt_tax_rate_percent`]: "",
    [`table_sqt.${rowIndex}.sqt_taxes_fee_amount`]: 0,
    [`table_sqt.${rowIndex}.sqt_tax_inclusive`]: 0,
    [`table_sqt.${rowIndex}.sqt_brand_id`]: "",
    [`table_sqt.${rowIndex}.sqt_packaging_id`]: "",
    [`table_sqt.${rowIndex}.total_price`]: 0,
    [`table_sqt.${rowIndex}.item_category_id`]: "",
    [`table_sqt.${rowIndex}.unrestricted_qty`]: 0,
    [`table_sqt.${rowIndex}.base_unrestricted_qty`]: 0,
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
  item_serial_management,
  stock_control,
  plantId,
  organizationId
) => {
  try {
    let totalUnrestrictedQtyBase = 0;

    if (item_serial_management === 1) {
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
      serial_number_management !== 1 &&
      item_batch_management === 1 &&
      stock_control !== 0
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
      serial_number_management !== 1 &&
      item_batch_management !== 1 &&
      stock_control !== 0
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
  let rowIndex = arguments[0].rowIndex;

  if (arguments[0].index) {
    rowIndex = arguments[0].index;
  }
  const sqtItem = arguments[0].sqtItem || null;
  const plantId = this.getValue("sqt_plant");

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  if (arguments[0].fieldModel && !sqtItem) {
    await resetData(rowIndex);
    console.log(arguments[0]);
    const {
      material_desc,
      material_name,
      based_uom,
      sales_default_uom,
      sales_unit_price,
      table_uom_conversion,
      mat_sales_tax_id,
      item_batch_management,
      serial_number_management,
      stock_control,
      item_category,
    } = arguments[0].fieldModel.item;
    const altUoms = table_uom_conversion.map((data) => data.alt_uom_id);
    let uomOptions = [];

    await altUoms.push(based_uom);

    this.setData({
      [`table_sqt.${rowIndex}.sqt_desc`]: material_desc,
      [`table_sqt.${rowIndex}.material_name`]: material_name,
      [`table_sqt.${rowIndex}.unit_price`]: sales_unit_price,
      [`table_sqt.${rowIndex}.item_category_id`]: item_category,
    });

    if (mat_sales_tax_id) {
      this.setData({
        [`table_sqt.${rowIndex}.sqt_taxes_rate_id`]: mat_sales_tax_id,
      });

      const taxPercent =
        arguments[0]?.fieldModel?.item?.sales_tax_percent || null;

      if (taxPercent) {
        setTimeout(() => {
          this.setData({
            [`table_sqt.${rowIndex}.sqt_tax_rate_percent`]: taxPercent,
          });
        }, 1000);
      }
    }

    const res = await fetchUomData(altUoms);
    uomOptions.push(...res);

    await this.setOptionData(
      [`table_sqt.${rowIndex}.sqt_order_uom_id`],
      uomOptions
    );
    this.disabled([`table_sqt.${rowIndex}.sqt_order_uom_id`], false);

    const initialQty = await fetchUnrestrictedQty(
      arguments[0].value,
      item_batch_management,
      serial_number_management,
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
      await this.setData({
        [`table_sqt.${rowIndex}.sqt_order_uom_id`]: sales_default_uom,
        [`table_sqt.${rowIndex}.unrestricted_qty`]: parseFloat(
          finalQty.toFixed(4)
        ),
        [`table_sqt.${rowIndex}.base_unrestricted_qty`]: parseFloat(
          initialQty.toFixed(4)
        ),
      });
    } else {
      const finalQty = await convertBaseToAlt(
        initialQty,
        table_uom_conversion,
        based_uom
      );
      await this.setData({
        [`table_sqt.${rowIndex}.sqt_order_uom_id`]: based_uom,
        [`table_sqt.${rowIndex}.unrestricted_qty`]: parseFloat(
          finalQty.toFixed(4)
        ),
        [`table_sqt.${rowIndex}.base_unrestricted_qty`]: parseFloat(
          initialQty.toFixed(4)
        ),
      });
    }
  } else if (sqtItem) {
    let uomOptions = [];
    const rowIndex = arguments[0].index;
    if (sqtItem.material_id) {
      const resItem = await db
        .collection("Item")
        .where({ id: sqtItem.material_id })
        .get();

      if (resItem && resItem.data.length > 0) {
        const itemData = resItem.data[0];

        const itemUOM = itemData.table_uom_conversion.map(
          (data) => data.alt_uom_id
        );

        await itemUOM.push(itemData.based_uom);

        const resUOM = await fetchUomData(itemUOM);
        uomOptions.push(...resUOM);

        const initialQty = await fetchUnrestrictedQty(
          arguments[0].value,
          itemData.item_batch_management,
          itemData.serial_number_management,
          itemData.stock_control,
          plantId,
          organizationId
        );

        const finalQty = await convertBaseToAlt(
          initialQty,
          itemData.table_uom_conversion,
          sqtItem.sqt_order_uom_id
        );
        await this.setData({
          [`table_sqt.${rowIndex}.unrestricted_qty`]: parseFloat(
            finalQty.toFixed(4)
          ),
          [`table_sqt.${rowIndex}.base_unrestricted_qty`]: parseFloat(
            initialQty.toFixed(4)
          ),
        });
      }
    } else if (!sqtItem.material_id && sqtItem.sqt_desc !== "") {
      const resUOM = await db.collection("unit_of_measurement").get();
      uomOptions.push(...resUOM.data);
    }

    await this.setOptionData(
      [`table_sqt.${rowIndex}.sqt_order_uom_id`],
      uomOptions
    );
    this.disabled([`table_sqt.${rowIndex}.sqt_order_uom_id`], false);
  } else {
    await resetData(rowIndex);
  }
})();
