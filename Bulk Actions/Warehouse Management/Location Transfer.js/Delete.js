// Bulk Delete Location Transfers - Deletes Draft or Cancelled LOTs
(async () => {
  try {
    this.showLoading();

    const listID = "location_transfer";
    let selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const deleteLOTs = selectedRecords.filter(
      (item) =>
        item.stock_movement_status === "Cancelled" ||
        item.stock_movement_status === "Draft",
    );

    if (deleteLOTs.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one Draft or Cancelled location transfer.",
      );
      return;
    }

    const lotNumbers = deleteLOTs.map((item) => item.stock_movement_no);

    // Declare counters
    let successCount = 0;
    let failCount = 0;
    const failedLOTs = [];

    await this.$confirm(
      `You've selected ${lotNumbers.length} location transfer(s) to delete.<br><br>` +
        `<strong>Location Transfer Numbers:</strong><br>` +
        `${lotNumbers.join(", ")}<br><br>` +
        `Do you want to proceed?`,
      "Delete Location Transfer",
      {
        confirmButtonText: "Yes, Delete LOTs",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      this.hideLoading();
      console.log("User cancelled delete operation");
      throw new Error();
    });

    for (const lot of deleteLOTs) {
      try {
        await db.collection("sm_location_transfer").doc(lot.id).update({
          is_deleted: 1,
        });
        successCount++;
      } catch (error) {
        failCount++;
        failedLOTs.push(lot.stock_movement_no);
        console.error(`Failed to delete ${lot.stock_movement_no}:`, error);
      }
    }

    this.hideLoading();
    this.refresh();

    if (failCount > 0) {
      this.$message.warning(
        `Deleted ${successCount} LOT(s). Failed: ${failCount} (${failedLOTs.join(
          ", ",
        )})`,
      );
    } else {
      this.$message.success(
        `Successfully deleted ${successCount} location transfer(s).`,
      );
    }
  } catch (error) {
    this.hideLoading();
    if (error.message) {
      this.$message.error(error.message);
    }
    console.error("Error in bulk cancel process:", error);
  }
})();
