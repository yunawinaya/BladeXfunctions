const runPOCancelWorkflow = async (poId, poNo, poPlantId) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2075034104886788098",
      {
        action: "cancel",
        po_id: poId,
        po_no: poNo,
        po_plant_id: poPlantId,
      },
      (res) => {
        console.log("Purchase Order cancel workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to cancel Purchase Order:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    const unCompletedListID = "custom_y9e0c53q";
    const allListID = "custom_6f0yz6lm";
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

    const purchaseOrderData = selectedRecords.filter(
      (item) => item.po_status === "Issued",
    );

    if (purchaseOrderData.length === 0) {
      this.$message.error("Please select at least one issued purchase order.");
      return;
    }

    const purchaseOrderNumbers = purchaseOrderData.map(
      (item) => item.purchase_order_no,
    );

    await this.$confirm(
      `You've selected ${
        purchaseOrderNumbers.length
      } purchase order(s) to cancel. <br> <strong>Purchase Order Numbers:</strong> <br>${purchaseOrderNumbers.join(
        ", ",
      )} <br><br>Any linked <strong>draft</strong> goods receiving and draft purchase invoice will be deleted. <br>Do you want to proceed?`,
      "Purchase Order Cancellation",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Cancelling Purchase Order...");

    const results = [];
    for (const poItem of purchaseOrderData) {
      try {
        const workflowResult = await runPOCancelWorkflow(
          poItem.id,
          poItem.purchase_order_no,
          poItem.po_plant?.id,
        );

        const resultCode = workflowResult?.data?.code;
        if (resultCode === "200" || resultCode === 200) {
          results.push({ po_no: poItem.purchase_order_no, success: true });
        } else {
          results.push({
            po_no: poItem.purchase_order_no,
            success: false,
            error:
              workflowResult?.data?.message ||
              workflowResult?.data?.msg ||
              "Failed to cancel purchase order",
          });
        }
      } catch (error) {
        results.push({
          po_no: poItem.purchase_order_no,
          success: false,
          error: error.message || "Failed to cancel purchase order",
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
        .map((r) => `${esc(r.po_no)}: ${esc(r.error)}`)
        .join("<br>");
      this.$message({
        type: "error",
        message: `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `All ${successCount} purchase order(s) cancelled successfully.`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
