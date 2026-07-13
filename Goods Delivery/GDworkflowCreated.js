const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const runGDWorkflow = async (data, needCL, continueZero) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2017151544868491265",
      {
        allData: data,
        saveAs: "Created",
        pageStatus: data.page_status,
        needCL: needCL,
        continueZero: continueZero,
        auto_gr_confirmed: data.auto_gr_confirmed || "",
        auto_gr_skip: data.auto_gr_skip || "",
      },
      (res) => {
        console.log("Goods Delivery workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to save Goods Delivery:", err);
        reject(err);
      },
    );
  });
};

const handleWorkflowResult = async (workflowResult, data) => {
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

  // Handle 401 - Zero quantity confirmation
  if (resultCode === "401" || resultCode === 401) {
    this.hideLoading();
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Some lines have zero delivery quantity. Would you like to proceed?";

    try {
      await this.$confirm(message, "", {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      });

      // User clicked Proceed - re-run workflow with continueZero = "Yes"
      this.showLoading("Saving Goods Delivery as Created...");
      const retryResult = await runGDWorkflow(data, "required", "Yes");
      await handleWorkflowResult(retryResult, data);
    } catch (e) {
      console.log("User clicked Cancel or closed the dialog");
      this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
      this.hideLoading();
    }
    return;
  }

  // Handle 402 - Credit limit block
  // Only reachable when picking_setup.full_cl_check = 1 (defaults to 0, in which
  // case the workflow reports needCL = "not required" for Created saves).
  if (resultCode === "402" || resultCode === 402) {
    this.hideLoading();
    this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
    const cleanMessage = (
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Credit limit exceeded"
    ).replace(/^Block - /, "");

    await this.$alert(`${cleanMessage}`, "", {
      confirmButtonText: "OK",
      type: "error",
      dangerouslyUseHTMLString: true,
    });
    return;
  }

  // Handle 403 - Credit limit override
  if (resultCode === "403" || resultCode === 403) {
    this.hideLoading();
    const cleanMessage = (
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Credit limit warning"
    ).replace(/^Override - /, "");

    try {
      await this.$confirm(`${cleanMessage}`, "", {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      });

      // User clicked Proceed - re-run workflow with needCL = "not required"
      this.showLoading("Saving Goods Delivery as Created...");
      const retryResult = await runGDWorkflow(data, "not required", "");
      await handleWorkflowResult(retryResult, data);
    } catch (e) {
      console.log("User clicked Cancel or closed the dialog");
      this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
      this.hideLoading();
    }
    return;
  }

  // Handle 408 - Internal trading: confirm auto-create Goods Receipt
  if (resultCode === "408" || resultCode === 408) {
    this.hideLoading();
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "This delivery is linked to an internal Purchase Order. Auto-create the Goods Receipt in the buyer organization on completion?";

    const proceed = await this.$confirm(
      message,
      "Internal Trading – Auto-create Goods Receipt",
      {
        confirmButtonText: "Yes, prepare GR",
        cancelButtonText: "No, save without",
        type: "info",
        dangerouslyUseHTMLString: true,
      },
    )
      .then(() => true)
      .catch(() => false);

    // Yes -> confirm auto-GR (enforces full delivery); No -> save without auto-GR
    if (proceed) {
      data.auto_gr_confirmed = true;
    } else {
      data.auto_gr_skip = true;
    }

    this.showLoading("Saving Goods Delivery as Created...");
    const retryResult = await runGDWorkflow(data, "required", "");
    await handleWorkflowResult(retryResult, data);
    return;
  }

  // Handle 409 - Internal trading: linked delivery not fully delivered (block)
  if (resultCode === "409" || resultCode === 409) {
    this.hideLoading();
    this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Linked delivery must be fully delivered before auto-creating the Goods Receipt.";

    await this.$alert(message, "", {
      confirmButtonText: "OK",
      type: "warning",
      dangerouslyUseHTMLString: true,
    });
    return;
  }

  // Handle 400 - General error
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
      "Failed to save Goods Delivery. Please contact support.";
    this.$message.error(errorMessage);
    return;
  }

  // Handle success
  if (
    resultCode === "200" ||
    resultCode === 200 ||
    workflowResult.data.success === true
  ) {
    // Picking creation is now handled by the workflow itself
    this.hideLoading();
    this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
    const successMessage =
      workflowResult.data.message ||
      workflowResult.data.msg ||
      "Goods Delivery saved successfully";
    this.$message.success(successMessage);
    closeDialog();
  } else {
    this.hideLoading();
    this.models["_data"] = {
      ...this.models["_data"],
      is_error: 1,
      is_processing: 0,
    };
    this.$message.error("Unknown workflow status. Please contact support.");
  }
};

(async () => {
  try {
    // Check if workflow is already processing - prevent duplicate submissions
    if (this.models["_data"]?.is_processing === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }

    // Check if previous workflow had an error - prevent repeated attempts
    if (this.models["_data"]?.is_error === 1) {
      this.$message.error("A workflow error occurred. Please contact support.");
      return;
    }

    // Set processing flag
    this.models["_data"] = { ...this.models["_data"], is_processing: 1 };

    const data = this.getValues();
    this.showLoading("Saving Goods Delivery as Created...");
    console.log("data", data);

    const workflowResult = await runGDWorkflow(data, "required", "");
    await handleWorkflowResult(workflowResult, data);
  } catch (error) {
    this.hideLoading();
    this.models["_data"] = {
      ...this.models["_data"],
      is_error: 1,
      is_processing: 0,
    };
    console.error("Error:", error);
    const errorMessage =
      error.message || "Failed to save Goods Delivery. Please contact support.";
    this.$message.error(errorMessage);
  }
})();
