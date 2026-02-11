const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

(async () => {
  try {
    this.showLoading("Saving Goods Delivery as Draft...");

    const data = this.getValues();
    console.log("data", data);

    let workflowResult;

    await this.runWorkflow(
      "2017151544868491265",
      { allData: data, saveAs: "Draft", pageStatus: data.page_status },
      async (res) => {
        console.log("Goods Delivery saved successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Goods Delivery:", err);
        this.hideLoading();
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    // Handle workflow errors
    if (
      workflowResult.data.code === "400" ||
      workflowResult.data.code === 400 ||
      workflowResult.data.success === false
    ) {
      this.hideLoading();
      const errorMessage =
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Failed to save Goods Delivery";
      this.$message.error(errorMessage);
      return;
    }

    // Handle success
    if (
      workflowResult.data.code === "200" ||
      workflowResult.data.code === 200 ||
      workflowResult.data.success === true
    ) {
      this.hideLoading();
      const successMessage =
        workflowResult.data.message ||
        workflowResult.data.msg ||
        "Goods Delivery saved successfully";
      this.$message.success(successMessage);
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Goods Delivery";
    this.$message.error(errorMessage);
  }
})();
