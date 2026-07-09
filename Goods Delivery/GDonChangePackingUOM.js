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

// Resolve how many line-UOM units make up 1 packing UOM. The packing_uom select
// is backed by the Item's table_packing_detail sub-collection, so the selected
// option usually carries its own `quantity` — use it and skip the Item fetch.
const resolvePackingConversion = async (rowIndex, packingUom, fieldModel) => {
  const fromOption = Number(fieldModel?.quantity);
  if (Number.isFinite(fromOption) && fromOption > 0) {
    return fromOption;
  }

  const materialId = this.getValue(`table_gd.${rowIndex}.material_id`);
  const uom = this.getValue(`table_gd.${rowIndex}.good_delivery_uom_id`);
  if (!materialId || !uom) {
    return 1;
  }

  const resItem = await db.collection("Item").where({ id: materialId }).get();
  if (!resItem || resItem.data.length === 0) {
    return 1;
  }

  const packingDetail = getPackingDetail(
    resItem.data[0].table_packing_detail,
    uom,
    packingUom,
  );

  return packingDetail?.quantity || 1;
};

(async () => {
  try {
    const packingUom = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    console.log("GDonChangePackingUOM", arguments[0]);

    const gdQty = parseFloat(this.getValue(`table_gd.${rowIndex}.gd_qty`)) || 0;

    if (!packingUom) {
      this.setData({
        [`table_gd.${rowIndex}.packing_conversion`]: 1,
        [`table_gd.${rowIndex}.packing_qty`]: gdQty,
      });
      return;
    }

    // packing_conversion is cached on the line so GDgdQty can recompute
    // packing_qty on every quantity edit without re-fetching the Item. It must
    // be rewritten here or the next qty change reverts to the old packing basis.
    const packingConversion = await resolvePackingConversion(
      rowIndex,
      packingUom,
      arguments[0].fieldModel,
    );

    const packingQty = packingConversion
      ? Math.round((gdQty / packingConversion) * 1000) / 1000
      : 0;

    this.setData({
      [`table_gd.${rowIndex}.packing_conversion`]: packingConversion,
      [`table_gd.${rowIndex}.packing_qty`]: packingQty,
    });
  } catch (error) {
    console.error("Error in packing UOM change:", error);
  }
})();
