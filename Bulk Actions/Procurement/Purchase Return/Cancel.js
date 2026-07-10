// Bulk Cancel Created Purchase Returns - releases the created_return_qty reserved
// on the GR and PO lines (server-side workflow). Zero client-side DB access.
// Replace PRT_CANCEL_WORKFLOW_ID with the runtime id assigned by the platform
// after importing PRTcancelWorkflow.json.
const PRT_CANCEL_WORKFLOW_ID = "2075396495149031426";

const runPRTCancelWorkflow = async (prtId) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      PRT_CANCEL_WORKFLOW_ID,
      {
        action: "cancel",
        prt_id: prtId,
      },
      (res) => {
        console.log("Purchase Return cancel workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to cancel Purchase Return:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    const listID = "custom_d1fjv5r9";

    const selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.$message.error("Please select at least one record.");
      return;
    }

    // Only Created purchase returns can be cancelled. A Completed one has already
    // moved stock; a Draft never reserved anything.
    const createdPRTs = selectedRecords.filter(
      (item) => item.purchase_return_status === "Created",
    );

    if (createdPRTs.length === 0) {
      this.$message.error(
        "Please select at least one created purchase return.",
      );
      return;
    }

    const prtNumbers = createdPRTs.map((item) => item.purchase_return_no);

    await this.$confirm(
      `You've selected ${prtNumbers.length} purchase return(s) to cancel.<br><br>` +
        `<strong>Purchase Return Numbers:</strong><br>` +
        `${prtNumbers.join(", ")}<br><br>` +
        `This will release the reserved return quantities on the linked goods receiving and purchase orders. Do you want to proceed?`,
      "Cancel Created Purchase Return",
      {
        confirmButtonText: "Yes, Cancel Purchase Returns",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Cancelling Purchase Return...");

    const results = [];
    for (const prtItem of createdPRTs) {
      try {
        const workflowResult = await runPRTCancelWorkflow(prtItem.id);

        const resultCode = workflowResult?.data?.code;
        if (resultCode === "200" || resultCode === 200) {
          results.push({ prt_no: prtItem.purchase_return_no, success: true });
        } else {
          results.push({
            prt_no: prtItem.purchase_return_no,
            success: false,
            error:
              workflowResult?.data?.message ||
              workflowResult?.data?.msg ||
              "Failed to cancel purchase return",
          });
        }
      } catch (error) {
        results.push({
          prt_no: prtItem.purchase_return_no,
          success: false,
          error: error.message || "Failed to cancel purchase return",
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
        .map((r) => `${esc(r.prt_no)}: ${esc(r.error)}`)
        .join("<br>");
      this.$message({
        type: "error",
        message: `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `Successfully cancelled ${successCount} purchase return(s).`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
