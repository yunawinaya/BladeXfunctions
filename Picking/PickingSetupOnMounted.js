(async () => {
  try {
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    console.log("Organization ID:", organizationId);

    await this.setData({ organization_id: organizationId });

    const resPickingSetup = await db
      .collection("picking_setup")
      .where({ organization_id: organizationId })
      .get();

    if (!resPickingSetup || resPickingSetup.data.length === 0) {
      this.setData({
        picking_setup_id: "",
        movement_type: "",
        picking_required: 0,
        picking_after: "",
        auto_trigger_to: 0,
        picking_mode: "",
        default_strategy_id: "",
        fallback_strategy_id: "",
        auto_completed_gd: 0,
        bin_validation_scope: "",
        require_bin_scan: 0,
        require_batch_scan: 0,
      });
      return;
    }

    this.setData({
      picking_setup_id: resPickingSetup.data[0].id,
      movement_type: resPickingSetup.data[0].movement_type,
      picking_required: resPickingSetup.data[0].picking_required,
      picking_after: resPickingSetup.data[0].picking_after,
      auto_trigger_to: resPickingSetup.data[0].auto_trigger_to,
      picking_mode: resPickingSetup.data[0].picking_mode,
      default_strategy_id: resPickingSetup.data[0].default_strategy_id,
      fallback_strategy_id: resPickingSetup.data[0].fallback_strategy_id,
      auto_completed_gd: resPickingSetup.data[0].auto_completed_gd,
      bin_validation_scope: resPickingSetup.data[0].bin_validation_scope,
      require_bin_scan: resPickingSetup.data[0].require_bin_scan,
      require_batch_scan: resPickingSetup.data[0].require_batch_scan,
    });
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
