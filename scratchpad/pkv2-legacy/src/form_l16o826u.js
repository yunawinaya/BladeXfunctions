const closeDialog = (data) => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    if (data.to_no && data.to_no.length > 0) {
      this.parentGenerateForm.hide("custom_41s73hyl");
    } else {
      this.parentGenerateForm.hide("tabs_picking");
    }
  }
};

(async () => {
  try {
    this.showLoading("Saving Picking as Completed...");

    const data = this.getValues();
    console.log("data", data);

    // Header rows in table_picking_items exist for display only — strip them
    // before sending to the workflow.
    if (Array.isArray(data.table_picking_items)) {
      data.table_picking_items = data.table_picking_items.filter(
        (row) => row.row_type !== "header",
      );
    }

    // Ensure data is an array
    const arrayData = Array.isArray(data) ? data : [data];

    let workflowResult;

    await this.runWorkflow(
      "2021065804251615233",
      {
        arrayData: arrayData,
        saveAs: "Completed",
        pageStatus: data.page_status,
        confirmed_by: this.getVarGlobal("nickname"),
      },
      async (res) => {
        console.log("Picking saved successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Picking:", err);
        this.hideLoading();
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    // Handle credit limit warnings (402, 403)
    if (
      workflowResult.data.code === "402" ||
      workflowResult.data.code === 402 ||
      workflowResult.data.code === "403" ||
      workflowResult.data.code === 403
    ) {
      this.hideLoading();
      this.$message.warning(
        "Unable to auto complete GD due to Credit Limit. Please complete manually",
      );
      closeDialog(arrayData[0]);
      return;
    }

    // Handle packing not completed warnings (407)
    if (
      workflowResult.data.code === "407" ||
      workflowResult.data.code === 407
    ) {
      this.hideLoading();
      this.$message.warning(
        "Unable to auto complete GD due to Packing not completed.",
      );
      closeDialog(arrayData[0]);
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
        "Failed to save Picking";
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
        "Picking saved successfully";
      this.$message.success(successMessage);
      closeDialog(arrayData[0]);
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Picking";
    this.$message.error(errorMessage);
  }
})();
