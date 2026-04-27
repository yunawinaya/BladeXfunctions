const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading("Creating Packing...");

    const data = this.getValues();

    // Clear UI-only selection state before submitting — form checkboxes
    // (bulk pick / single-select active target) that shouldn't persist.
    if (Array.isArray(data.table_hu)) {
      data.table_hu = data.table_hu.map((r) => ({ ...r, select_hu: 0 }));
    }
    if (Array.isArray(data.table_hu_source)) {
      data.table_hu_source = data.table_hu_source.map((r) => ({
        ...r,
        hu_select: 0,
      }));
    }
    if (Array.isArray(data.table_item_source)) {
      data.table_item_source = data.table_item_source.map((r) => ({
        ...r,
        select_item: 0,
      }));
    }

    console.log("data", data);

    let workflowResult;

    await this.runWorkflow(
      "1994279909883895810",
      { entry: data, saveAs: "Created" },
      async (res) => {
        console.log("Packing created successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to create Packing:", err);
        workflowResult = err;
      },
    );

    if (
      workflowResult.data.errorStatus &&
      workflowResult.data.errorStatus !== ""
    ) {
      if (workflowResult.data.errorStatus === "missingFields") {
        this.hideLoading();
        this.$message.error(
          `Validation errors: ${workflowResult.data.message}`,
        );
        return;
      }

      // Handle any other error status
      if (workflowResult.data.message) {
        this.hideLoading();
        this.$message.error(workflowResult.data.message);
        return;
      }
    }

    if (workflowResult.data.status === "Success") {
      this.$message.success("Packing created successfully");
      this.hideLoading();
      closeDialog();
    }
  } catch (error) {
    console.error("Error:", error);
    this.$message.error("Failed to create Packing");
    this.hideLoading();
    closeDialog();
  }
})();
