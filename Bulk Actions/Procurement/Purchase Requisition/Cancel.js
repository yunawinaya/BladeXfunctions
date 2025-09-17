(async () => {
  try {
    const unCompletedListID = "custom_6scpe4ng";
    const allListID = "custom_xa2fu9as";
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
      // Select all Purchase Requisition ids with Issued status
      const purchaseRequisitionIds = selectedRecords
        .filter((item) => item.preq_status === "Issued")
        .map((item) => item.id);
      console.log("purchaseRequisitionIds", purchaseRequisitionIds);
      if (purchaseRequisitionIds.length === 0) {
        this.$message.error(
          "Please select at least one issued purchase requisition."
        );
        return;
      }
      const purchaseRequisitionNumbers = selectedRecords
        .filter((item) => item.preq_status === "Issued")
        .map((item) => item.pr_no);

      await this.$confirm(
        `You've selected ${
          purchaseRequisitionNumbers.length
        } purchase requisition(s) to cancel. <br> <strong>Purchase Requisition Numbers:</strong> <br>${purchaseRequisitionNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Purchase Requisition Cancellation",
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

      for (const id of purchaseRequisitionIds) {
        db.collection("purchase_requisition")
          .doc(id)
          .update({
            preq_status: "Cancelled",
          })
          .then(() => this.refresh())
          .catch((error) => {
            console.error("Error in cancellation process:", error);
            alert("An error occurred during cancellation. Please try again.");
          });
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
