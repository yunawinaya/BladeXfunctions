// Thin wrapper: delegates the draft save to PRTsaveWorkflow (saveAs: "Draft").
// Replace PRT_SAVE_WORKFLOW_ID with the workflow's runtime id after importing
// Purchase Return/PRTsaveWorkflow.json into the platform.
const PRT_SAVE_WORKFLOW_ID = "2066433188188499969";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

(async () => {
  try {
    this.showLoading("Saving Purchase Return as Draft...");
    const data = this.getValues();

    let workflowResult;
    await this.runWorkflow(
      PRT_SAVE_WORKFLOW_ID,
      { allData: data, saveAs: "Draft", pageStatus: data.page_status },
      async (res) => {
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Purchase Return draft:", err);
        this.hideLoading();
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    const code = workflowResult.data.code;
    if (code === "200" || code === 200 || workflowResult.data.success === true) {
      this.hideLoading();
      this.$message.success(
        workflowResult.data.message ||
          workflowResult.data.msg ||
          "Purchase Return saved successfully",
      );
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.msg ||
          workflowResult.data.message ||
          "Failed to save Purchase Return draft",
      );
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    this.$message.error(error.message || error || "Failed to save Purchase Return draft");
  }
})();
