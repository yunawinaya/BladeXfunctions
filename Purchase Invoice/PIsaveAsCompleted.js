const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const submitForm = async (data) => {
  await this.runWorkflow(
    "2066342495378059266",
    {
      data: data,
    },
    (res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    },
    (error) => {
      this.hideLoading();
      console.error(error);
      const message = error.data?.msg || "An error occurred";
      this.$message.error(message);
    },
  );
};

(async () => {
  this.showLoading("Saving Purchase Invoice...");
  let data = this.getValues();

  data.pi_status = "Completed";
  data.posted_status = "Unposted";

  await submitForm(data);
})();
