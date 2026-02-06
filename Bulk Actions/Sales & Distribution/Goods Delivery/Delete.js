(async () => {
  try {
    const allListID = "custom_ezwb0qqp";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      const goodsDeliveryIds = selectedRecords
        .filter((item) => item.gd_status === "Draft")
        .map((item) => item.id);

      if (goodsDeliveryIds.length === 0) {
        this.$message.error("Please select at least one draft goods delivery.");
        return;
      }

      const goodsDeliveryNumbers = selectedRecords
        .filter((item) => item.gd_status === "Draft")
        .map((item) => item.delivery_no);

      await this.$confirm(
        `You've selected ${
          goodsDeliveryNumbers.length
        } goods delivery(s) to delete. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
          ", ",
        )} <br>Do you want to proceed?`,
        "Goods Delivery Deletion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      for (const id of goodsDeliveryIds) {
        db.collection("goods_delivery")
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
