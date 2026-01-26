const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const postToAccounting = async (
  stockMovementId,
  accIntegrationType,
  organizationId,
) => {
  if (
    accIntegrationType === "SQL Accounting" &&
    organizationId &&
    organizationId !== ""
  ) {
    await this.runWorkflow(
      "1958732352162164738",
      { key: "value" },
      async (res) => {
        if (res.data.status === "running") {
          await this.runWorkflow(
            "1910197713380311041",
            { key: "value" },
            () => {
              this.$message.success(
                "Misc Issue completed and posted successfully.",
              );
              closeDialog();
            },
            (err) => {
              console.error("SQL Accounting post error:", err);
              closeDialog();
              throw new Error(
                "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
              );
            },
          );
        }
      },
      (err) => {
        console.error("SQL Accounting workflow error:", err);
        this.hideLoading();
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
    await this.runWorkflow(
      "1996041187778228226",
      { sm_id: [stockMovementId] },
      () => {
        this.$message.success("Misc Issue completed and posted successfully.");
        closeDialog();
      },
      (err) => {
        console.error("AutoCount workflow error:", err);
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
    this.$message.success("Misc Issue completed and posted successfully.");
    closeDialog();
  } else {
    closeDialog();
  }
};

(async () => {
  try {
    this.showLoading("Saving Misc Issue as Completed & Posting...");

    const data = this.getValues();
    const stockMovementId = data.id;

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    let workflowResult;

    // Step 1: Run the Completed workflow
    await this.runWorkflow(
      "2015602242971631618",
      { allData: data, saveAs: "Completed", pageStatus: data.page_status },
      async (res) => {
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Misc Issue:", err);
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
        "Failed to save Misc Issue";
      this.$message.error(errorMessage);
      return;
    }

    // Step 2: If Completed workflow succeeded, proceed to Post
    if (
      workflowResult.data.code === "200" ||
      workflowResult.data.code === 200 ||
      workflowResult.data.success === true
    ) {
      // Update stock movement with posted status
      await db.collection("sm_misc_issue").doc(stockMovementId).update({
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
      error.message || "Failed to complete and post Misc Issue";
    this.$message.error(errorMessage);
  }
})();
