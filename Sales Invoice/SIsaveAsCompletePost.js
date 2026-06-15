const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const submitForm = async (data) => {
  await this.runWorkflow(
    "2029040374929154050",
    {
      data: data,
    },
    async (res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      console.log("res", res.data);
      await this.runWorkflow(
        "2029464545187823617",
        {
          si_ids: [res.data.id],
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
    },
    async (error) => {
      this.hideLoading();
      console.error(error);
      if (error.data?.code === 408) {
        // 408 - Credit limit block
        const cleanMessage = error.data?.msg.replace(/^Block - /, "");

        await this.$alert(`${cleanMessage}`, "", {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      } else if (error.data?.code === 409) {
        // 409 - Credit limit override
        const cleanMessage = error.data?.msg.replace(/^Override - /, "");
        await this.$confirm(`${cleanMessage}`, ``, {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving sales invoice cancelled.");
        });

        this.showLoading("Saving Sales Invoice...");
        data.need_cl = "not required";

        await submitForm(data);
      }
    },
  );
};

(async () => {
  this.showLoading("Saving Sales Invoice...");
  let data = this.getValues();

  data.si_status = "Completed";
  data.posted_status = "Unposted";

  await submitForm(data);
})();
