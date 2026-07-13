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
        is_loading_bay: 0,
        is_loading_bay: 0,
        allow_full_picking: 0,
        picking_mode: "",
        default_strategy_id: "",
        fallback_strategy_id: "",
        auto_completed_gd: 0,
        bin_validation_scope: "",
        require_bin_scan: 0,
        require_batch_scan: 0,
        require_item_scan: 0,
        require_hu_scan: 0,
        split_policy: "",
        full_cl_check: 0,
        convert_gd_created: 0,
      });
      return;
    }

    this.setData({
      picking_setup_id: resPickingSetup.data[0].id,
      movement_type: resPickingSetup.data[0].movement_type,
      picking_required: resPickingSetup.data[0].picking_required,
      picking_after: resPickingSetup.data[0].picking_after,
      auto_trigger_to: resPickingSetup.data[0].auto_trigger_to,
      is_loading_bay: resPickingSetup.data[0].is_loading_bay,
      allow_full_picking: resPickingSetup.data[0].allow_full_picking,
      picking_mode: resPickingSetup.data[0].picking_mode,
      default_strategy_id: resPickingSetup.data[0].default_strategy_id,
      fallback_strategy_id: resPickingSetup.data[0].fallback_strategy_id,
      auto_completed_gd: resPickingSetup.data[0].auto_completed_gd,
      bin_validation_scope: resPickingSetup.data[0].bin_validation_scope,
      require_bin_scan: resPickingSetup.data[0].require_bin_scan,
      require_batch_scan: resPickingSetup.data[0].require_batch_scan,
      require_item_scan: resPickingSetup.data[0].require_item_scan,
      require_hu_scan: resPickingSetup.data[0].require_hu_scan,
      split_policy: resPickingSetup.data[0].split_policy,
      full_cl_check: resPickingSetup.data[0].full_cl_check || 0,
      convert_gd_created: resPickingSetup.data[0].convert_gd_created || 0,
    });
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
