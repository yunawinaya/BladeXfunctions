const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

(async () => {
  try {
    this.showLoading("Saving Plant Transfer as In Progress...");

    let data = this.getValues();
    console.log("data", data);

    let pageStatus = data.page_status;
    if (arguments[0].autoInProgress === 1) {
      pageStatus = "Edit";
      const id = arguments[0].id;
      if (id && id !== "") {
        data.id = id;
      }
    }

    let workflowResult;

    await this.runWorkflow(
      "2025864403783462913",
      { allData: data, saveAs: "In Progress", pageStatus: pageStatus },
      async (res) => {
        console.log("Plant Transfer saved successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Plant Transfer:", err);
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
        "Failed to save Plant Transfer";
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
        "Plant Transfer saved successfully";
      this.$message.success(successMessage);
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Plant Transfer";
    this.$message.error(errorMessage);
  }
})();
