(async () => {
  const plant = arguments[0]?.value;
  const table_gr = this.getValue("table_gr");
  const po_numbers = this.getValue("purchase_order_id");

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  await this.setData({
    organization_id: organizationId,
  });

  // First, set the bin location for items
  if (plant && po_numbers && po_numbers.length > 0) {
    const resBinLocation = await db
      .collection("bin_location")
      .where({
        plant_id: plant,
        is_default: true,
      })
      .get();

    let binLocation;

    if (resBinLocation.data && resBinLocation.data.length > 0) {
      binLocation = resBinLocation.data[0].id;
    } else {
      console.warn("No default bin location found for plant:", plant);
    }

    if (table_gr && table_gr.length > 0) {
      for (let i = 0; i < table_gr.length; i++) {
        this.setData({
          [`table_gr.${i}.location_id`]: binLocation,
        });
      }
    }
  }
})();
