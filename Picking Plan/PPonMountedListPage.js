(async () => {
  try {
    const plantId = await this.getVarSystem("deptIds").split(",")[0];

    console.log(plantId, "plantId");

    const pickingSetupResponse = await db
      .collection("picking_setup")
      .where({
        plant_id: plantId,
        picking_required: 1,
      })
      .get();

    if (pickingSetupResponse.data.length > 0) {
      if (pickingSetupResponse.data[0].picking_after === "Goods Delivery") {
        this.display("custom_41s73hyl");
        this.hide("tabs_picking");
      } else if (pickingSetupResponse.data[0].picking_after === "Sales Order") {
        this.display("tabs_picking");
        this.hide("custom_41s73hyl");
      } else {
        this.display("tabs_picking");
        this.hide("custom_41s73hyl");
      }
    } else {
      this.display("tabs_picking");
      this.hide("custom_41s73hyl");
    }
  } catch (error) {
    console.error("Error in PPonMountedListPage:", error);
  }
})();
