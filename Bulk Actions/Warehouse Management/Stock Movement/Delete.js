(async () => {
  try {
    const unCompletedListID = "custom_gsf6m9ng";
    const allListID = "custom_5of0llto";
    const unPostedListID = "custom_ukujz0oi";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted"
    );
    const tabUnpostedEelement = document.getElementById("tab-tab_unposted");

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : tabUnpostedEelement?.classList.contains("is-active")
      ? "Unposted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted"
        ? unCompletedListID
        : activeTab === "Unposted"
        ? unPostedListID
        : allListID
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      const stockMovementIds = selectedRecords
        .filter(
          (item) =>
            item.stock_movement_status === "Draft" ||
            item.stock_movement_status === "Cancelled"
        )
        .map((item) => item.id);

      if (stockMovementIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled stock movement."
        );
        return;
      }

      const stockMovementNumbers = selectedRecords
        .filter(
          (item) =>
            item.stock_movement_status === "Draft" ||
            item.stock_movement_status === "Cancelled"
        )
        .map((item) => item.stock_movement_no);

      await this.$confirm(
        `You've selected ${
          stockMovementNumbers.length
        } stock movement(s) to delete. <br> <strong>Stock Movement Numbers:</strong> <br>${stockMovementNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Stock Movement Deletion",
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

      for (const id of stockMovementIds) {
        db.collection("stock_movement")
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
