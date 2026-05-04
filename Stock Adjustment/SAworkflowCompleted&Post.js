const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const runSAWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2032025505853816833",
      { allData: data, saveAs: "Completed", pageStatus: data.page_status },
      (res) => {
        console.log("Stock Adjustment workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to save Stock Adjustment:", err);
        reject(err);
      },
    );
  });
};

const handleWorkflowResult = async (workflowResult) => {
  if (!workflowResult || !workflowResult.data) {
    this.hideLoading();
    this.models["_data"] = {
      ...this.models["_data"],
      is_error: 1,
      is_processing: 0,
    };
    this.$message.error("No response from workflow. Please contact support.");
    return;
  }

  const resultCode = workflowResult.data.code;

  if (
    resultCode === "400" ||
    resultCode === 400 ||
    workflowResult.data.success === false
  ) {
    this.hideLoading();
    this.models["_data"] = {
      ...this.models["_data"],
      is_error: 1,
      is_processing: 0,
    };
    const errorMessage =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to save Stock Adjustment. Please contact support.";
    this.$message.error(errorMessage);
    return;
  }

  if (
    resultCode === "200" ||
    resultCode === 200 ||
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
            await this.runWorkflow(
              "1909088441531375617",
              { key: "value" },
              (res) => {
                console.log("成功结果：", res);
                this.models["_data"] = {
                  ...this.models["_data"],
                  is_processing: 0,
                };
                this.$message.success("Add Stock Adjustment successfully.");
                closeDialog();
              },
              (err) => {
                console.error("失败结果：", err);
                this.hideLoading();
                this.models["_data"] = {
                  ...this.models["_data"],
                  is_error: 1,
                  is_processing: 0,
                };
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
          this.models["_data"] = {
            ...this.models["_data"],
            is_error: 1,
            is_processing: 0,
          };
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
          this.models["_data"] = {
            ...this.models["_data"],
            is_processing: 0,
          };
          this.$message.success("Add Stock Adjustment successfully.");
          closeDialog();
        },
        (err) => {
          console.error("失败结果：", err);
          this.hideLoading();
          this.models["_data"] = {
            ...this.models["_data"],
            is_error: 1,
            is_processing: 0,
          };
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
      this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
      this.$message.success("Add Stock Adjustment successfully");
      closeDialog();
      console.log("Not calling workflow");
    } else {
      this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
      closeDialog();
    }
    return;
  }

  this.hideLoading();
  this.models["_data"] = {
    ...this.models["_data"],
    is_error: 1,
    is_processing: 0,
  };
  this.$message.error("Unknown workflow status. Please contact support.");
};

(async () => {
  try {
    if (this.models["_data"]?.is_processing === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }

    if (this.models["_data"]?.is_error === 1) {
      this.$message.error(
        "A workflow error occurred. Please contact support.",
      );
      return;
    }

    this.models["_data"] = { ...this.models["_data"], is_processing: 1 };

    const data = this.getValues();
    this.showLoading("Saving Stock Adjustment as Completed...");
    console.log("data", data);

    const workflowResult = await runSAWorkflow(data);
    await handleWorkflowResult(workflowResult);
  } catch (error) {
    this.hideLoading();
    this.models["_data"] = {
      ...this.models["_data"],
      is_error: 1,
      is_processing: 0,
    };
    console.error("Error:", error);
    const errorMessage =
      error.message ||
      "Failed to save Stock Adjustment. Please contact support.";
    this.$message.error(errorMessage);
  }
})();
