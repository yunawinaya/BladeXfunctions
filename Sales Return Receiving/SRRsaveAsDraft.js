// Save as Draft Button onClick Handler
const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  this.showLoading("Saving Sales Return Receiving..");
  let data = this.getValues();
  data.srr_status = "Draft";
  data.filter_srr = "No";

  await this.runWorkflow(
    "2047250011014750209",
    {
      allData: data,
    },
    async (res) => {
      console.log("SR Data", res.data);
      this.$message.success("Sales Return Receiving saved successfully");
      closeDialog();
    },
    async (err) => {
      console.error(err);
      this.$message.error("Saving Sales Return Receiving failed");
      this.hideLoading();
      if (err.data?.code === 401) {
        // 401 - Mandatory fields missing

        await this.$alert(`${err.data?.msg}`, "", {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      }
    },
  );
})();
