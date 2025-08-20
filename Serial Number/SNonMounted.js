(async () => {
  try {
    console.log("🚀 Starting serial config load...");
    this.showLoading();

    console.log("📡 Fetching serial level config from database...");
    const resSerialConfig = await db.collection("serial_level_config").get();
    console.log("✅ Database response:", resSerialConfig);

    if (resSerialConfig && resSerialConfig.data.length > 0) {
      console.log(
        "📊 Found config data:",
        resSerialConfig.data.length,
        "records"
      );
      let serialConfigData = await resSerialConfig.data;
      console.log("🔍 Serial config data:", serialConfigData);

      const hasTenant000000 =
        !serialConfigData.length ||
        serialConfigData.every((item) => item.tenant_id === "000000");
      console.log("🏢 Has tenant 000000:", hasTenant000000);

      if (hasTenant000000) {
        serialConfigData = await serialConfigData.filter(
          (data) => data.tenant_id === "000000"
        );
        console.log("🎯 Filtered data for tenant 000000:", serialConfigData);
      }

      if (!serialConfigData.length) {
        console.error("❌ No data found after filtering");
        this.hideLoading();
        return;
      }

      const serialLevel = serialConfigData[0].serial_level_selection;
      console.log("🎚️ Serial level:", serialLevel);

      switch (serialLevel) {
        case "Serial level at tenant level":
        case "Serial Number level at tenant level":
          console.log("🏢 Processing tenant level config...");
          this.setData({
            serial_level_selection: serialLevel,
            serial_prefix: serialConfigData[0].serial_prefix,
            serial_running_number: serialConfigData[0].serial_running_number,
            serial_padding_zeroes: serialConfigData[0].serial_padding_zeroes,
          });
          this.disabled(
            [
              "serial_level_selection",
              "serial_prefix",
              "serial_running_number",
              "serial_padding_zeroes",
            ],
            true
          );
          console.log("✅ Tenant level setup complete");
          this.hideLoading();
          break;

        case "Serial level at organization level":
        case "Serial Number level at organization level":
          console.log("🏛️ Processing organization level config...");
          let organizationId = this.getVarGlobal("deptParentId");
          console.log("📋 Initial organization ID:", organizationId);

          if (organizationId === "0") {
            const deptIds = this.getVarSystem("deptIds");
            console.log("🔗 Department IDs from system:", deptIds);
            organizationId = deptIds ? deptIds.split(",")[0] : null;
            console.log("📋 Updated organization ID:", organizationId);
          }

          if (!organizationId) {
            console.error("❌ No valid organization ID found");
            this.hideLoading();
            return;
          }

          console.log("🔍 Filtering config for organization:", organizationId);
          const currentOrgSerialConfig = await serialConfigData.filter(
            (data) => data.organization_id === organizationId
          );
          console.log("🎯 Org-specific config:", currentOrgSerialConfig);

          if (currentOrgSerialConfig && currentOrgSerialConfig.length > 0) {
            console.log("✅ Found existing org config");
            this.setData({
              serial_level_selection: serialLevel,
              serial_prefix: currentOrgSerialConfig[0].serial_prefix,
              serial_running_number:
                currentOrgSerialConfig[0].serial_running_number,
              serial_padding_zeroes:
                currentOrgSerialConfig[0].serial_padding_zeroes,
            });
            this.disabled(
              [
                "serial_level_selection",
                "serial_prefix",
                "serial_running_number",
                "serial_padding_zeroes",
              ],
              true
            );
          } else {
            console.log("⚠️ No existing org config, creating new");
            this.disabled(["serial_level_selection"], false);
            this.setData({ organization_id: organizationId });
            this.display(["button_save", "button_cancel"]);
          }
          console.log("✅ Organization level setup complete");
          this.hideLoading();
          break;

        case "Serial level at plant level":
        case "Serial Number level at plant level":
          console.log("🏭 Processing plant level config...");
          this.display("plant_id");
          console.log("✅ Plant level setup complete");
          this.hideLoading();
          break;

        case "Serial level at material level":
        case "Serial Number level at material level":
          console.log("📦 Processing material level config...");
          // Missing hideLoading() here - potential cause of stuck loading!
          console.log("⚠️ Material level case is empty - adding hideLoading()");
          this.hideLoading();
          break;

        default:
          console.warn("⚠️ Unknown serial level:", serialLevel);
          this.hideLoading();
          break;
      }
    } else {
      console.log("📭 No serial config data found, setting up defaults...");
      this.disabled(["serial_level_selection"], false);
      this.display(["button_save", "button_cancel"]);
      console.log("✅ Default setup complete");
      this.hideLoading();
    }

    console.log("🏁 Serial config load completed successfully");
  } catch (error) {
    console.error("💥 Error in serial config load:", error);
    console.error("Stack trace:", error.stack);

    // Always hide loading on error
    try {
      this.hideLoading();
    } catch (hideError) {
      console.error("💥 Error hiding loading indicator:", hideError);
    }

    // Optionally show error message to user
    // this.showError('Failed to load serial configuration. Please try again.');
  }
})();
