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
  const currentItemArray = arguments[0].itemArray;
  const soLineItems = this.getValue("table_so");
  const plantId = this.getValue("plant_name");
  const customerID = this.getValue("customer_name");

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

    const soItem = {
      item_name: item.id,
      item_id: item.material_name,
      so_desc: item.material_desc,
      so_item_price: defaultSalesDetail.sales_unit_price || 0,
      item_category_id: item.item_category,
      so_tax_preference: defaultSalesDetail.mat_sales_tax_id || null,
      so_tax_percentage: defaultSalesDetail.sales_tax_percent || null,
      so_item_uom: defaultSalesDetail.alt_uom_id || null,
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
        `table_so.${newIndex}.packing_uom`,
      ]);

      if (item.mat_sales_tax_id) {
        this.disabled([`table_so.${newIndex}.so_tax_percentage`], false);
      }

      console.log("item", item);

      let defaultSalesDetail = item.table_uom_conversion.find(
        (uom) => uom.sales_default_uom === 1,
      );

      if (!defaultSalesDetail) {
        defaultSalesDetail = item.table_uom_conversion.find(
          (uom) => uom.alt_uom_id === item.based_uom,
        );
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
        [`table_so.${newIndex}.unrestricted_qty`]: parseFloat(
          finalQty.toFixed(4),
        ),
        [`table_so.${newIndex}.base_unrestricted_qty`]: parseFloat(
          initialQty.toFixed(4),
        ),
      });

      // setData above does not trigger SOonChangeUOM, so seed the packing + net
      // weight fields for the chosen UOM (new lines start at so_quantity 0).
      await this.setData(
        buildPackingWeightData(
          newIndex,
          item,
          defaultSalesDetail.alt_uom_id,
          0,
        ),
      );
    }

    await this.runWorkflow(
      "2067818102244966401",
      {
        document_type: "SO",
        supp_cust_id: customerID,
        plant_id: plantId,
        item_data: itemArray.map((item, index) => {
          return {
            item_id: item.item_name,
            unit_price: item.so_item_price,
            line_index: soLineItems.length + index,
            uom_id: item.so_item_uom,
            tax_rate: item.so_tax_preference || null,
            tax_percent: item.so_tax_percentage || null,
          };
        }),
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
        }

        await this.setData(updates);

        const tableSO = this.getValue("table_so");
        for (const [index, item] of tableSO.entries()) {
          let Row = {};
          Row.row = item;
          Row.rowIndex = index;

          await this.triggerEvent("SOCalculation", Row);
        }
      },
      (error) => {
        console.log("error", error);
      },
    );
  }, 50);
})();
