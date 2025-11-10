// Helper function to display status
const showStatusHTML = (status) => {
  if (status == 0) {
    this.display(["inactive_status"]);
  } else {
    this.display(["active_status"]);
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";

    // Determine page status
    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    // Set page status in data
    this.setData({ page_status: pageStatus });

    if (pageStatus !== "Add") {
      const binLocationId = this.getValue("id");

      try {
        const binLocationResponse = await db
          .collection("bin_location")
          .where({ id: binLocationId })
          .get();

        if (binLocationResponse.data && binLocationResponse.data.length > 0) {
          const binLocation = binLocationResponse.data[0];

          // Extract all fields
          const {
            bin_status,
            is_default,
            plant_id,
            storage_location_id,
            organization_id,
            bin_name,
            bin_label_tier_1,
            bin_label_tier_2,
            bin_label_tier_3,
            bin_label_tier_4,
            bin_label_tier_5,
            bin_code_tier_1,
            bin_code_tier_2,
            bin_code_tier_3,
            bin_code_tier_4,
            bin_code_tier_5,
            tier_1_active,
            tier_2_active,
            tier_3_active,
            tier_4_active,
            tier_5_active,
            bin_location_combine,
            bin_description,
            bin_qr_color,
            bin_qr_position,
            bin_tier_highlight,
          } = binLocation;

          // Set data for all modes
          const data = {
            bin_status,
            is_default,
            plant_id,
            organization_id,
            bin_name,
            storage_location_id,
            bin_label_tier_1,
            bin_label_tier_2,
            bin_label_tier_3,
            bin_label_tier_4,
            bin_label_tier_5,
            bin_code_tier_1,
            bin_code_tier_2,
            bin_code_tier_3,
            bin_code_tier_4,
            bin_code_tier_5,
            tier_1_active,
            tier_2_active,
            tier_3_active,
            tier_4_active,
            tier_5_active,
            bin_location_combine,
            bin_description,
            bin_qr_color,
            bin_qr_position,
            bin_tier_highlight,
          };

          await this.setData(data);

          // Show appropriate status UI
          showStatusHTML(data.bin_status);

          // Handle View mode: disable all fields
          if (pageStatus === "View") {
            this.disabled(
              [
                "bin_status",
                "is_default",
                "plant_id",
                "organization_id",
                "bin_name",
                "storage_location_id",
                "bin_label_tier_1",
                "bin_label_tier_2",
                "bin_label_tier_3",
                "bin_label_tier_4",
                "bin_label_tier_5",
                "bin_code_tier_1",
                "bin_code_tier_2",
                "bin_code_tier_3",
                "bin_code_tier_4",
                "bin_code_tier_5",
                "tier_1_active",
                "tier_2_active",
                "tier_3_active",
                "tier_4_active",
                "tier_5_active",
                "bin_location_combine",
                "bin_description",
                "bin_qr_color",
                "bin_qr_position",
                "bin_tier_highlight",
              ],
              true
            );

            this.hide(["button_cancel", "button_save"]);
          }
        } else {
          throw new Error(`Bin Location with ID ${binLocationId} not found`);
        }
      } catch (error) {
        console.error("Error fetching bin location:", error);
        this.$message.error(`Error loading bin location: ${error.message}`);
      }
    } else {
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      this.setData({
        bin_status: 0,
        organization_id: organizationId,
      });

      this.disabled(
        [
          "is_default",
          "bin_name",
          "storage_location_id",
          "bin_code_tier_1",
          "bin_description",
        ],
        true
      );
      showStatusHTML(0);
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
