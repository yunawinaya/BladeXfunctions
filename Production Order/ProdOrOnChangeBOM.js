const bomId = arguments[0].value;
const allData = this.getValues();

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

const main = async () => {
  try {
    const bomData = await db
      .collection("bill_of_materials")
      .where({ id: bomId })
      .get();
    const bomDataRes = bomData.data[0];

    const qtyToProduce = parseFloat(allData.planned_qty.toFixed(3));
    const bomBaseQty = parseFloat(
      bomDataRes.parent_mat_base_quantity.toFixed(3)
    );

    const mappedBomData = await Promise.all(bomDataRes.subform_sub_material.map(async (item) => {
      let materialQuantity = parseFloat(
        (
          (qtyToProduce / bomBaseQty) *
          item.sub_material_qty *
          (1 + item.sub_material_wastage / 100)
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

    const tableBOM = await this.getValue("table_bom");

    // Process UOM options for each material sequentially to avoid race conditions
    for (const [rowIndex, material] of tableBOM.entries()) {
      if (material.material_id) {
        try {
          const resItem = await db
            .collection("Item")
            .where({ id: material.material_id })
            .get();

          if (resItem && resItem.data.length > 0) {
            const itemData = resItem.data[0];

            // Check if table_uom_conversion exists and is an array
            const uomConversions = itemData.table_uom_conversion || [];
            const altUoms = uomConversions.map((data) => data.alt_uom_id);
            
            // Add base UOM to the list
            altUoms.push(itemData.based_uom);

            const res = await fetchUomData(altUoms);
            console.log("rowIndex", rowIndex);
            await this.setOptionData(
              [`table_bom.${rowIndex}.material_uom`],
              res
            );
          }
        } catch (error) {
          console.warn(`Error setting UOM options for material ${material.material_id}:`, error);
        }
      }
    }
    console.log("bomData", bomData);
  } catch (error) {
    console.error("Error in main execution:", error);
    // Optionally show user-friendly error message
    self.showError?.("An error occurred while processing the production order");
  }
};

if (bomId) {
  main();
} else {
  this.setData({ table_bom: [] });
}
