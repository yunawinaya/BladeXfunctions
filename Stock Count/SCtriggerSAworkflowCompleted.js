const runSAWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2032025505853816833",
      { allData: data, saveAs: "Completed", pageStatus: "Edit" },
      (res) => {
        console.log("Stock Adjustment workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to complete Stock Adjustment:", err);
        reject(err);
      },
    );
  });
};

const handleWorkflowResult = (workflowResult) => {
  if (!workflowResult || !workflowResult.data) {
    this.$message.error(
      "No response from Stock Adjustment workflow. Please contact support.",
    );
    return;
  }

  const resultCode = workflowResult.data.code;

  if (
    resultCode === "400" ||
    resultCode === 400 ||
    workflowResult.data.success === false
  ) {
    const errorMessage =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to complete Stock Adjustment. Please contact support.";
    this.$message.error(errorMessage);
    return;
  }

  if (
    resultCode === "200" ||
    resultCode === 200 ||
    workflowResult.data.success === true
  ) {
    const successMessage =
      workflowResult.data.message ||
      workflowResult.data.msg ||
      "Successfully completed Stock Adjustment";
    this.$message.success(successMessage);
    return;
  }

  this.$message.error(
    "Unknown Stock Adjustment workflow status. Please contact support.",
  );
};

(async () => {
  try {
    const data = arguments[0].data;
    const stockAdjustmentId = arguments[0].stockAdjustmentId;

    if (!data || !stockAdjustmentId) {
      console.error(
        "SCtriggerSAworkflowCompleted: missing data or stockAdjustmentId",
      );
      this.$message.error("Missing Stock Adjustment data. Cannot complete.");
      return;
    }

    // The Stock Adjustment already exists as a Draft (created by SCsaveReview),
    // so the workflow runs in "Edit" mode and updates it to "Completed".
    data.id = data.id || stockAdjustmentId;

    const workflowResult = await runSAWorkflow(data);
    handleWorkflowResult(workflowResult);
  } catch (error) {
    console.error("Error in SCtriggerSAworkflowCompleted:", error);
    this.$message.error(
      error?.message || "Failed to complete Stock Adjustment.",
    );
  }
})();
