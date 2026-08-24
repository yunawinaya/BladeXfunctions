const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

// Every confirmation the workflow can ask for travels in one object, so answering
// one prompt never discards the answer to another on the retry.
const runGDWorkflow = async (data, ctx) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2017151544868491265",
      {
        allData: data,
        saveAs: "Created",
        pageStatus: data.page_status,
        needCL: ctx.needCL,
        continueZero: ctx.continueZero,
        confirmPickReversal: ctx.confirmPickReversal,
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

// Only this tenant mirrors its delivery orders to the external system, so the
// call is gated on the tenant id rather than on the accounting integration.
const DO_SYNC_TENANT_ID = "128671";
const DO_SYNC_WORKFLOW_ID = "2076967001969713153";

// Mirrors the saved delivery order to the external system. Sending one out for
// the first time is a post_do — that covers a new delivery as well as a draft
// being saved as Created. Editing one that was already Created means the
// external system already has it, so that is an update_do.
//
// data is the snapshot taken before the save ran, so gd_status is still the
// status the delivery had going in rather than the Created it has now.
const syncDeliveryOrder = async (gdId, data) => {
  const tenantId = this.getVarSystem("tenantId");
  console.log("Delivery order sync — tenant:", tenantId, "gdId:", gdId);

  if (tenantId !== DO_SYNC_TENANT_ID) {
    return;
  }

  if (!gdId) {
    console.error("Delivery order sync skipped: workflow returned no gdId");
    return;
  }

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  await this.runWorkflow(
    DO_SYNC_WORKFLOW_ID,
    {
      org_id: organizationId,
      task_type:
        data.page_status === "Edit" && data.gd_status === "Created" && data.posted_status === 'Posted'
          ? "update_do"
          : "post_do",
      payload: [gdId],
    },
    (res) => {
      console.log("Delivery order sync response:", res);
    },
    (err) => {
      console.error("Failed to sync delivery order:", err);
    },
  );
};

const handleWorkflowResult = async (workflowResult, data, ctx) => {
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
      const next = { ...ctx, needCL: "required", continueZero: "Yes" };
      const retryResult = await runGDWorkflow(data, next);
      await handleWorkflowResult(retryResult, data, next);
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
      const next = { ...ctx, needCL: "not required" };
      const retryResult = await runGDWorkflow(data, next);
      await handleWorkflowResult(retryResult, data, next);
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
      "Internal Trading - Auto-create Goods Receipt",
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
    const retryResult = await runGDWorkflow(data, ctx);
    await handleWorkflowResult(retryResult, data, ctx);
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

  // Handle 413 - Reducing a quantity below what was already picked. Nothing has
  // been written at this point, so cancelling is a genuine no-op.
  if (resultCode === "413" || resultCode === 413) {
    this.hideLoading();
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "This change reverses quantities that have already been picked. Proceed?";

    try {
      await this.$confirm(message, "Reverse picked quantities", {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      });

      this.showLoading("Saving Goods Delivery as Created...");
      const next = { ...ctx, confirmPickReversal: "Yes" };
      const retryResult = await runGDWorkflow(data, next);
      await handleWorkflowResult(retryResult, data, next);
    } catch (e) {
      console.log("User cancelled the pick reversal");
      this.models["_data"] = { ...this.models["_data"], is_processing: 0 };
      this.hideLoading();
    }
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

    // A toast disappears; the list of stock to put back must not. Only present when
    // a reversal actually happened.
    if (workflowResult.data.pickingReversalNote) {
      await this.$alert(
        workflowResult.data.pickingReversalNote,
        "Stock to put back",
        { confirmButtonText: "OK", type: "warning", dangerouslyUseHTMLString: true },
      );
    }

    closeDialog();

    // The delivery is saved and already reported as such — a failure to mirror
    // it out must not turn that into an error, so this only logs.
    try {
      await syncDeliveryOrder(workflowResult.data.gdId, data);
    } catch (error) {
      console.error("Delivery order sync failed:", error);
    }
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

    const ctx = {
      needCL: "required",
      continueZero: "",
      confirmPickReversal: "",
    };
    const workflowResult = await runGDWorkflow(data, ctx);
    await handleWorkflowResult(workflowResult, data, ctx);
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
