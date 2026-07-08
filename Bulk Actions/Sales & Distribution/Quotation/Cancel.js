const runSQTCancelWorkflow = async (quotationId) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2074786136787058689",
      {
        action: "cancel",
        quotation_id: quotationId,
      },
      (res) => {
        console.log("Quotation cancel workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to cancel Quotation:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    const unCompletedListID = "custom_kviatmto";
    const allListID = "custom_851imkgn";
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

    const quotationData = selectedRecords.filter(
      (item) => item.sqt_status === "Issued",
    );

    if (quotationData.length === 0) {
      this.$message.error("Please select at least one issued quotation.");
      return;
    }

    const quotationNumbers = quotationData.map((item) => item.sqt_no);

    await this.$confirm(
      `You've selected ${
        quotationNumbers.length
      } quotation(s) to cancel. <br> <strong>Quotation Numbers:</strong> <br>${quotationNumbers.join(
        ", ",
      )} <br>Do you want to proceed?`,
      "Quotation Cancellation",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Cancelling Quotation...");

    const results = [];
    for (const sqtItem of quotationData) {
      try {
        const workflowResult = await runSQTCancelWorkflow(sqtItem.id);

        const resultCode = workflowResult?.data?.code;
        if (resultCode === "200" || resultCode === 200) {
          results.push({ sqt_no: sqtItem.sqt_no, success: true });
        } else {
          results.push({
            sqt_no: sqtItem.sqt_no,
            success: false,
            error:
              workflowResult?.data?.message ||
              workflowResult?.data?.msg ||
              "Failed to cancel quotation",
          });
        }
      } catch (error) {
        results.push({
          sqt_no: sqtItem.sqt_no,
          success: false,
          error: error.message || "Failed to cancel quotation",
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
        .map((r) => `${esc(r.sqt_no)}: ${esc(r.error)}`)
        .join("<br>");
      this.$message({
        type: "error",
        message: `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `All ${successCount} quotation(s) cancelled successfully.`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
