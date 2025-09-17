(async () => {
  try {
    const unCompletedListID = "custom_sx3wmtii";
    const allListID = "custom_qnowgkx8";
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
      // Select all Sales Return ids with Draft status
      const salesReturnIds = selectedRecords
        .filter(
          (item) => item.sr_status === "Draft" || item.sr_status === "Cancelled"
        )
        .map((item) => item.id);
      console.log("salesReturnIds", salesReturnIds);
      if (salesReturnIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled sales return."
        );
        return;
      }
      const salesReturnNumbers = selectedRecords
        .filter(
          (item) => item.sr_status === "Draft" || item.sr_status === "Cancelled"
        )
        .map((item) => item.sales_return_no);

      await this.$confirm(
        `You've selected ${
          salesReturnNumbers.length
        } sales return(s) to delete. <br> <strong>Sales Return Numbers:</strong> <br>${salesReturnNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Sales Return Deletion",
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

      for (const id of salesReturnIds) {
        db.collection("sales_return")
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
