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
    async (res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      console.log("res", res.data);
      await this.runWorkflow(
        "2066371159167709186",
        {
          pi_ids: [res.data.id],
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
