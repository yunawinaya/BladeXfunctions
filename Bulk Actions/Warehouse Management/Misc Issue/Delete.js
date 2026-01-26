(async () => {
  try {
    this.showLoading();

    const listID = "misc_issue";
    let selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const deleteMSIs = selectedRecords.filter(
      (item) =>
        item.stock_movement_status === "Cancelled" ||
        item.stock_movement_status === "Draft",
    );

    if (deleteMSIs.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one Draft Miscellaneous Issue.",
      );
      return;
    }

    const msiNumbers = deleteMSIs.map((item) => item.stock_movement_no);

    // Declare counters
    let successCount = 0;
    let failCount = 0;
    const failedMSIs = [];

    await this.$confirm(
      `You've selected ${msiNumbers.length} Miscellaneous Issue(s) to delete.<br><br>` +
        `<strong>Miscellaneous Issue Numbers:</strong><br>` +
        `${msiNumbers.join(", ")}<br><br>` +
        `Do you want to proceed?`,
      "Delete Miscellaneous Issue",
      {
        confirmButtonText: "Yes, Delete MSI(s)",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      this.hideLoading();
      console.log("User cancelled delete operation");
      throw new Error();
    });

    for (const msi of deleteMSIs) {
      try {
        await db.collection("sm_misc_issue").doc(msi.id).update({
          is_deleted: 1,
        });
        successCount++;
      } catch (error) {
        failCount++;
        failedMSIs.push(msi.stock_movement_no);
        console.error(`Failed to delete ${msi.stock_movement_no}:`, error);
      }
    }

    this.hideLoading();
    this.refresh();

    if (failCount > 0) {
      this.$message.warning(
        `Deleted ${successCount} MSI(s). Failed: ${failCount} (${failedMSIs.join(
          ", ",
        )})`,
      );
    } else {
      this.$message.success(
        `Successfully deleted ${successCount} Miscellaneous Issue(s).`,
      );
    }
  } catch (error) {
    this.hideLoading();
    if (error.message) {
      this.$message.error(error.message);
    }
    console.error("Error in bulk delete process:", error);
  }
})();
