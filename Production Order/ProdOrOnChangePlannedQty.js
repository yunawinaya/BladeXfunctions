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
    const mappedBomData = await Promise.all(bomDataRes.subform_sub_material.map(async (item) => {
      const wastage = parseFloat(item.sub_material_wastage) || 0;

      let materialQuantity = parseFloat(
        (
          (qtyToProduce / bomBaseQty) *
          item.sub_material_qty *
          (1 + wastage / 100)
        ).toFixed(3)
      );

      // Check if item is serialized and round up if needed
      try {
        const resItem = await db
          .collection("Item")
          .where({
            id: item.bom_material_code,
            serial_number_management: 1,
          })
          .get();

        if (resItem.data && resItem.data[0]) {
          materialQuantity = Math.ceil(materialQuantity);
        }
      } catch (error) {
        console.warn(
          `Error checking serialization for item ${item.bom_material_code}:`,
          error
        );
      }

      return {
        material_id: item.bom_material_code,
        material_name: item.sub_material_name,
        material_desc: item.sub_material_desc,
        material_category: item.sub_material_category,
        material_quantity: materialQuantity,
        material_uom: item.sub_material_qty_uom,
        item_remarks: item.sub_material_remark,
      };
    }));
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
    const mappedProcessRouteData = await Promise.all(
      processRouteDataRes.mat_consumption_table.map(async (item) => {
        // Handle missing or invalid wastage values
        const wastage = parseFloat(item.wastage) || 0;

        let materialQuantity = parseFloat(
          (
            (qtyToProduce / processRouteBaseQty) *
            item.quantity *
            (1 + wastage / 100)
          ).toFixed(3)
        );

        // Check if item is serialized and round up if needed
        try {
          const resItem = await db
            .collection("Item")
            .where({
              id: item.bom_material_code,
              serial_number_management: 1,
            })
            .get();

          if (resItem.data && resItem.data[0]) {
            materialQuantity = Math.ceil(materialQuantity);
          }
        } catch (error) {
          console.warn(
            `Error checking serialization for item ${item.bom_material_code}:`,
            error
          );
        }

        return {
          material_id: item.bom_material_code,
          material_name: item.bom_material_name,
          material_desc: item.bom_material_desc,
          material_category: item.bom_material_category,
          material_quantity: materialQuantity,
          material_uom: item.base_uom,
        };
      })
    );
    await this.setData({
      table_bom: mappedProcessRouteData,
    });
  }
})();
