// Save as Draft Button onClick Handler
const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  this.showLoading("Saving Sales Invoice...");
  let data = this.getValues();
  data.si_status = "Draft";

  await this.runWorkflow(
    "2029040374929154050",
    {
      data: data,
    },
    async (res) => {
      console.log("SI Data", res.data);
      this.$message.success("Sales Invoice saved successfully");
      closeDialog();
    },
    async (err) => {
      console.error(err);
      this.$message.error("Saving Sales Invoice failed");
      this.hideLoading();
    },
  );
})();
