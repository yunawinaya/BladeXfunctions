const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

(async () => {
  try {
    this.showLoading("Saving Stock Adjustment as Completed...");

    const data = this.getValues();
    console.log("data", data);

    let workflowResult;

    await this.runWorkflow(
      "2032025505853816833",
      { allData: data, saveAs: "Completed", pageStatus: data.page_status },
      async (res) => {
        console.log("Stock Adjustment saved successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Stock Adjustment:", err);
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
        "Failed to save Stock Adjustment";
      this.$message.error(errorMessage);
      return;
    }

    // Handle success
    if (
      workflowResult.data.code === "200" ||
      workflowResult.data.code === 200 ||
      workflowResult.data.success === true
    ) {
      if (
        accIntegrationType === "SQL Accounting" &&
        organizationId &&
        organizationId !== ""
      ) {
        console.log("Calling SQL Accounting workflow");

        await this.runWorkflow(
          "1958732352162164738",
          { key: "value" },
          async (res) => {
            console.log("成功结果：", res);
            if (res.data.status === "running") {
              // Run workflow
              await this.runWorkflow(
                "1909088441531375617",
                { key: "value" },
                (res) => {
                  console.log("成功结果：", res);
                  this.$message.success("Add Stock Adjustment successfully.");
                  closeDialog();
                },
                (err) => {
                  console.error("失败结果：", err);
                  this.hideLoading();
                  closeDialog();
                  throw new Error(
                    "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
                  );
                },
              );
            }
          },
          (err) => {
            console.log("失败结果：", err);
            this.hideLoading();
            closeDialog();
            throw new Error(
              "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
            );
          },
        );
      } else if (
        accIntegrationType === "AutoCount Accounting" &&
        organizationId &&
        organizationId !== ""
      ) {
        console.log("Calling AutoCount workflow");
        await this.runWorkflow(
          "1996041757448597505",
          { sa_id: [result.id] },
          (res) => {
            console.log("成功结果：", res);
            this.$message.success("Add Stock Adjustment successfully.");
            closeDialog();
          },
          (err) => {
            console.error("失败结果：", err);
            this.hideLoading();
            closeDialog();
            throw new Error(
              "Your AutoCount accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
            );
          },
        );
      } else if (
        accIntegrationType === "No Accounting Integration" &&
        organizationId &&
        organizationId !== ""
      ) {
        this.$message.success("Add Stock Adjustment successfully");
        closeDialog();
        console.log("Not calling workflow");
      } else {
        closeDialog();
      }
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Stock Adjustment";
    this.$message.error(errorMessage);
  }
})();
