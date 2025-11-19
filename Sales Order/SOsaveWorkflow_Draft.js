const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading("Drafting Sales Order...");

    const data = this.getValues();
    console.log("data", data);

    let workflowResult;

    await this.runWorkflow(
      "1988908545345945602",
      { entry: data, saveAs: "Draft" },
      async (res) => {
        console.log("Sales Order drafted successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to draft Sales Order:", err);
        workflowResult = err;
      }
    );

    if (
      workflowResult.data.errorStatus &&
      workflowResult.data.errorStatus !== ""
    ) {
      if (workflowResult.data.errorStatus === "missingFields") {
        this.hideLoading();
        this.$message.error(
          `Validation errors: ${workflowResult.data.message}`
        );
        return;
      }

      // Handle any other error status
      if (workflowResult.data.message) {
        this.hideLoading();
        this.$message.error(workflowResult.data.message);
        return;
      }
    }

    if (workflowResult.data.status === "Success") {
      console.log("workflowResult", workflowResult);
      this.$message.success("Sales Order drafted successfully");
      this.hideLoading();
      closeDialog();
    }
  } catch (error) {
    console.error("Error:", error);
    this.$message.error("Failed to draft Sales Order");
    this.hideLoading();
    closeDialog();
  }
})();
