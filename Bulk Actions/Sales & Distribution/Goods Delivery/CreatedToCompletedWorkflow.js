const runGDWorkflow = async (data, needCL, isForceComplete, continueZero) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2017151544868491265",
      {
        allData: data,
        saveAs: "Completed",
        pageStatus: "Edit",
        need_cl: needCL,
        isForceComplete: isForceComplete,
        continueZero: continueZero,
      },
      (res) => {
        console.log("Goods Delivery workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to save Goods Delivery:", err);
        reject(err);
      },
    );
  });
};

const handleWorkflowResult = async (workflowResult, gdItem, gdData) => {
  if (!workflowResult || !workflowResult.data) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "No response from workflow",
    };
  }

  const resultCode = workflowResult.data.code;

  // Handle 401 - Zero quantity confirmation - auto-proceed
  if (resultCode === "401" || resultCode === 401) {
    console.log(`GD ${gdItem.delivery_no}: Zero quantity warning, auto-proceeding`);
    const retryResult = await runGDWorkflow(gdData, "required", "", "Yes");
    return handleWorkflowResult(retryResult, gdItem, gdData);
  }

  // Handle 402 - Credit limit block
  if (resultCode === "402" || resultCode === 402) {
    const cleanMessage = (
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Credit limit exceeded"
    ).replace(/^Block - /, "");
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: cleanMessage,
    };
  }

  // Handle 403 - Credit limit override - auto-proceed
  if (resultCode === "403" || resultCode === 403) {
    console.log(`GD ${gdItem.delivery_no}: Credit limit override, auto-proceeding`);
    const retryResult = await runGDWorkflow(gdData, "not required", "", "");
    return handleWorkflowResult(retryResult, gdItem, gdData);
  }

  // Handle 405 - Must save as Created first (shouldn't happen for bulk)
  if (resultCode === "405" || resultCode === 405) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "Must save as Created first",
    };
  }

  // Handle 406 - Force complete picking - auto-proceed
  if (resultCode === "406" || resultCode === 406) {
    console.log(`GD ${gdItem.delivery_no}: Force complete picking, auto-proceeding`);
    const retryResult = await runGDWorkflow(gdData, "", "Yes", "");
    return handleWorkflowResult(retryResult, gdItem, gdData);
  }

  // Handle 407 - Packing not completed
  if (resultCode === "407" || resultCode === 407) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "Packing must be completed first",
    };
  }

  // Handle 400 - General error
  if (
    resultCode === "400" ||
    resultCode === 400 ||
    workflowResult.data.success === false
  ) {
    const errorMessage =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to complete Goods Delivery";
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: errorMessage,
    };
  }

  // Handle success
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
    error: "Unknown workflow status",
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
      (item) => item.gd_status === "Created",
    );

    if (goodsDeliveryData.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one created goods delivery.");
      return;
    }

    const goodsDeliveryNumbers = goodsDeliveryData.map(
      (item) => item.delivery_no,
    );

    await this.$confirm(
      `You've selected ${
        goodsDeliveryNumbers.length
      } goods delivery(s) to complete. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
        ", ",
      )} <br>Do you want to proceed?`,
      "Goods Delivery Completion",
      {
        confirmButtonText: "Proceed",
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
        const workflowResult = await runGDWorkflow(gdData, "required", "", "");
        const result = await handleWorkflowResult(workflowResult, gdItem, gdData);
        results.push(result);
      } catch (error) {
        results.push({
          delivery_no: gdItem.delivery_no,
          success: false,
          error: error.message || "Failed to complete",
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
        `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
      );
    } else {
      this.$message.success(
        `All ${successCount} Goods Delivery completed successfully`,
      );
    }

    this.hideLoading();
    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
