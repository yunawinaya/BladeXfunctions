const newValue = arguments[0].value;
const pageStatus = this.getValue("page_status");
const processRouteId = this.getValue("id");

// Function to map material data to the desired format
const mapMaterialData = (items) =>
  items.map((item) => ({
    bom_material_code: item.bom_material_code || item.sub_material_code || "",
    bom_material_name: item.bom_material_name || item.sub_material_name || "",
    bom_material_desc: item.bom_material_desc || item.sub_material_desc || "",
    bom_material_category:
      item.bom_material_category || item.sub_material_category || "",
    bin_location: item.bin_location || "",
    quantity: item.quantity || item.sub_material_qty || "",
    wastage: item.wastage || item.sub_material_wastage || "",
    base_uom: item.base_uom || item.sub_material_qty_uom || "",
  }));

// Function to fetch and set BOM data
const fetchAndSetBomData = async (id) => {
  try {
    const re = await db.collection("bill_of_materials").where({ id }).get();
    console.log("re", re);
    const mappedData = mapMaterialData(re.data[0].subform_sub_material);
    this.setData({
      mat_consumption_table: mappedData,
      bom_base_qty: re.data[0].parent_mat_base_quantity,
    });
  } catch (error) {
    console.error("Error fetching BOM data:", error);
  }
};

if ((pageStatus === "Edit" || pageStatus === "View") && processRouteId) {
  const response = await db
    .collection("process_route")
    .where({ id: processRouteId })
    .get();
  const processRouteData = response.data?.[0];

  if (!processRouteData) {
    throw new Error("Production order not found");
  }

  const processRoutBomVersion = processRouteData.bom_version;
  const mappedData = mapMaterialData(processRouteData.mat_consumption_table);
  this.setData({ mat_consumption_table: mappedData });

  if (newValue && newValue !== processRoutBomVersion) {
    this.setData({ mat_consumption_table: [] });
    await fetchAndSetBomData(newValue);
  } else if (!arguments[0].value) {
    this.setData({ mat_consumption_table: [] });
  }
} else {
  await fetchAndSetBomData(newValue);

  if (!arguments[0].value) {
    this.setData({ mat_consumption_table: [] });
  }
}
