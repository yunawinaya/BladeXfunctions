const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const runGDWorkflow = async (data, needCL, isForceComplete, continueZero) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2017151544868491265",
      {
        allData: data,
        saveAs: "Completed",
        pageStatus: data.page_status,
        needCL: needCL,
        isForceComplete: isForceComplete,
        continueZero: continueZero,
        auto_gr_confirmed: data.auto_gr_confirmed || "",
        auto_gr_skip: data.auto_gr_skip || "",
        // Kept on `data` (not as locals) so they survive the retry recursion below: a 401/403/406
        // retry re-enters runGDWorkflow and would otherwise drop an answer already given.
        auto_si_confirmed: data.auto_si_confirmed || "",
        auto_si_skip: data.auto_si_skip || "",
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
      this.showLoading("Saving Goods Delivery as Completed...");
      const retryResult = await runGDWorkflow(data, "required", "", "Yes");
      await handleWorkflowResult(retryResult, data);
    } catch (e) {
      console.log("User clicked Cancel or closed the dialog");
      this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
      this.hideLoading();
    }
    return;
  }

  // Handle 402 - Credit limit block
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

  // Handle 405 - Must save as Created first
  if (resultCode === "405" || resultCode === 405) {
    this.hideLoading();
    this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Save Goods Delivery as Created to start picking process.";

    await this.$alert(message, "", {
      confirmButtonText: "OK",
      type: "warning",
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

      // User clicked Proceed - re-run workflow with need_cl = "not required"
      this.showLoading("Saving Goods Delivery as Completed...");
      const retryResult = await runGDWorkflow(data, "not required", "", "");
      await handleWorkflowResult(retryResult, data);
    } catch (e) {
      console.log("User clicked Cancel or closed the dialog");
      this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
      this.hideLoading();
    }
    return;
  }

  // Handle 407 - Packing not completed
  if (resultCode === "407" || resultCode === 407) {
    this.hideLoading();
    this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Packing process must be completed first.";

    await this.$alert(message, "", {
      confirmButtonText: "OK",
      type: "warning",
      dangerouslyUseHTMLString: true,
    });
    return;
  }

  // Handle 406 - Force complete picking
  if (resultCode === "406" || resultCode === 406) {
    this.hideLoading();
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Picking is currently under In Progress status.\nProceeding will force complete picking process.\n\nWould you like to proceed?";

    try {
      await this.$confirm(message, "", {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      });

      // User clicked Proceed - re-run workflow with isForceComplete = "Yes"
      this.showLoading("Saving Goods Delivery as Completed...");
      const retryResult = await runGDWorkflow(data, "", "Yes", "");
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

    this.showLoading("Saving Goods Delivery as Completed...");
    const retryResult = await runGDWorkflow(data, "required", "", "");
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

  // Handle 410 - GD completed, but linked auto-GR creation failed (non-blocking)
  if (resultCode === "410" || resultCode === 410) {
    this.hideLoading();
    this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "The delivery was completed, but the linked Goods Receipt could not be created automatically. Please create it manually.";

    await this.$alert(message, "Goods Receipt not created", {
      confirmButtonText: "OK",
      type: "warning",
      dangerouslyUseHTMLString: true,
    });
    // GD itself completed successfully — close the dialog.
    closeDialog();
    return;
  }

  // Handle 412 - Auto-create Sales Invoice confirmation
  // Returned BEFORE the goods delivery is written, so answering it re-runs the save from the top.
  if (resultCode === "412" || resultCode === 412) {
    this.hideLoading();
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "This delivery will be invoiced automatically on completion. Auto-create the Sales Invoice?";

    const proceed = await this.$confirm(
      message,
      "Auto-create Sales Invoice",
      {
        confirmButtonText: "Yes, create invoice",
        cancelButtonText: "No, complete only",
        type: "info",
        dangerouslyUseHTMLString: true,
      },
    )
      .then(() => true)
      .catch(() => false);

    if (proceed) {
      data.auto_si_confirmed = true;
    } else {
      data.auto_si_skip = true;
    }

    this.showLoading("Saving Goods Delivery as Completed...");
    const retryResult = await runGDWorkflow(data, "required", "", "");
    await handleWorkflowResult(retryResult, data);
    return;
  }

  // Handle 411 - GD completed, but the auto Sales Invoice failed (non-blocking)
  if (resultCode === "411" || resultCode === 411) {
    this.hideLoading();
    this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "The delivery was completed, but the Sales Invoice could not be created automatically. Please create it manually.";

    await this.$alert(message, "Sales Invoice not created", {
      confirmButtonText: "OK",
      type: "warning",
      dangerouslyUseHTMLString: true,
    });
    // The GD itself completed successfully — close the dialog.
    closeDialog();
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
    this.showLoading("Saving Goods Delivery as Completed...");
    console.log("data", data);

    const workflowResult = await runGDWorkflow(data, "required", "", "");
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
