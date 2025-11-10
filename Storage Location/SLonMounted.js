// Helper function to display status
const showStatusHTML = (status) => {
  if (status == 0) {
    this.display(["inactive_status"]);
  } else {
    this.display(["active_status"]);
  }
};

const hideBinLocationTab = () => {
  setTimeout(() => {
    const tableBinLocation = this.getValue("table_bin_location");
    if (!tableBinLocation || tableBinLocation.length === 0) {
      const tabSelector =
        '.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-bin_location_list[tabindex="-1"][aria-selected="false"]';
      const tab = document.querySelector(tabSelector);

      if (tab) {
        tab.style.display = "none";
      } else {
        const fallbackTab = document.querySelector(
          '.el-drawer[role="dialog"] .el-tabs__item#tab-bin_location_list'
        );
        if (fallbackTab) {
          fallbackTab.style.display = "none";
        } else {
          console.log("Bin Location tab not found");
        }
      }

      const inactiveTabSelector =
        '.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-bin_location_list)';
      const inactiveTab = document.querySelector(inactiveTabSelector);
      if (inactiveTab) {
        inactiveTab.setAttribute("aria-disabled", "true");
        inactiveTab.classList.add("is-disabled");
      }
    } else {
      this.display(["table_bin_location"]);
    }
  }, 10); // Small delay to ensure DOM is ready
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
      const storageLocationId = this.getValue("id");

      try {
        const storageLocationResponse = await db
          .collection("storage_location")
          .where({ id: storageLocationId })
          .get();

        if (
          storageLocationResponse.data &&
          storageLocationResponse.data.length > 0
        ) {
          const storageLocation = storageLocationResponse.data[0];

          // Extract all fields
          const {
            storage_status,
            is_default,
            plant_id,
            organization_id,
            storage_location_name,
            storage_location_code,
            location_type,
            storage_description,
            storage_qr_color,
            storage_qr_position,
            storage_tier_highlight,
          } = storageLocation;

          // Set data for all modes
          const data = {
            storage_status,
            is_default,
            plant_id,
            organization_id,
            storage_location_name,
            storage_location_code,
            location_type,
            storage_description,
            storage_qr_color,
            storage_qr_position,
            storage_tier_highlight,
          };

          await this.setData(data);

          // Show appropriate status UI
          showStatusHTML(data.storage_status);

          hideBinLocationTab();

          this.disabled(
            [
              "storage_location_name",
              "storage_location_code",
              "storage_description",
            ],
            false
          );
          this.disabled(["plant_id"], true);

          // Handle View mode: disable all fields
          if (pageStatus === "View") {
            this.disabled(
              [
                "storage_status",
                "is_default",
                "plant_id",
                "organization_id",
                "storage_location_name",
                "storage_location_code",
                "location_type",
                "storage_description",
                "storage_qr_color",
                "storage_qr_position",
                "storage_tier_highlight",
              ],
              true
            );

            this.hide(["button_cancel", "button_save"]);

            hideBinLocationTab();
          }
        } else {
          throw new Error(
            `Storage Location with ID ${storageLocationId} not found`
          );
        }
      } catch (error) {
        console.error("Error fetching storage location:", error);
        this.$message.error(`Error loading storage location: ${error.message}`);
      }
    } else {
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      this.setData({
        storage_status: 0,
        organization_id: organizationId,
      });

      this.disabled(
        [
          "is_default",
          "storage_location_name",
          "storage_location_code",
          "location_type",
          "storage_description",
        ],
        true
      );
      showStatusHTML(0);

      hideBinLocationTab();
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
