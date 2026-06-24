const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  this.showLoading("Saving Purchase Orders...");
  this.models["po_status"] = "Draft";
  console.log("this.models", this.models);

  const {
    draft_status,
    issued_status,
    processing_status,
    completed_status,
    cancelled_status,
    ...cleanData
  } = this.models;

  await this.runWorkflow(
    "2069257894280118274",
    { allData: cleanData },
    (res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    },
    (err) => {
      this.hideLoading();
      this.$message.error(err || err.toString());
      console.error(err);
    },
  );
})();
