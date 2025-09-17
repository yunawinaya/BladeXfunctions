(async () => {
  try {
    const unCompletedListID = "custom_y9e0c53q";
    const allListID = "custom_6f0yz6lm";
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
      // Select all Purchase Order ids with Draft status
      const purchaseOrderIds = selectedRecords
        .filter(
          (item) => item.po_status === "Draft" || item.po_status === "Cancelled"
        )
        .map((item) => item.id);
      console.log("purchaseOrderIds", purchaseOrderIds);
      if (purchaseOrderIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled purchase order."
        );
        return;
      }
      const purchaseOrderNumbers = selectedRecords
        .filter(
          (item) => item.po_status === "Draft" || item.po_status === "Cancelled"
        )
        .map((item) => item.purchase_order_no);

      await this.$confirm(
        `You've selected ${
          purchaseOrderNumbers.length
        } purchase order(s) to delete. <br> <strong>Purchase Order Numbers:</strong> <br>${purchaseOrderNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Purchase Order Deletion",
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

      for (const id of purchaseOrderIds) {
        db.collection("purchase_order")
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
