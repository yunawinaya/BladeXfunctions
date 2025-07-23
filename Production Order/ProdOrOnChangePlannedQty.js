(async () => {
  const bomVersion = this.getValue("bom_id") || "";
  const processRoute = this.getValue("process_route_no") || "";

  const plannedQty = arguments[0].value;
  if (bomVersion && bomVersion !== "") {
    const bomData = await db
      .collection("bill_of_materials")
      .where({ id: bomVersion })
      .get();
    const bomDataRes = bomData.data[0];
    const qtyToProduce = parseFloat(plannedQty.toFixed(3));
    const bomBaseQty = parseFloat(
      bomDataRes.parent_mat_base_quantity.toFixed(3)
    );
    const mappedBomData = bomDataRes.subform_sub_material.map((item) => {
      const wastage = parseFloat(item.sub_material_wastage) || 0;

      return {
        material_id: item.bom_material_code,
        material_name: item.sub_material_name,
        material_desc: item.sub_material_desc,
        material_category: item.sub_material_category,
        material_quantity: parseFloat(
          (
            (qtyToProduce / bomBaseQty) *
            item.sub_material_qty *
            (1 + wastage / 100)
          ).toFixed(3)
        ),
        material_uom: item.sub_material_qty_uom,
        item_remarks: item.sub_material_remark,
      };
    });
    await this.setData({
      table_bom: mappedBomData,
    });
  } else if (processRoute && processRoute !== "") {
    const processRouteData = await db
      .collection("process_route")
      .where({ id: processRoute })
      .get();
    const processRouteDataRes = processRouteData.data[0];
    const qtyToProduce = parseFloat(plannedQty.toFixed(3));
    const processRouteBaseQty = parseFloat(
      processRouteDataRes.bom_base_qty.toFixed(3)
    );
    const mappedProcessRouteData =
      processRouteDataRes.mat_consumption_table.map((item) => {
        // Handle missing or invalid wastage values
        const wastage = parseFloat(item.wastage) || 0;

        return {
          material_id: item.bom_material_code,
          material_name: item.bom_material_name,
          material_desc: item.bom_material_desc,
          material_category: item.bom_material_category,
          material_quantity: parseFloat(
            (
              (qtyToProduce / processRouteBaseQty) *
              item.quantity *
              (1 + wastage / 100)
            ).toFixed(3)
          ),
          material_uom: item.base_uom,
        };
      });
    await this.setData({
      table_bom: mappedProcessRouteData,
    });
  }
})();
