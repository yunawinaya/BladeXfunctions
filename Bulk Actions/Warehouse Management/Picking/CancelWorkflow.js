const runPickingWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2021065804251615233",
      {
        arrayData: data,
        saveAs: "Cancelled",
        pageStatus: "Edit",
      },
      (res) => {
        console.log("Picking workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to cancel Picking:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    this.showLoading();
    const allListID = "custom_41s73hyl";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      // Only Created pickings can be cancelled
      const pickingData = selectedRecords.filter(
        (item) => item.to_status === "Created",
      );

      if (pickingData.length === 0) {
        this.$message.error("Please select at least one created picking.");
        this.hideLoading();
        return;
      }

      const pickingNumbers = pickingData.map((item) => item.to_id);

      await this.$confirm(
        `You've selected ${
          pickingNumbers.length
        } picking(s) to cancel. <br> <strong>Picking Numbers:</strong> <br>${pickingNumbers.join(
          ", ",
        )} <br><br><strong>Warning:</strong> Cancelling will release the related Goods Delivery / Picking Plan back to picking and free the picking number for reuse.<br><br>Do you want to proceed?`,
        "Picking Cancellation",
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

      const results = [];

      for (const pickingItem of pickingData) {
        const id = pickingItem.id;

        const data = await db.collection("transfer_order").doc(id).get();

        if (!data.data || data.data.length === 0) {
          results.push({
            to_id: pickingItem.to_id,
            success: false,
            error: "Picking record not found",
          });
          continue;
        }

        try {
          const workflowResult = await runPickingWorkflow(data.data);

          if (!workflowResult || !workflowResult.data) {
            results.push({
              to_id: pickingItem.to_id,
              success: false,
              error: "No response from workflow",
            });
            continue;
          }

          const resultCode = workflowResult.data.code;

          // Handle 400 - General error
          if (
            resultCode === "400" ||
            resultCode === 400 ||
            workflowResult.data.success === false
          ) {
            const errorMessage =
              workflowResult.data.msg ||
              workflowResult.data.message ||
              "Failed to cancel Picking";
            results.push({
              to_id: pickingItem.to_id,
              success: false,
              error: errorMessage,
            });
            continue;
          }

          // Handle success
          if (
            resultCode === "200" ||
            resultCode === 200 ||
            workflowResult.data.success === true
          ) {
            results.push({
              to_id: pickingItem.to_id,
              success: true,
            });
          } else {
            results.push({
              to_id: pickingItem.to_id,
              success: false,
              error: "Unknown workflow status",
            });
          }
        } catch (error) {
          results.push({
            to_id: pickingItem.to_id,
            success: false,
            error: error.message || "Failed to cancel",
          });
        }
      }

      // Show summary
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (failCount > 0) {
        const failedItems = results
          .filter((r) => !r.success)
          .map((r) => `${r.to_id}: ${r.error}`)
          .join("<br>");
        this.$message.error(
          `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        );
      } else {
        this.$message.success(
          `All ${successCount} Picking(s) cancelled successfully`,
        );
      }

      this.hideLoading();
      this.refresh();
      this.hide("tabs_picking");
    } else {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
