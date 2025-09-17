(async () => {
  try {
    const unCompletedListID = "custom_zceupuuv";
    const allListID = "custom_su1b24n6";
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
      const purchaseInvoiceIds = selectedRecords
        .filter(
          (item) => item.pi_status === "Draft" || item.pi_status === "Cancelled"
        )
        .map((item) => item.id);

      if (purchaseInvoiceIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled purchase invoice."
        );
        return;
      }

      const purchaseInvoiceNumbers = selectedRecords
        .filter(
          (item) => item.pi_status === "Draft" || item.pi_status === "Cancelled"
        )
        .map((item) => item.purchase_invoice_no);

      await this.$confirm(
        `You've selected ${
          purchaseInvoiceNumbers.length
        } purchase invoice(s) to delete. <br> <strong>Purchase Invoice Numbers:</strong> <br>${purchaseInvoiceNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Purchase Invoice Deletion",
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

      for (const id of purchaseInvoiceIds) {
        db.collection("purchase_invoice")
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
