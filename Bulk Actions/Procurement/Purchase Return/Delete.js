(async () => {
  try {
    const allListID = "custom_d1fjv5r9";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    if (selectedRecords && selectedRecords.length > 0) {
      const purchaseReturnIds = selectedRecords
        .filter(
          (item) =>
            item.purchase_return_status === "Draft" ||
            item.purchase_return_status === "Cancelled"
        )
        .map((item) => item.id);

      if (purchaseReturnIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled purchase return."
        );
        return;
      }

      const purchaseReturnNumbers = selectedRecords
        .filter(
          (item) =>
            item.purchase_return_status === "Draft" ||
            item.purchase_return_status === "Cancelled"
        )
        .map((item) => item.purchase_return_no);

      await this.$confirm(
        `You've selected ${
          purchaseReturnNumbers.length
        } purchase return(s) to delete. <br> <strong>Purchase Return Numbers:</strong> <br>${purchaseReturnNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Purchase Return Deletion",
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

      for (const id of purchaseReturnIds) {
        db.collection("purchase_return_head")
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
