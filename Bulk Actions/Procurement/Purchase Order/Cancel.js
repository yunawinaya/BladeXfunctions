const runPOCancelWorkflow = async (poItem, cancelCreatedGR) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2075034104886788098",
      {
        action: "cancel",
        po_id: poItem.id,
        po_no: poItem.purchase_order_no,
        po_plant_id: poItem.po_plant?.id,
        cancelCreatedGR: cancelCreatedGR,
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

// Escape interpolated values; only literal <br>/<strong> stay as HTML.
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

    const results = [];
    const pushResult = (poItem, res) => {
      const code = res?.data?.code;
      if (code === "200" || code === 200) {
        results.push({ po_no: poItem.purchase_order_no, success: true });
      } else {
        results.push({
          po_no: poItem.purchase_order_no,
          success: false,
          error:
            res?.data?.message ||
            res?.data?.msg ||
            "Failed to cancel purchase order",
        });
      }
    };

    // Round 1: cancel what we can. POs with a Created GR come back as 409
    // (nothing changed) so the user can confirm cascading that cancellation.
    this.showLoading("Cancelling Purchase Order...");

    const needGrConfirm = [];
    for (const poItem of purchaseOrderData) {
      try {
        const res = await runPOCancelWorkflow(poItem, 0);
        const code = res?.data?.code;
        if (code === "409" || code === 409) {
          needGrConfirm.push({ poItem, grNos: res?.data?.grNos || "" });
        } else {
          pushResult(poItem, res);
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

    // Round 2: ask once about every PO that has a Created GR.
    if (needGrConfirm.length > 0) {
      const info = needGrConfirm
        .map(
          (x) =>
            `PO: ${esc(x.poItem.purchase_order_no)} &rarr; GR: ${esc(x.grNos)}`,
        )
        .join("<br>");

      const answer = await this.$confirm(
        `These purchase orders have created goods receiving. <br> <strong>Purchase Order &rarr; Goods Receiving:</strong> <br>${info} <br><br>Do you wish to cancel the goods receiving as well?`,
        "Purchase Order with Created Goods Receiving",
        {
          confirmButtonText: "Cancel GR & PO",
          cancelButtonText: "Skip These",
          type: "warning",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => null);

      if (answer === "confirm") {
        this.showLoading("Cancelling Goods Receiving and Purchase Order...");
        for (const { poItem } of needGrConfirm) {
          try {
            const res = await runPOCancelWorkflow(poItem, 1);
            pushResult(poItem, res);
          } catch (error) {
            results.push({
              po_no: poItem.purchase_order_no,
              success: false,
              error: error.message || "Failed to cancel purchase order",
            });
          }
        }
        this.hideLoading();
      } else {
        // Refused: block cancellation for those POs.
        for (const { poItem } of needGrConfirm) {
          results.push({
            po_no: poItem.purchase_order_no,
            success: false,
            error: "Skipped: has created goods receiving.",
          });
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    if (failCount > 0) {
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
