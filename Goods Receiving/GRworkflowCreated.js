// Trigger for the "Save as Created" button.
// Runs the GRsaveAsCreatedWorkflow and handles the interactive confirm codes:
//   401 = zero-quantity rows present  -> proceed with continueZero = "Yes"
//   402 = over-commitment warning      -> proceed with continueOvercommit = "Yes"
//   400 = validation error             -> show error, stop
//   200 = success
//
// NOTE: Replace WORKFLOW_ID below with the id assigned by the platform after
// importing GRsaveAsCreatedWorkflow.json (the Completed workflow uses 2029090678383042562).
const WORKFLOW_ID = "2065278999991267329";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const runGRWorkflow = async (data, continueZero, continueOvercommit) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      WORKFLOW_ID,
      {
        allData: data,
        saveAs: "Created",
        pageStatus: data.page_status,
        continueZero: continueZero,
        continueOvercommit: continueOvercommit,
      },
      (res) => {
        console.log("Save as Created workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to save Goods Receiving as Created:", err);
        reject(err);
      },
    );
  });
};

const handleWorkflowResult = async (
  workflowResult,
  data,
  continueZero,
  continueOvercommit,
) => {
  if (!workflowResult || !workflowResult.data) {
    this.hideLoading();
    this.$message.error("No response from workflow");
    return;
  }

  const resultCode = workflowResult.data.code;
  const message = workflowResult.data.msg || workflowResult.data.message || "";

  // 401 - Zero quantity confirmation
  if (resultCode === "401" || resultCode === 401) {
    this.hideLoading();
    try {
      await this.$confirm(
        message || "Some lines have zero received quantity. Proceed?",
        "Zero Received Quantity Detected",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: false,
        },
      );
      this.showLoading("Saving Goods Receiving as Created...");
      const retryResult = await runGRWorkflow(data, "Yes", continueOvercommit);
      await handleWorkflowResult(retryResult, data, "Yes", continueOvercommit);
    } catch (e) {
      console.log("User cancelled zero-quantity confirmation");
      this.hideLoading();
    }
    return;
  }

  // 402 - Over-commitment confirmation (soft warning)
  if (resultCode === "402" || resultCode === 402) {
    this.hideLoading();
    try {
      await this.$confirm(
        message || "This GR would over-commit the purchase order. Proceed?",
        "Over-Commitment Detected",
        {
          confirmButtonText: "Yes, Save as Created",
          cancelButtonText: "No, Go Back",
          type: "warning",
          dangerouslyUseHTMLString: false,
        },
      );
      this.showLoading("Saving Goods Receiving as Created...");
      const retryResult = await runGRWorkflow(data, continueZero, "Yes");
      await handleWorkflowResult(retryResult, data, continueZero, "Yes");
    } catch (e) {
      console.log("User cancelled over-commitment confirmation");
      this.hideLoading();
    }
    return;
  }

  // 400 - Validation / general error
  if (
    resultCode === "400" ||
    resultCode === 400 ||
    workflowResult.data.success === false
  ) {
    this.hideLoading();
    this.$message.error(message || "Failed to save Goods Receiving as Created");
    return;
  }

  // 200 - Success
  if (
    resultCode === "200" ||
    resultCode === 200 ||
    workflowResult.data.success === true
  ) {
    this.hideLoading();
    this.$message.success(
      message || "Goods Receiving saved as Created successfully",
    );
    closeDialog();
  } else {
    this.hideLoading();
    this.$message.error("Unknown workflow status");
  }
};

(async () => {
  try {
    this.showLoading("Saving Goods Receiving as Created...");

    const data = this.getValues();

    const workflowResult = await runGRWorkflow(data, "", "");
    await handleWorkflowResult(workflowResult, data, "", "");
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage =
      error.message || "Failed to save Goods Receiving as Created";
    this.$message.error(errorMessage);
  }
})();
