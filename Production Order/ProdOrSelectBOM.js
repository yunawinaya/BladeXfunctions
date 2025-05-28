const bomId = arguments[0].value;
const allData = this.getValues();
const main = async () => {
  try {
    const bomData = await db
      .collection("bill_of_materials")
      .where({ id: bomId })
      .get();
    const bomDataRes = bomData.data[0];
    const mappedBomData = bomDataRes.subform_sub_material.map((item) => ({
      material_id: item.bom_material_code,
      material_name: item.sub_material_name,
      material_category: item.sub_material_category,
      material_quantity: item.sub_material_qty,
      material_uom: item.sub_material_qty_uom,
      item_remarks: item.sub_material_remark,
    }));
    this.setData({
      table_bom: mappedBomData,
    });
    console.log("bomData", bomData);
  } catch (error) {
    console.error("Error in main execution:", error);
    // Optionally show user-friendly error message
    self.showError?.("An error occurred while processing the production order");
  }
};
main();
