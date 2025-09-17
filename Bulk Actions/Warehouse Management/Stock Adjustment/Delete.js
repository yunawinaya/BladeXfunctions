(async () => {
  try {
    const unCompletedListID = "custom_z7cfnh6j";
    const allListID = "custom_y5ewf6w9";
    const tabUncompletedElement = document.getElementById("tab-tab_unposted");

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      const stockAdjustmentIds = selectedRecords
        .filter(
          (item) =>
            item.stock_adjustment_status.dict_key === "Draft" ||
            item.stock_adjustment_status.dict_key === "Cancelled"
        )
        .map((item) => item.id);

      if (stockAdjustmentIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled stock adjustment."
        );
        return;
      }

      const stockAdjustmentNumbers = selectedRecords
        .filter(
          (item) =>
            item.stock_adjustment_status.dict_key === "Draft" ||
            item.stock_adjustment_status.dict_key === "Cancelled"
        )
        .map((item) => item.adjustment_no);

      await this.$confirm(
        `You've selected ${
          stockAdjustmentNumbers.length
        } stock adjustment(s) to delete. <br> <strong>Stock Adjustment Numbers:</strong> <br>${stockAdjustmentNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Stock Adjustment Deletion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      for (const id of stockAdjustmentIds) {
        db.collection("stock_adjustment")
          .doc(id)
          .update({
            is_deleted: 1,
          })
          .then(() => this.refresh())
          .catch((error) => {
            console.error("Error in deletion process:", error);
            alert("An error occurred during deletion. Please try again.");
          });
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
