const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading("Creating Repack Order...");

    const rawData = this.getValues();
    const { dialog_repack, ...data } = rawData;
    const pageStatus = data.page_status;

    let workflowResult;

    await this.runWorkflow(
      "2043621631586209793",
      { allData: data, saveAs: "Created", pageStatus },
      (res) => {
        console.log("Repack Order created:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to create Repack Order:", err);
        workflowResult = err;
      },
    );

    if (workflowResult?.data?.code && workflowResult.data.code !== 200) {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.message || "Failed to create Repack Order",
      );
      return;
    }

    this.$message.success("Repack Order created");
    this.hideLoading();
    closeDialog();
  } catch (error) {
    console.error("Error in ROsaveAsCreated:", error);
    this.hideLoading();
    this.$message.error(error.message || "Failed to create Repack Order");
    closeDialog();
  }
})();
