const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const runPPWorkflow = async (data, answers) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2021431201147527170",
      {
        allData: data,
        saveAs: "Created",
        pageStatus: data.page_status,
        continueZero: answers.continueZero || "",
        confirmPickReversal: answers.confirmPickReversal || "",
      },
      (res) => {
        console.log("Picking Plan workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to save Picking Plan:", err);
        reject(err);
      },
    );
  });
};

const handleWorkflowResult = async (workflowResult, data, answers) => {
  if (!workflowResult || !workflowResult.data) {
    this.hideLoading();
    this.$message.error("No response from workflow");
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
      this.showLoading("Saving Picking Plan as Created...");
      const nextAnswers = { ...answers, continueZero: "Yes" };
      const retryResult = await runPPWorkflow(data, nextAnswers);
      await handleWorkflowResult(retryResult, data, nextAnswers);
    } catch (e) {
      console.log("User clicked Cancel or closed the dialog");
      this.hideLoading();
    }
    return;
  }

  // Handle 413 - the reduction unwinds quantity already picked
  if (resultCode === "413" || resultCode === 413) {
    this.hideLoading();
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "This change reverses quantities already picked. Proceed?";

    try {
      await this.$confirm(message, "Reverse picked quantity?", {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      });

      this.showLoading("Saving Picking Plan as Created...");
      const nextAnswers = { ...answers, confirmPickReversal: "Yes" };
      const retryResult = await runPPWorkflow(data, nextAnswers);
      await handleWorkflowResult(retryResult, data, nextAnswers);
    } catch (e) {
      console.log("User cancelled the pick reversal");
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
    const errorMessage =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to save Picking Plan";
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
    const successMessage =
      workflowResult.data.message ||
      workflowResult.data.msg ||
      "Picking Plan saved successfully";
    this.$message.success(successMessage);
    const note = workflowResult.data.pickingReversalNote;
    if (note) {
      try {
        await this.$alert(note, "Stock to put back", {
          confirmButtonText: "OK",
          dangerouslyUseHTMLString: true,
        });
      } catch (e) {
        console.log("Reversal note dismissed");
      }
    }
    closeDialog();
  } else {
    this.hideLoading();
    this.$message.error("Unknown workflow status");
  }
};

(async () => {
  try {
    this.showLoading("Saving Picking Plan as Created...");

    const data = this.getValues();
    console.log("data", data);

    const answers = {};
    const workflowResult = await runPPWorkflow(data, answers);
    await handleWorkflowResult(workflowResult, data, answers);
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Picking Plan";
    this.$message.error(errorMessage);
  }
})();
