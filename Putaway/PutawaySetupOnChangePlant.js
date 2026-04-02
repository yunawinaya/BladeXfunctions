(async () => {
  const plantID = this.getValue("plant_id");
  const resPutawaySetup = await db
    .collection("putaway_setup")
    .where({ plant_id: plantID })
    .get();
  if (!resPutawaySetup || resPutawaySetup.data.length === 0) {
    this.setData({
      putaway_setup_id: "",
      movement_type: "",
      putaway_required: 0,
      auto_trigger_to: 0,
      putaway_mode: "",
      default_strategy_id: "",
      fallback_strategy_id: "",
      auto_completed_gr: 0,
      is_loading_bay: 0,
      default_loading_bay: "",
      bin_validation_scope: "",
      require_bin_scan: 0,
      require_batch_scan: 0,
      require_item_scan: 0,
    });
    return;
  }

  this.disabled(
    ["default_strategy_id", "fallback_strategy_id", "bin_validation_scope"],
    resPutawaySetup.data[0].putaway_mode === "Manual",
  );

  this.setData({
    putaway_setup_id: resPutawaySetup.data[0].id,
    movement_type: resPutawaySetup.data[0].movement_type,
    putaway_required: resPutawaySetup.data[0].putaway_required,
    auto_trigger_to: resPutawaySetup.data[0].auto_trigger_to,
    putaway_mode: resPutawaySetup.data[0].putaway_mode,
    default_strategy_id: resPutawaySetup.data[0].default_strategy_id,
    fallback_strategy_id: resPutawaySetup.data[0].fallback_strategy_id,
    auto_completed_gr: resPutawaySetup.data[0].auto_completed_gr,
    is_loading_bay: resPutawaySetup.data[0].is_loading_bay,
    default_loading_bay: resPutawaySetup.data[0].default_loading_bay,
    bin_validation_scope: resPutawaySetup.data[0].bin_validation_scope,
    require_bin_scan: resPutawaySetup.data[0].require_bin_scan,
    require_batch_scan: resPutawaySetup.data[0].require_batch_scan,
    require_item_scan: resPutawaySetup.data[0].require_item_scan,
  });
})();
