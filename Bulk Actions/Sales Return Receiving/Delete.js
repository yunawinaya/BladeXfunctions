(async () => {
  try {
    const allListID = "custom_eucb8qax";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      // Select all Sales Return ids with Draft status
      const salesReturnReceivingIds = selectedRecords
        .filter(
          (item) =>
            item.srr_status === "Draft" || item.srr_status === "Cancelled"
        )
        .map((item) => item.id);
      console.log("salesReturnReceivingIds", salesReturnReceivingIds);
      if (salesReturnReceivingIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled sales return receiving."
        );
        return;
      }
      const salesReturnReceivingNumbers = selectedRecords
        .filter(
          (item) =>
            item.srr_status === "Draft" || item.srr_status === "Cancelled"
        )
        .map((item) => item.srr_no);

      await this.$confirm(
        `You've selected ${
          salesReturnReceivingNumbers.length
        } sales return receiving(s) to delete. <br> <strong>Sales Return Receiving Numbers:</strong> <br>${salesReturnReceivingNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Sales Return Receiving Deletion",
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

      for (const id of salesReturnReceivingIds) {
        db.collection("sales_return_receiving")
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
