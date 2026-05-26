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

    const goodsDeliveryData = selectedRecords.filter(
      (item) => item.gd_status === "Completed",
    );

    if (goodsDeliveryData.length === 0) {
      this.hideLoading();
      this.$message.error(
        "Please select at least one completed goods delivery to revert.",
      );
      return;
    }

    const goodsDeliveryNumbers = goodsDeliveryData.map(
      (item) => item.delivery_no,
    );

    await this.$confirm(
      `You've selected ${
        goodsDeliveryNumbers.length
      } goods delivery(s) to revert to Created. This will undo inventory delivery, stock movements, handling unit deductions, and Sales Order updates. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
        ", ",
      )} <br>Do you want to proceed?`,
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

    const results = [];

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
      this.$message.error(
        `${successCount} reverted, ${failCount} failed:<br>${failedItems}`,
      );
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
