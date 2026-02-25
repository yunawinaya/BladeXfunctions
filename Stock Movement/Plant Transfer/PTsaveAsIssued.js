const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

(async () => {
  try {
    this.showLoading("Saving Plant Transfer as Issued...");

    const data = this.getValues();
    console.log("data", data);

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    let workflowResult;

    await this.runWorkflow(
      "2025864403783462913",
      { allData: data, saveAs: "Issued", pageStatus: data.page_status },
      async (res) => {
        console.log("Plant Transfer saved successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Plant Transfer:", err);
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
        "Failed to save Plant Transfer";
      this.$message.error(errorMessage);
      return;
    }

    // Handle success
    if (
      workflowResult.data.code === "200" ||
      workflowResult.data.code === 200 ||
      workflowResult.data.success === true
    ) {
      const resPlantTransferSetup = await db
        .collection("plant_transfer_setup")
        .where({
          organization_id: organizationId,
        })
        .get();

      if (resPlantTransferSetup.data && resPlantTransferSetup.data.length > 0) {
        if (!resPlantTransferSetup.data[0].picking_required) {
          const id = workflowResult.data.id;
          const autoInProgress = 1;
          this.triggerEvent("onClick_issueIFT", { id, autoInProgress });
        } else {
          this.hideLoading();
          const successMessage =
            workflowResult.data.message ||
            workflowResult.data.msg ||
            "Plant Transfer saved successfully";
          this.$message.success(successMessage);
          closeDialog();
        }
      }
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Plant Transfer";
    this.$message.error(errorMessage);
  }
})();
