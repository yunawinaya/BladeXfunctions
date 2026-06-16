const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const runSaveWorkflow = async (data, filterZero) => {
  let workflowResult;

  await this.runWorkflow(
    "2014528394297737217",
    {
      allData: data,
      saveAs: "Completed",
      pageStatus: data.page_status,
      filter_zero: filterZero,
    },
    async (res) => {
      workflowResult = res;
    },
    (err) => {
      console.error("Failed to save Misc Receipt:", err);
      this.hideLoading();
      workflowResult = err;
    },
  );

  if (!workflowResult || !workflowResult.data) {
    this.hideLoading();
    this.$message.error("No response from workflow");
    return;
  }

  if (
    workflowResult.data.code === "400" ||
    workflowResult.data.code === 400 ||
    workflowResult.data.success === false
  ) {
    this.hideLoading();
    const errorMessage =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to save Misc Receipt";
    this.$message.error(errorMessage);
    return;
  }

  if (
    workflowResult.data.code === "401" ||
    workflowResult.data.code === 401 ||
    workflowResult.data.success === false
  ) {
    this.hideLoading();
    await this.$confirm(
      workflowResult.data.msg ||
        workflowResult.data.message ||
        "Failed to save Misc Receipt",
      "Confirmation",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    );

    await runSaveWorkflow(data, "Yes");
    return;
  }

  if (
    workflowResult.data.code === "200" ||
    workflowResult.data.code === 200 ||
    workflowResult.data.success === true
  ) {
    this.hideLoading();
    const successMessage =
      workflowResult.data.message ||
      workflowResult.data.msg ||
      "Misc Receipt saved successfully";
    this.$message.success(successMessage);
    closeDialog();
  } else {
    this.hideLoading();
    this.$message.error("Unknown workflow status");
  }
};

(async () => {
  try {
    this.showLoading("Saving Misc Receipt as Completed...");

    const data = this.getValues();

    await runSaveWorkflow(data, "No");
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Misc Receipt";
    this.$message.error(errorMessage);
  }
})();
