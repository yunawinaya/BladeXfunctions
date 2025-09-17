(async () => {
  try {
    const unCompletedListID = "custom_kviatmto";
    const allListID = "custom_851imkgn";
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
      // Select all quotation ids with Issued status
      const quotationIds = selectedRecords
        .filter((item) => item.sqt_status === "Issued")
        .map((item) => item.id);
      console.log("quotationIds", quotationIds);

      if (quotationIds.length === 0) {
        this.$message.error("Please select at least one issued quotation.");
        return;
      }

      const quotationNumbers = selectedRecords
        .filter((item) => item.sqt_status === "Issued")
        .map((item) => item.sqt_no);

      await this.$confirm(
        `You've selected ${
          quotationNumbers.length
        } quotation(s) to cancel. <br> <strong>Quotation Numbers:</strong> <br>${quotationNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Quotation Cancellation",
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

      for (const id of quotationIds) {
        db.collection("Quotation")
          .doc(id)
          .update({
            sqt_status: "Cancelled",
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
