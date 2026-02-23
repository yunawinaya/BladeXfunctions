const runPickingWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2021065804251615233",
      {
        arrayData: data,
        saveAs: "Completed",
        pageStatus: "Edit",
        isForceComplete: 1,
      },
      (res) => {
        console.log("Picking workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to force complete Picking:", err);
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
      // Filter for In Progress pickings only
      const pickingData = selectedRecords.filter(
        (item) => item.to_status === "In Progress",
      );

      if (pickingData.length === 0) {
        this.$message.error("Please select at least one in progress picking.");
        this.hideLoading();
        return;
      }

      const pickingNumbers = pickingData.map((item) => item.to_id);

      await this.$confirm(
        `You've selected ${
          pickingNumbers.length
        } picking(s) to force complete. <br> <strong>Picking Numbers:</strong> <br>${pickingNumbers.join(
          ", ",
        )} <br><br><strong>Warning:</strong> Force completing will mark all remaining items as completed and reduce GD quantities to match picked quantities.<br><br>Do you want to proceed?`,
        "Picking Force Completion",
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

          // Handle credit limit warnings (402, 403) - still success, just couldn't auto-complete GD
          if (
            resultCode === "402" ||
            resultCode === 402 ||
            resultCode === "403" ||
            resultCode === 403
          ) {
            results.push({
              to_id: pickingItem.to_id,
              success: true,
              warning: "Credit Limit - GD not auto-completed",
            });
            continue;
          }

          // Handle packing not completed warning (407) - still success, just couldn't auto-complete GD
          if (resultCode === "407" || resultCode === 407) {
            results.push({
              to_id: pickingItem.to_id,
              success: true,
              warning: "Packing not completed - GD not auto-completed",
            });
            continue;
          }

          // Handle 400 - General error
          if (
            resultCode === "400" ||
            resultCode === 400 ||
            workflowResult.data.success === false
          ) {
            const errorMessage =
              workflowResult.data.msg ||
              workflowResult.data.message ||
              "Failed to force complete Picking";
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
            error: error.message || "Failed to force complete",
          });
        }
      }

      // Show summary
      const successCount = results.filter(
        (r) => r.success && !r.warning,
      ).length;
      const warningCount = results.filter((r) => r.success && r.warning).length;
      const failCount = results.filter((r) => !r.success).length;

      if (failCount > 0) {
        const failedItems = results
          .filter((r) => !r.success)
          .map((r) => `${r.to_id}: ${r.error}`)
          .join("<br>");
        this.$message.error(
          `${successCount} succeeded, ${warningCount} with warnings, ${failCount} failed:<br>${failedItems}`,
        );
      } else if (warningCount > 0) {
        const warningItems = results
          .filter((r) => r.warning)
          .map((r) => `${r.to_id}: ${r.warning}`)
          .join("<br>");
        this.$message.warning(
          `${successCount} succeeded, ${warningCount} with warnings:<br>${warningItems}`,
        );
      } else {
        this.$message.success(
          `All ${successCount} Picking(s) force completed successfully`,
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
