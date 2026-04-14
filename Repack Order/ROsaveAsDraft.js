const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading("Saving Repack Order as draft...");

    const rawData = this.getValues();
    const { dialog_repack, ...data } = rawData;
    const pageStatus = data.page_status;

    let workflowResult;

    await this.runWorkflow(
      "2043621631586209793",
      { allData: data, saveAs: "Draft", pageStatus },
      (res) => {
        console.log("Repack Order draft saved:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Repack Order draft:", err);
        workflowResult = err;
      },
    );

    if (workflowResult?.data?.code && workflowResult.data.code !== 200) {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.message || "Failed to save Repack Order draft",
      );
      return;
    }

    this.$message.success("Repack Order saved as draft");
    this.hideLoading();
    closeDialog();
  } catch (error) {
    console.error("Error in ROsaveAsDraft:", error);
    this.hideLoading();
    this.$message.error(error.message || "Failed to save Repack Order draft");
    closeDialog();
  }
})();
