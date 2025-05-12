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
    else throw new Error("Invalid page state");

    // Set page status in data for reference
    this.setData({ page_status: pageStatus });

    console.log("Page status:", pageStatus);

    if (pageStatus !== "Add") {
      try {
        // Get process ID - try getValue first, then fall back to getParamsVariables
        const processId = this.getValue("id");

        if (!processId) {
          throw new Error("Process ID not found");
        }

        // Fetch process data
        const processResponse = await db
          .collection("process")
          .where({ id: processId })
          .get();

        if (!processResponse.data || processResponse.data.length === 0) {
          throw new Error(`Process with ID ${processId} not found`);
        }

        const processData = processResponse.data[0];
        console.log("Process data retrieved:", processData);

        // Extract all necessary fields
        const {
          process_no,
          process_name,
          is_active,
          process_category,
          remark,
          work_center,
          plant_id,
        } = processData;

        // Set data for all modes
        await this.setData({
          process_no,
          process_name,
          is_active,
          process_category,
          remark,
          work_center,
          plant_id,
        });

        // Show appropriate status UI
        showStatusHTML(is_active);

        // Handle View mode
        if (pageStatus === "View") {
          this.disabled(
            [
              "process_no",
              "process_name",
              "is_active",
              "process_category",
              "remark",
              "work_center",
              "plant_id",
            ],
            true
          );

          this.hide(["button_save", "button_cancel"], true);
        }
      } catch (error) {
        console.error("Error loading process data:", error);
        this.$message.error(`Failed to load process data: ${error.message}`);
      }
    } else {
      this.setData({ is_active: 0 });
      showStatusHTML(0);
    }
  } catch (error) {
    console.error("Error in process mounted function:", error);
    this.$message.error("An error occurred while initializing the form");
  }
})();
