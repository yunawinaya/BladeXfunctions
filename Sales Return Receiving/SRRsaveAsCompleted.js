const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const submitForm = async (data) => {
  await this.runWorkflow(
    "2047250011014750209",
    {
      allData: data,
    },
    (res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    },
    async (error) => {
      this.hideLoading();
      console.error(error);
      if (
        error.data?.code === 401 ||
        error.data?.code === 402 ||
        error.data?.code === 403 ||
        error.data?.code === 405 ||
        error.data?.code === 406 ||
        error.data?.code === 407
      ) {
        // 401 - Mandatory fields missing
        // 402 - Available Return Qty < Return Qty
        // 403 - Total return qty == 0
        // 405 - Total line item == 0

        await this.$alert(`${error.data?.msg}`, "", {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      } else if (error.data?.code === 404) {
        // 403 - Line return qty == 0
        await this.$confirm(`${error.data?.msg}`, ``, {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving Sales Return Receiving cancelled.");
        });

        this.showLoading("Saving Sales Return Receiving...");
        data.filter_srr = "Yes";

        await submitForm(data);
      }
    },
  );
};

(async () => {
  this.showLoading("Saving Sales Return Receiving...");
  let data = this.getValues();

  data.srr_status = "Completed";
  data.filter_srr = "No";

  await submitForm(data);
})();
