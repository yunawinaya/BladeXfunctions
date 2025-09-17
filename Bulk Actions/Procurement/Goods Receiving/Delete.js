(async () => {
  try {
    const allListID = "custom_fnns00ze";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    if (selectedRecords && selectedRecords.length > 0) {
      const goodsReceivingIds = selectedRecords
        .filter(
          (item) => item.gr_status === "Draft" || item.gr_status === "Cancelled"
        )
        .map((item) => item.id);

      if (goodsReceivingIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled goods receiving."
        );
        return;
      }

      const goodsReceivingNumbers = selectedRecords
        .filter(
          (item) => item.gr_status === "Draft" || item.gr_status === "Cancelled"
        )
        .map((item) => item.gr_no);

      await this.$confirm(
        `You've selected ${
          goodsReceivingNumbers.length
        } goods receiving(s) to delete. <br> <strong>Goods Receiving Numbers:</strong> <br>${goodsReceivingNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Goods Receiving Deletion",
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

      for (const id of goodsReceivingIds) {
        db.collection("goods_receiving")
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
