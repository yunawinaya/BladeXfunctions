const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading("Saving Misc Receipt as Completed & Posting...");

    const data = this.getValues();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    let workflowResult;

    // Step 1: Run the Completed workflow
    await this.runWorkflow(
      "2014528394297737217",
      { allData: data, saveAs: "Completed", pageStatus: data.page_status },
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

    // Step 2: If Completed workflow succeeded, proceed to Post
    if (
      workflowResult.data.code === "200" ||
      workflowResult.data.code === 200 ||
      workflowResult.data.success === true
    ) {
      const stockMovementId = workflowResult.data.id;

      // Update stock movement with posted status
      await db.collection("sm_misc_receipt").doc(stockMovementId).update({
        stock_movement_status: "Completed",
        posted_status: "Pending Post",
      });

      const accIntegrationType = this.getValue("acc_integration_type");

      // Step 3: Call posting workflow based on accounting integration type
      await postToAccounting(
        stockMovementId,
        accIntegrationType,
        organizationId,
      );
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage =
      error.message || "Failed to complete and post Misc Receipt";
    this.$message.error(errorMessage);
  }
})();
