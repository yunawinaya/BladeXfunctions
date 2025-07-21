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

    const mappedBomData = bomDataRes.subform_sub_material.map((item) => ({
      material_id: item.bom_material_code,
      material_name: item.sub_material_name,
      material_desc: item.sub_material_desc,
      material_category: item.sub_material_category,
      material_quantity: parseFloat(
        (
          (qtyToProduce / bomBaseQty) *
          item.sub_material_qty *
          (1 + item.sub_material_wastage / 100)
        ).toFixed(3)
      ),
      material_uom: item.sub_material_qty_uom,
      item_remarks: item.sub_material_remark,
    }));
    await this.setData({
      table_bom: mappedBomData,
    });

    const tableBOM = await this.getValue("table_bom");

    tableBOM.forEach(async (material, rowIndex) => {
      if (material.material_id) {
        const resItem = await db
          .collection("Item")
          .where({ id: material.material_id })
          .get();

        if (resItem && resItem.data.length > 0) {
          const itemData = resItem.data[0];

          const altUoms = itemData.table_uom_conversion.map(
            (data) => data.alt_uom_id
          );
          let uomOptions = [];
          await altUoms.push(itemData.based_uom);

          const res = await fetchUomData(altUoms);
          uomOptions.push(...res);
          console.log("rowIndex", rowIndex);
          await this.setOptionData(
            [`table_bom.${rowIndex}.material_uom`],
            uomOptions
          );
        }
      }
    });
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
