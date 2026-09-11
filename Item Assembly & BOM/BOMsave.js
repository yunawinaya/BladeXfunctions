// BOM_SAVE — the server-side save; see Item Assembly & BOM/BOMsaveWorkflow.json.
const BOM_SAVE_WORKFLOW_ID = "2098308362750185474";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const findFieldMessage = (obj) => {
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }

    return obj.toString();
  }
  return null;
};

(async () => {
  try {
    await this.validate();

    this.showLoading("Saving Bill of Materials...");

    const rawData = this.getValues();
    // default_dialog is the confirmation model, not a column on the table.
    const { default_dialog, ...data } = rawData;
    const pageStatus = data.page_status;

    let workflowResult;

    await this.runWorkflow(
      BOM_SAVE_WORKFLOW_ID,
      { allData: data, pageStatus },
      (res) => {
        workflowResult = res;
      },
      (err) => {
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    const code = workflowResult.data.code;
    if (code && String(code) !== "200") {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.msg ||
          workflowResult.data.message ||
          "Failed to save the Bill of Materials",
      );
      return;
    }

    this.$message.success(
      `${pageStatus === "Edit" ? "Update" : "Add"} successfully.`,
    );
    this.hideLoading();
    closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error(error);

    let errorMessage = "";
    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
  }
})();
