(async () => {
  try {
    const unCompletedListID = "custom_lwxe7tfp";
    const allListID = "custom_wfwjnk9q";
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
      // Select all Sales Invoice ids with Draft status
      const salesInvoiceIds = selectedRecords
        .filter(
          (item) => item.si_status === "Draft" || item.si_status === "Cancelled"
        )
        .map((item) => item.id);
      console.log("salesInvoiceIds", salesInvoiceIds);
      if (salesInvoiceIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled sales invoice."
        );
        return;
      }
      const salesInvoiceNumbers = selectedRecords
        .filter(
          (item) => item.si_status === "Draft" || item.si_status === "Cancelled"
        )
        .map((item) => item.sales_invoice_no);

      await this.$confirm(
        `You've selected ${
          salesInvoiceNumbers.length
        } sales invoice(s) to delete. <br> <strong>Sales Invoice Numbers:</strong> <br>${salesInvoiceNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Sales Invoice Deletion",
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

      for (const id of salesInvoiceIds) {
        db.collection("sales_invoice")
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
