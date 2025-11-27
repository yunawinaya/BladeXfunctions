(async () => {
  try {
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    console.log("Organization ID:", organizationId);

    await this.setData({ organization_id: organizationId });

    const resPackingSetup = await db
      .collection("packing_setup")
      .where({ organization_id: organizationId })
      .get();

    if (!resPackingSetup || resPackingSetup.data.length === 0) {
      this.setData({
        packing_setup_id: "",
        packing_required: 0,
        auto_trigger_pkg: 1,
        packing_mode: "Basic",
        packing_location: 0,
        packing_dimension: 0,
      });
      return;
    }

    this.setData({
      packing_setup_id: resPackingSetup.data[0].id,
      packing_required: resPackingSetup.data[0].packing_required,
      auto_trigger_pkg: resPackingSetup.data[0].auto_trigger_pkg,
      packing_mode: resPackingSetup.data[0].packing_mode,
      packing_location: resPackingSetup.data[0].packing_location,
      packing_dimension: resPackingSetup.data[0].packing_dimension,
    });
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
