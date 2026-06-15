const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  this.showLoading("Posting Purchase Invoice...");
  const data = this.getValues();

  await this.runWorkflow(
    "2066371159167709186",
    {
      pi_ids: [data.id],
      acc_integration_type: data.acc_integration_type,
    },
    async (res) => {
      console.log("res", res.data);
      this.$message.success("Purchase Invoice posted successfully");
      this.hideLoading();
    },
    async (err) => {
      console.error(err);
      this.$message.error("Posting Purchase Invoice failed");
      this.hideLoading();
    },
  );

  closeDialog();
})();
