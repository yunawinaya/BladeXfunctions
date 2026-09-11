// ITEM_SAVE — the server-side save; see Item/ItemSaveWorkflow.json.
const ITEM_SAVE_WORKFLOW_ID = "2098251509145264130";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
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
    this.showLoading("Saving Item...");

    await this.validate();

    const data = this.getValues();
    data.is_post = 0;

    await this.runWorkflow(
      ITEM_SAVE_WORKFLOW_ID,
      { allData: data },
      () => {
        this.$message.success(
          `${this.isEdit ? "Update" : "Add"} successfully.`,
        );
        closeDialog();
      },
      (error) => {
        this.hideLoading();
        console.error(error);
        this.$message.error(
          error?.data?.msg || "An error occurred while saving the item.",
        );
      },
    );
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";
    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(error);
  }
})();
