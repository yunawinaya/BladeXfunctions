(async () => {
  const putawayRequired = arguments[0].value;

  if (putawayRequired === 1) {
    this.disabled(
      [
        "auto_trigger_to",
        "auto_completed_gr",
        "putaway_mode",
        "is_loading_bay",
        "default_strategy_id",
        "organization_id",
        "bin_validation_scope",
        "require_batch_scan",
        "require_bin_scan",
        "require_item_scan",
      ],
      false,
    );

    this.setData({
      is_loading_bay: 1,
    });

    this.disabled(["is_loading_bay"], true);

    const putawayMode = this.getValue("putaway_mode");
    if (putawayMode === "Manual") {
      this.disabled(
        ["default_strategy_id", "bin_validation_scope", "fallback_strategy_id"],
        true,
      );
    } else if (putawayMode === "Auto") {
      this.disabled(["default_strategy_id", "bin_validation_scope"], false);

      const defaultStrategy = this.getValue("default_strategy_id");
      if (defaultStrategy && defaultStrategy !== null) {
        this.disabled(["fallback_strategy_id"], false);
      }
    }
  } else {
    this.disabled(
      [
        "auto_trigger_to",
        "auto_completed_gr",
        "is_loading_bay",
        "putaway_mode",
        "default_strategy_id",
        "organization_id",
        "bin_validation_scope",
        "require_batch_scan",
        "require_bin_scan",
        "require_item_scan",
      ],
      true,
    );

    this.setData({
      auto_trigger_to: 0,
      auto_completed_gr: 0,
      is_loading_bay: 0,
      require_batch_scan: 0,
      require_bin_scan: 0,
      require_item_scan: 0,
      default_loading_bay: "",
    });
  }
})();
