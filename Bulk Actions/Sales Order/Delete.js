(async () => {
  try {
    const unCompletedListID = "custom_odzyd6oo";
    const allListID = "custom_ysv40u3j";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted"
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      // Select all sales order ids with Draft or Cancelled status
      const salesOrderIds = selectedRecords
        .filter(
          (item) => item.so_status === "Draft" || item.so_status === "Cancelled"
        )
        .map((item) => item.id);
      console.log("salesOrderIds", salesOrderIds);
      if (salesOrderIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled sales order."
        );
        return;
      }
      const salesOrderNumbers = selectedRecords
        .filter(
          (item) => item.so_status === "Draft" || item.so_status === "Cancelled"
        )
        .map((item) => item.so_no);

      await this.$confirm(
        `You've selected ${
          salesOrderNumbers.length
        } sales order(s) to delete. <br> <strong>Sales Order Numbers:</strong> <br>${salesOrderNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Sales Order Deletion",
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

      for (const id of salesOrderIds) {
        db.collection("sales_order")
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
