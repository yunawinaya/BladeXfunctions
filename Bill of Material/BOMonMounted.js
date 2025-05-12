// Helper functions
const showStatusHTML = (status) => {
  switch (status) {
    case 1:
      this.display(["active_status"]);
      break;
    case 0:
      this.display(["inactive_status"]);
      break;
    default:
      this.display(["inactive_status"]);
      break;
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";

    // Determine page status using multiple methods for compatibility
    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page status");

    // Set page status in data for reference
    this.setData({ page_status: pageStatus });

    if (pageStatus !== "Add") {
      try {
        const bomId = this.getValue("id");

        if (!bomId) {
          throw new Error("Bill of Materials ID not found");
        }

        // Fetch BOM data
        const bomResponse = await db
          .collection("bill_of_materials")
          .where({ id: bomId })
          .get();

        if (!bomResponse.data || bomResponse.data.length === 0) {
          throw new Error(`Bill of Materials with ID ${bomId} not found`);
        }

        const bomData = bomResponse.data[0];
        console.log("BOM data retrieved:", bomData);

        // Extract all necessary fields
        const {
          id,
          subform_sub_material,
          bom_remark,
          is_active,
          parent_mat_base_quantity,
          parent_mat_bom_version,
          parent_material_category,
          parent_mat_is_default,
          parent_material_code,
          parent_material_name,
        } = bomData;

        // Set data for all modes
        await this.setData({
          id,
          subform_sub_material,
          bom_remark,
          is_active,
          parent_mat_base_quantity,
          parent_mat_bom_version,
          parent_material_category,
          parent_mat_is_default,
          parent_material_code,
          parent_material_name,
        });

        // Show appropriate status UI
        showStatusHTML(is_active);

        // Always disable parent material code in Edit/View modes
        this.disabled(["parent_material_code"], true);

        // Handle View mode
        if (pageStatus === "View") {
          this.disabled(
            [
              "subform_sub_material",
              "subform_sub_material.sub_material_wastage",
              "bom_remark",
              "parent_mat_base_quantity",
              "parent_mat_bom_version",
              "parent_material_category",
              "parent_mat_is_default",
              "parent_material_code",
              "parent_material_name",
              "is_active",
            ],
            true
          );

          this.hide(["button_save", "button_cancel"], true);

          // Disable subform edit buttons if necessary
          this.$nextTick(() => {
            try {
              const addButtons = document.querySelectorAll(
                ".form-subform-action .el-button--primary"
              );
              if (addButtons && addButtons.length > 0) {
                addButtons.forEach((button) => {
                  button.style.display = "none";
                });
              }
            } catch (e) {
              console.error("Error hiding subform buttons:", e);
            }
          });
        }
      } catch (error) {
        console.error("Error loading BOM data:", error);
        this.$message.error(
          `Failed to load Bill of Materials data: ${error.message}`
        );
      }
    } else {
      this.setData({ is_active: 0 });
      showStatusHTML(0);
    }
  } catch (error) {
    console.error("Error in BOM mounted function:", error);
    this.$message.error("An error occurred while initializing the form");
  }
})();
