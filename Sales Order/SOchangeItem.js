const resetData = async (rowIndex) => {
  this.setData({
    [`table_so.${rowIndex}.so_desc`]: "",
    [`table_so.${rowIndex}.item_id`]: "",
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
    [`table_so.${rowIndex}.item_category_id`]: "",
    [`table_so.${rowIndex}.unrestricted_qty`]: 0,
    [`table_so.${rowIndex}.base_unrestricted_qty`]: 0,
    [`table_so.${rowIndex}.table_uom_conversion`]: "",
    [`table_so.${rowIndex}.packing_uom`]: "",
    [`table_so.${rowIndex}.packing_conversion`]: 0,
    [`table_so.${rowIndex}.packing_qty`]: 0,
    [`table_so.${rowIndex}.weight_conversion`]: 0,
    [`table_so.${rowIndex}.net_weight`]: 0,
  });
};
console.log("item_codechange");
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

  if (!uomConversion || !uomConversion.base_qty) {
    return baseQty;
  }

  return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
};

// Find the packing detail row for a UOM. An item may define several packing rows
// per uom_id, so when a packing UOM is supplied match on the (uom_id,
// packing_uom_id) pair, which is unique. Otherwise fall back to the first row.
const getPackingDetail = (table_packing_detail, uom, packingUom) => {
  if (!Array.isArray(table_packing_detail) || !uom) {
    return null;
  }

  const rows = table_packing_detail.filter((conv) => conv.uom_id === uom);
  if (rows.length === 0) {
    return null;
  }

  if (packingUom) {
    return rows.find((conv) => conv.packing_uom_id === packingUom) || null;
  }

  return rows[0];
};

// How many base UOM units make up 1 unit of the selected UOM.
const getBaseQty = (table_uom_conversion, uom) => {
  if (
    !Array.isArray(table_uom_conversion) ||
    table_uom_conversion.length === 0 ||
    !uom
  ) {
    return 1;
  }

  const uomConversion = table_uom_conversion.find(
    (conv) => conv.alt_uom_id === uom,
  );

  return uomConversion && uomConversion.base_qty ? uomConversion.base_qty : 1;
};

