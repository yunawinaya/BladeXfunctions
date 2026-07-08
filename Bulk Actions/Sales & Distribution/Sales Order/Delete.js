const runSODeleteWorkflow = async (soId) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2074777638166659074",
      {
        action: "delete",
        so_id: soId,
      },
      (res) => {
        console.log("Sales Order delete workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to delete Sales Order:", err);
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

    // Only Draft or Cancelled sales orders can be deleted.
    const salesOrderData = selectedRecords.filter(
      (item) => item.so_status === "Draft" || item.so_status === "Cancelled",
    );

    if (salesOrderData.length === 0) {
      this.$message.error(
        "Please select at least one draft or cancelled sales order.",
      );
      return;
    }

    const salesOrderNumbers = salesOrderData.map((item) => item.so_no);

    await this.$confirm(
      `You've selected ${
        salesOrderNumbers.length
      } sales order(s) to delete. <br> <strong>Sales Order Numbers:</strong> <br>${salesOrderNumbers.join(
        ", ",
      )} <br>Do you want to proceed?`,
      "Sales Order Deletion",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Deleting Sales Order...");

    const results = [];
    for (const soItem of salesOrderData) {
      try {
        const workflowResult = await runSODeleteWorkflow(soItem.id);

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
              "Failed to delete sales order",
          });
        }
      } catch (error) {
        results.push({
          so_no: soItem.so_no,
          success: false,
          error: error.message || "Failed to delete sales order",
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
        `All ${successCount} sales order(s) deleted successfully.`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
