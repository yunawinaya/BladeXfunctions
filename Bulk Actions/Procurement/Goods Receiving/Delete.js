const runGRDeleteWorkflow = async (grId) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2075037036529123329",
      {
        action: "delete",
        gr_id: grId,
      },
      (res) => {
        console.log("Goods Receiving delete workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to delete Goods Receiving:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    const listID = "custom_fnns00ze";

    const selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.$message.error("Please select at least one record.");
      return;
    }

    // Only Draft or Cancelled goods receiving can be deleted.
    const goodsReceivingData = selectedRecords.filter(
      (item) => item.gr_status === "Draft" || item.gr_status === "Cancelled",
    );

    if (goodsReceivingData.length === 0) {
      this.$message.error(
        "Please select at least one draft or cancelled goods receiving.",
      );
      return;
    }

    const goodsReceivingNumbers = goodsReceivingData.map((item) => item.gr_no);

    await this.$confirm(
      `You've selected ${
        goodsReceivingNumbers.length
      } goods receiving(s) to delete. <br> <strong>Goods Receiving Numbers:</strong> <br>${goodsReceivingNumbers.join(
        ", ",
      )} <br>Do you want to proceed?`,
      "Goods Receiving Deletion",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Deleting Goods Receiving...");

    const results = [];
    for (const grItem of goodsReceivingData) {
      try {
        const workflowResult = await runGRDeleteWorkflow(grItem.id);

        const resultCode = workflowResult?.data?.code;
        if (resultCode === "200" || resultCode === 200) {
          results.push({ gr_no: grItem.gr_no, success: true });
        } else {
          results.push({
            gr_no: grItem.gr_no,
            success: false,
            error:
              workflowResult?.data?.message ||
              workflowResult?.data?.msg ||
              "Failed to delete goods receiving",
          });
        }
      } catch (error) {
        results.push({
          gr_no: grItem.gr_no,
          success: false,
          error: error.message || "Failed to delete goods receiving",
        });
      }
    }

    this.hideLoading();

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    if (failCount > 0) {
      // Escape interpolated values; only the literal <br> stays as HTML.
      const esc = (s) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      const failedItems = results
        .filter((r) => !r.success)
        .map((r) => `${esc(r.gr_no)}: ${esc(r.error)}`)
        .join("<br>");
      this.$message({
        type: "error",
        message: `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `All ${successCount} goods receiving(s) deleted successfully.`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
