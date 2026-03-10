const closeDialog = (data) => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

(async () => {
  try {
    this.showLoading("Saving Putaway as Completed...");

    const data = this.getValues();
    console.log("data", data);

    // Ensure data is an array
    const arrayData = Array.isArray(data) ? data : [data];

    let workflowResult;

    await this.runWorkflow(
      "2031190421336195074",
      {
        arrayData: arrayData,
        saveAs: "Completed",
        pageStatus: data.page_status,
        confirmed_by: this.getVarGlobal("nickname"),
      },
      async (res) => {
        console.log("Putaway saved successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Putaway:", err);
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
        "Failed to save Putaway";
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
        "Putaway saved successfully";
      this.$message.success(successMessage);
      closeDialog(arrayData[0]);
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Putaway";
    this.$message.error(errorMessage);
  }
})();
