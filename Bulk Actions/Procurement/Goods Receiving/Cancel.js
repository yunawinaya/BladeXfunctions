// Bulk Cancel Created GRs - Reverses PO quantity reservations (server-side workflow)
const runGRCancelWorkflow = async (grId, grNo, poId) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2075037036529123329",
      {
        action: "cancel",
        gr_id: grId,
        gr_no: grNo,
        po_id: poId,
      },
      (res) => {
        console.log("Goods Receiving cancel workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to cancel Goods Receiving:", err);
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

    // Only Created goods receiving can be cancelled here.
    const createdGRs = selectedRecords.filter(
      (item) => item.gr_status === "Created",
    );

    if (createdGRs.length === 0) {
      this.$message.error("Please select at least one Created goods receiving.");
      return;
    }

    const grNumbers = createdGRs.map((item) => item.gr_no);

    await this.$confirm(
      `You've selected ${grNumbers.length} goods receiving(s) to cancel.<br><br>` +
        `<strong>Goods Receiving Numbers:</strong><br>` +
        `${grNumbers.join(", ")}<br><br>` +
        `This will reverse the PO quantity reservations. Do you want to proceed?`,
      "Cancel Created Goods Receiving",
      {
        confirmButtonText: "Yes, Cancel GRs",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Cancelling Goods Receiving...");

    const results = [];
    for (const grItem of createdGRs) {
      try {
        const workflowResult = await runGRCancelWorkflow(
          grItem.id,
          grItem.gr_no,
          grItem.po_id,
        );

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
              "Failed to cancel goods receiving",
          });
        }
      } catch (error) {
        results.push({
          gr_no: grItem.gr_no,
          success: false,
          error: error.message || "Failed to cancel goods receiving",
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
        `Successfully cancelled ${successCount} goods receiving(s).`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
