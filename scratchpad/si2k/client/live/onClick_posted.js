const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  this.showLoading("Posting Sales Invoice...");
  const data = this.getValues();

  await this.runWorkflow(
    "2029464545187823617",
    {
      si_ids: [data.id],
      acc_integration_type: data.acc_integration_type,
    },
    async (res) => {
      console.log("res", res.data);
      this.$message.success("Sales Invoice posted successfully");
      this.hideLoading();
    },
    async (err) => {
      console.error(err);
      this.$message.error("Posting Sales Invoice failed");
      this.hideLoading();
    },
  );

  closeDialog();
})();
