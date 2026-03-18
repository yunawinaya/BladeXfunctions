const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading("Completing Packing...");

    const data = this.getValues();
    console.log("data", data);

    let workflowResult;

    await this.runWorkflow(
      "1994279909883895810",
      { entry: data, saveAs: "Completed" },
      async (res) => {
        console.log("Packing completed successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to complete Packing:", err);
        workflowResult = err;
      },
    );

    if (
      workflowResult.data.errorStatus &&
      workflowResult.data.errorStatus !== ""
    ) {
      if (workflowResult.data.errorStatus === "missingFields") {
        this.hideLoading();
        this.$message.error(
          `Validation errors: ${workflowResult.data.message}`,
        );
        return;
      }

      if (workflowResult.data.errorStatus === "fullyPacked") {
        this.hideLoading();
        this.$message.error(workflowResult.data.message);
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
      this.$message.success("Packing completed successfully");
      this.hideLoading();
      closeDialog();
    }
  } catch (error) {
    console.error("Error:", error);
    this.$message.error("Failed to complete Packing");
    this.hideLoading();
    closeDialog();
  }
})();
