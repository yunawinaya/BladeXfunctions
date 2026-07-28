// Bulk Cancel In Progress LOTs - Reverses PO quantity reservations
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

    const inProgressLOTs = selectedRecords.filter(
      (item) => item.stock_movement_status === "In Progress",
    );

    if (inProgressLOTs.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one In Progress location transfer.",
      );
      return;
    }

    const lotNumbers = inProgressLOTs.map((item) => item.stock_movement_no);

    // Declare counters
    let successCount = 0;
    let failCount = 0;
    const failedLOTs = [];

    await this.$confirm(
      `You've selected ${lotNumbers.length} location transfer(s) to cancel.<br><br>` +
        `<strong>Location Transfer Numbers:</strong><br>` +
        `${lotNumbers.join(", ")}<br><br>` +
        `Do you want to proceed?`,
      "Cancel In Progress Location Transfer",
      {
        confirmButtonText: "Yes, Cancel LOTs",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      this.hideLoading();
      console.log("User clicked Cancel");
      throw new Error();
    });

    for (const lot of inProgressLOTs) {
      try {
        let workflowResult;

        await this.runWorkflow(
          "2013133675374927874",
          {
            allData: lot,
            saveAs: "Cancelled",
            pageStatus: "Edit",
          },
          async (res) => {
            console.log("Location Transfer saved successfully:", res);
            workflowResult = res;
          },
          (err) => {
            console.error("Failed to cancel Location Transfer:", err);
            workflowResult = err;
          },
        );

        if (!workflowResult || !workflowResult.data) {
          failCount++;
          failedLOTs.push(lot.stock_movement_no);
          console.error(`No response from workflow for ${lot.stock_movement_no}`);
          continue;
        }

        // Handle workflow errors
        if (
          workflowResult.data.code === "400" ||
          workflowResult.data.code === 400 ||
          workflowResult.data.success === false
        ) {
          failCount++;
          failedLOTs.push(lot.stock_movement_no);
          const errorMessage =
            workflowResult.data.msg ||
            workflowResult.data.message ||
            "Failed to cancel Location Transfer";
          console.error(`Failed to cancel ${lot.stock_movement_no}: ${errorMessage}`);
          continue;
        }

        // Handle success
        if (
          workflowResult.data.code === "200" ||
          workflowResult.data.code === 200 ||
          workflowResult.data.success === true
        ) {
          successCount++;
          console.log(`Successfully cancelled LOT ${lot.stock_movement_no}`);
        } else {
          failCount++;
          failedLOTs.push(lot.stock_movement_no);
          console.error(`Unknown workflow status for ${lot.stock_movement_no}`);
        }
      } catch (error) {
        failCount++;
        failedLOTs.push(lot.stock_movement_no);
        console.error(`Failed to cancel ${lot.stock_movement_no}:`, error);
      }
    }

    this.hideLoading();
    this.refresh();

    if (failCount > 0) {
      this.$message.warning(
        `Cancelled ${successCount} LOT(s). Failed: ${failCount} (${failedLOTs.join(
          ", ",
        )})`,
      );
    } else {
      this.$message.success(
        `Successfully cancelled ${successCount} location transfer(s).`,
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
