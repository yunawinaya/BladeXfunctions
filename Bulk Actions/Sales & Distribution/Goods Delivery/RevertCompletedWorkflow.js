const REVERT_WORKFLOW_ID = "2058819647368241153";

const runRevertWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      REVERT_WORKFLOW_ID,
      {
        allData: data,
        pageStatus: "Edit",
      },
      (res) => {
        console.log("GD revert workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to revert Goods Delivery:", err);
        reject(err);
      },
    );
  });
};

// A Goods Delivery carries si_status = "" / null (not invoiced), "Partially
// Invoiced", "Fully Invoiced" or "Cancelled". Anything other than empty or
// "Cancelled" means a live Sales Invoice exists against this GD, so the
// delivery cannot be rolled back until that invoice is cancelled.
const isInvoiced = (record) => {
  const status = String((record && record.si_status) || "").trim();
  return status !== "" && status.toLowerCase() !== "cancelled";
};

const describeInvoiced = (records) =>
  records
    .map((item) => `${item.delivery_no} (${item.si_status})`)
    .join("<br>");

const invoicedError = (siStatus) =>
  `Already invoiced (${siStatus}). Please cancel the sales invoice first.`;

const handleWorkflowResult = (workflowResult, gdItem) => {
  if (!workflowResult || !workflowResult.data) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "No response from revert workflow",
    };
  }

  const resultCode = workflowResult.data.code;

  // 409 - Conflict (state changed since completion; cannot safely revert)
  if (resultCode === "409" || resultCode === 409) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error:
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Conflict: state has changed since completion",
    };
  }

  // 400 - general error (not Completed, snapshot missing, etc.)
  if (
    resultCode === "400" ||
    resultCode === 400 ||
    workflowResult.data.success === false
  ) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error:
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Failed to revert Goods Delivery",
    };
  }

  // 200 - success
  if (
    resultCode === "200" ||
    resultCode === 200 ||
    workflowResult.data.success === true
  ) {
    return {
      delivery_no: gdItem.delivery_no,
      success: true,
    };
  }

  return {
    delivery_no: gdItem.delivery_no,
    success: false,
    error: "Unknown revert workflow status",
  };
};

(async () => {
  try {
    this.showLoading();
    const allListID = "custom_ezwb0qqp";

    const selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const completedGoodsDelivery = selectedRecords.filter(
      (item) => item.gd_status === "Completed",
    );

    if (completedGoodsDelivery.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one completed goods delivery to revert.",
      );
      return;
    }

    // Invoiced goods deliveries cannot be reverted - the sales invoice has to
    // be cancelled first, which resets si_status back to empty.
    const invoicedGoodsDelivery = completedGoodsDelivery.filter(isInvoiced);
    const goodsDeliveryData = completedGoodsDelivery.filter(
      (item) => !isInvoiced(item),
    );

    if (goodsDeliveryData.length === 0) {
      this.hideLoading();
      this.$message({
        type: "error",
        message: `The selected goods delivery(s) have already been invoiced and cannot be reverted. Please cancel the sales invoice first.<br>${describeInvoiced(
          invoicedGoodsDelivery,
        )}`,
        dangerouslyUseHTMLString: true,
      });
      return;
    }

    const goodsDeliveryNumbers = goodsDeliveryData.map(
      (item) => item.delivery_no,
    );

    const skippedNote =
      invoicedGoodsDelivery.length > 0
        ? `<br><br><strong>${
            invoicedGoodsDelivery.length
          } invoiced goods delivery(s) will be skipped:</strong> <br>${describeInvoiced(
            invoicedGoodsDelivery,
          )}<br>Please cancel the sales invoice first to revert them.`
        : "";

    await this.$confirm(
      `You've selected ${
        goodsDeliveryNumbers.length
      } goods delivery(s) to revert to Created. This will undo inventory delivery, stock movements, handling unit deductions, and Sales Order updates. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
        ", ",
      )}${skippedNote} <br>Do you want to proceed?`,
      "Revert Goods Delivery to Created",
      {
        confirmButtonText: "Revert",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    const results = invoicedGoodsDelivery.map((item) => ({
      delivery_no: item.delivery_no,
      success: false,
      error: invoicedError(item.si_status),
    }));

    for (const gdItem of goodsDeliveryData) {
      const id = gdItem.id;

      const data = await db.collection("goods_delivery").doc(id).get();

      if (!data.data || data.data.length === 0) {
        results.push({
          delivery_no: gdItem.delivery_no,
          success: false,
          error: "Goods Delivery record not found",
        });
        continue;
      }

      try {
        const gdData = data.data[0];

        // The selected row can be stale if the goods delivery was invoiced
        // elsewhere after the list was loaded. The record is already fetched,
        // so re-checking here costs nothing.
        if (isInvoiced(gdData)) {
          results.push({
            delivery_no: gdItem.delivery_no,
            success: false,
            error: invoicedError(gdData.si_status),
          });
          continue;
        }

        const workflowResult = await runRevertWorkflow(gdData);
        const result = handleWorkflowResult(workflowResult, gdItem);
        results.push(result);
      } catch (error) {
        results.push({
          delivery_no: gdItem.delivery_no,
          success: false,
          error: error.message || "Failed to revert",
        });
      }
    }

    // Show summary
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    if (failCount > 0) {
      const failedItems = results
        .filter((r) => !r.success)
        .map((r) => `${r.delivery_no}: ${r.error}`)
        .join("<br>");
      this.$message({
        type: "error",
        message: `${successCount} reverted, ${failCount} failed:<br>${failedItems}`,
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `All ${successCount} Goods Delivery reverted to Created successfully`,
      );
    }

    this.hideLoading();
    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
