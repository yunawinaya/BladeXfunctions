const runSOCancelWorkflow = async (soId, soNo) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2074777638166659074",
      {
        action: "cancel",
        so_id: soId,
        so_no: soNo,
      },
      (res) => {
        console.log("Sales Order cancel workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to cancel Sales Order:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    const unCompletedListID = "custom_odzyd6oo";
    const allListID = "custom_ysv40u3j";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted",
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    const selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID,
    )?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.$message.error("Please select at least one record.");
      return;
    }

    const salesOrderData = selectedRecords.filter(
      (item) => item.so_status === "Issued",
    );

    if (salesOrderData.length === 0) {
      this.$message.error("Please select at least one issued sales order.");
      return;
    }

    const salesOrderNumbers = salesOrderData.map((item) => item.so_no);

    await this.$confirm(
      `You've selected ${
        salesOrderNumbers.length
      } sales order(s) to cancel. <br> <strong>Sales Order Numbers:</strong> <br>${salesOrderNumbers.join(
        ", ",
      )} <br><br>Any linked <strong>draft</strong> goods delivery / picking plan and draft sales invoice will be deleted. <br>Do you want to proceed?`,
      "Sales Order Cancellation",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Cancelling Sales Order...");

    const results = [];
    for (const soItem of salesOrderData) {
      try {
        const workflowResult = await runSOCancelWorkflow(
          soItem.id,
          soItem.so_no,
        );

        const resultCode = workflowResult?.data?.code;
        if (resultCode === "200" || resultCode === 200) {
          results.push({ so_no: soItem.so_no, success: true });
        } else {
          results.push({
            so_no: soItem.so_no,
            success: false,
            error:
              workflowResult?.data?.message ||
              workflowResult?.data?.msg ||
              "Failed to cancel sales order",
          });
        }
      } catch (error) {
        results.push({
          so_no: soItem.so_no,
          success: false,
          error: error.message || "Failed to cancel sales order",
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
        .map((r) => `${esc(r.so_no)}: ${esc(r.error)}`)
        .join("<br>");
      this.$message({
        type: "error",
        message: `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `All ${successCount} sales order(s) cancelled successfully.`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