// Build the packing + net weight fields for a SO line. Mirrors SOonChangeUOM /
// SOonBlurQty so the values are correct even though setData does not trigger
// those handlers.
const buildPackingWeightData = (rowIndex, item, uom, soQuantity) => {
  const packingDetail = getPackingDetail(item.table_packing_detail, uom);
  const packingConversion = packingDetail?.quantity || 1;
  const packingUOM = packingDetail?.packing_uom_id || "";

  const baseQty = getBaseQty(item.table_uom_conversion, uom);
  const weightConversion =
    Math.round((Number(item.net_weight) || 0) * baseQty * 1000) / 1000;

  const qty = Number(soQuantity) || 0;
  const packingQty = packingConversion
    ? Math.round((qty / packingConversion) * 1000) / 1000
    : 0;
  const netWeight = Math.round(qty * weightConversion * 1000) / 1000;

  return {
    [`table_so.${rowIndex}.packing_uom`]: packingUOM,
    [`table_so.${rowIndex}.packing_conversion`]: packingConversion,
    [`table_so.${rowIndex}.packing_qty`]: packingQty,
    [`table_so.${rowIndex}.weight_conversion`]: weightConversion,
    [`table_so.${rowIndex}.net_weight`]: netWeight,
  };
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
  console.log(this);
  let rowIndex = arguments[0].rowIndex;
  console.log("change item ", arguments[0]);
  if (arguments[0].index) {
    rowIndex = arguments[0].index;
  }

  console.log("arguments[0]", arguments[0]);
  const soItem = arguments[0].soItem;
  const plantId = this.getValue("plant_name");
  const customerID = this.getValue("customer_name");

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = (this.getVarSystem("deptIds") || "").split(",")[0] || "";
  }

  if (arguments[0].fieldModel && !soItem) {
    await resetData(rowIndex);
    let defaultSalesDetail =
      arguments[0].fieldModel.item.table_uom_conversion.find(
        (uom) => uom.sales_default_uom === 1,
      );

    if (!defaultSalesDetail) {
      defaultSalesDetail =
        arguments[0].fieldModel.item.table_uom_conversion.find(
          (uom) => uom.alt_uom_id === arguments[0].fieldModel.item.based_uom,
        );
    }

    await this.runWorkflow(
      "2067818102244966401",
      {
        document_type: "SO",
        supp_cust_id: customerID,
        plant_id: plantId,
        item_data: [
          {
            item_id: arguments[0].value,
            line_index: rowIndex,
            uom_id: defaultSalesDetail.alt_uom_id,
          },
        ],
      },
      async (result) => {
        console.log("result", result);
        const updates = {};

        for (const item of result.data.data) {
          updates[`table_so.${item.line_index}.so_item_price`] =
            item.unit_price;
          updates[`table_so.${item.line_index}.so_item_uom`] = item.uom_id;
          updates[`table_so.${item.line_index}.so_tax_preference`] =
            item.tax_rate;
          updates[`table_so.${item.line_index}.so_tax_percentage`] =
            item.tax_percent;
          updates[`table_so.${item.line_index}.from_historical`] =
            item.from_historical;
          updates[`table_so.${item.line_index}.max_price`] = item.max_price;
          updates[`table_so.${item.line_index}.min_price`] = item.min_price;
          updates[`table_so.${item.line_index}.so_quantity`] = item.quantity;
          updates[`table_so.${item.line_index}.so_discount`] = item.discount;
          updates[`table_so.${item.line_index}.so_discount_uom`] =
            item.discount_uom;
          updates[`table_so.${item.line_index}.item_category_id`] =
            arguments[0].fieldModel.item.item_category;
          updates[`table_so.${item.line_index}.so_desc`] =
            arguments[0].fieldModel.item.material_desc;
          updates[`table_so.${item.line_index}.item_id`] =
            arguments[0].fieldModel.item.material_name;
          updates[`table_so.${item.line_index}.custom_fields`] =
            arguments[0].fieldModel.item.custom_fields;
        }
        await this.setData(updates);
        let Row = arguments[0];
        Row.row = this.getValue(`table_so.${rowIndex}`);

        await this.triggerEvent("SOCalculation", Row);
      },
      (error) => {
        console.log("error", error);
      },
    );
    const {
      material_desc,
      material_name,
      based_uom,
      table_uom_conversion,
      item_batch_management,
      serial_number_management,
      stock_control,
      item_category,
    } = arguments[0].fieldModel.item;

    this.disabled([`table_so.${rowIndex}.so_item_uom`], false);
    this.refreshFieldOptionData([
      `table_so.${rowIndex}.so_item_uom`,
      `table_so.${rowIndex}.so_tax_percentage`,
      `table_so.${rowIndex}.packing_uom`,
    ]);

    const initialQty = await fetchUnrestrictedQty(
      arguments[0].value,
      item_batch_management,
      serial_number_management,
      stock_control,
      plantId,
      organizationId,
    );

    const finalQty = await convertBaseToAlt(
      initialQty,
      table_uom_conversion,
      defaultSalesDetail.alt_uom_id,
    );

    this.setData({
      [`table_so.${rowIndex}.unrestricted_qty`]: parseFloat(
        finalQty.toFixed(4),
      ),
      [`table_so.${rowIndex}.base_unrestricted_qty`]: parseFloat(
        initialQty.toFixed(4),
      ),
    });

    // setData above does not trigger SOonChangeUOM, so seed the packing + net
    // weight fields for the chosen UOM here (so_quantity was reset to 0).
    this.setData(
      buildPackingWeightData(
        rowIndex,
        arguments[0].fieldModel.item,
        defaultSalesDetail.alt_uom_id,
        0,
      ),
    );
  } else if (!arguments[0].fieldModel && soItem) {
    const rowIndex = arguments[0].index;
    if (soItem.item_name) {
      const resItem = await db
        .collection("Item")
        .where({ id: soItem.item_name })
        .get();

      if (resItem && resItem.data.length > 0) {
        const itemData = resItem.data[0];

        const initialQty = await fetchUnrestrictedQty(
          soItem.item_name,
          itemData.item_batch_management,
          itemData.serial_number_management,
          itemData.stock_control,
          plantId,
          organizationId,
        );

        if (soItem.so_item_uom) {
          const finalQty = await convertBaseToAlt(
            initialQty,
            itemData.table_uom_conversion,
            soItem.so_item_uom,
          );

          console.log("finalQty", finalQty);
          console.log("initialQty", initialQty);
          this.setData({
            [`table_so.${rowIndex}.unrestricted_qty`]: parseFloat(
              finalQty.toFixed(4),
            ),
            [`table_so.${rowIndex}.base_unrestricted_qty`]: parseFloat(
              initialQty.toFixed(4),
            ),
          });

          // Seed packing + net weight using the line's current so_quantity
          // (setData does not trigger SOonChangeUOM).
          const soQuantity =
            this.getValue(`table_so.${rowIndex}.so_quantity`) || 0;
          this.setData(
            buildPackingWeightData(
              rowIndex,
              itemData,
              soItem.so_item_uom,
              soQuantity,
            ),
          );
        }
      }
    }

    this.disabled([`table_so.${rowIndex}.so_item_uom`], false);
    this.refreshFieldOptionData([
      `table_so.${rowIndex}.so_item_uom`,
      `table_so.${rowIndex}.so_tax_percentage`,
      `table_so.${rowIndex}.packing_uom`,
    ]);
  } else if (!arguments[0].value) {
    await resetData(rowIndex);
    this.disabled([`table_so.${rowIndex}.so_item_uom`], true);
  } else {
    const tableSO = this.getValue("table_so");
    for (const [rowIndex, so] of tableSO.entries()) {
      if (so.so_item_uom) {
        this.disabled([`table_so.${rowIndex}.so_item_uom`], false);
        this.refreshFieldOptionData([
          `table_so.${rowIndex}.so_item_uom`,
          `table_so.${rowIndex}.so_tax_percentage`,
        ]);
      }
    }
  }
})();
