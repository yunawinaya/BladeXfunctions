// ITEM_ASSEMBLY_SAVE — the server-side save; see ItemAssemblySaveWorkflow.json.
const IA_SAVE_WORKFLOW_ID = "2098335576774463489";

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

    this.showLoading("Saving Item Assembly as draft...");

    const rawData = this.getValues();
    // sm_item_balance is the stock dialog's model, not a column on the table.
    const { sm_item_balance, ...data } = rawData;
    const pageStatus = data.page_status;

    let workflowResult;

    await this.runWorkflow(
      IA_SAVE_WORKFLOW_ID,
      { allData: data, saveAs: "Draft", pageStatus },
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
        workflowResult.data.message ||
          workflowResult.data.msg ||
          "Failed to save the Item Assembly",
      );
      return;
    }

    this.$message.success("Item Assembly saved as draft");
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
