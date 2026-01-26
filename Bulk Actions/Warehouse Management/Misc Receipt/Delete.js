(async () => {
  try {
    this.showLoading();

    const listID = "misc_receipt";
    let selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const deleteMSRs = selectedRecords.filter(
      (item) =>
        item.stock_movement_status === "Cancelled" ||
        item.stock_movement_status === "Draft",
    );

    if (deleteMSRs.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one Draft Miscellaneous Receipt.",
      );
      return;
    }

    const msrNumbers = deleteMSRs.map((item) => item.stock_movement_no);

    // Declare counters
    let successCount = 0;
    let failCount = 0;
    const failedMSRs = [];

    await this.$confirm(
      `You've selected ${msrNumbers.length} Miscellaneous Receipt(s) to delete.<br><br>` +
        `<strong>Miscellaneous Receipt Numbers:</strong><br>` +
        `${msrNumbers.join(", ")}<br><br>` +
        `Do you want to proceed?`,
      "Delete Miscellaneous Receipt",
      {
        confirmButtonText: "Yes, Delete MSR(s)",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      this.hideLoading();
      console.log("User cancelled delete operation");
      throw new Error();
    });

    for (const msr of deleteMSRs) {
      try {
        await db.collection("sm_misc_receipt").doc(msr.id).update({
          is_deleted: 1,
        });
        successCount++;
      } catch (error) {
        failCount++;
        failedMSRs.push(msr.stock_movement_no);
        console.error(`Failed to delete ${msr.stock_movement_no}:`, error);
      }
    }

    this.hideLoading();
    this.refresh();

    if (failCount > 0) {
      this.$message.warning(
        `Deleted ${successCount} MSR(s). Failed: ${failCount} (${failedLOTs.join(
          ", ",
        )})`,
      );
    } else {
      this.$message.success(
        `Successfully deleted ${successCount} Miscellaneous Receipt(s).`,
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
