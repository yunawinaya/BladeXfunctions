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
      } else if (error.data?.code === 411) {
        // 411 - Internal trading: confirm auto-create Purchase Invoice
        const cleanMessage =
          error.data?.msg ||
          "This invoice is linked to an internal Purchase Order. Auto-create the Purchase Invoice in the buyer organization?";

        const proceed = await this.$confirm(
          `${cleanMessage}`,
          "Internal Trading – Auto-create Purchase Invoice",
          {
            confirmButtonText: "Yes, create PI",
            cancelButtonText: "No, save without",
            type: "info",
            dangerouslyUseHTMLString: true,
          },
        )
          .then(() => true)
          .catch(() => false);

        // Yes -> create PI in buyer org; No -> complete SI without auto-PI.
        if (proceed) {
          data.auto_pi_confirmed = true;
        } else {
          data.auto_pi_skip = true;
        }

        this.showLoading("Saving Sales Invoice...");
        await submitForm(data);
      } else if (error.data?.code === 413) {
        // 413 - SI completed, but linked auto-PI creation failed (non-blocking).
        // The save returned via the error path, so the post step above did NOT run.
        const cleanMessage =
          error.data?.msg ||
          "The invoice was completed, but the linked Purchase Invoice could not be created automatically.";

        await this.$alert(
          `${cleanMessage}<br><br>The invoice was completed but <strong>not posted</strong>. Please post it manually.`,
          "Purchase Invoice not created",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          },
        );
        // SI itself completed successfully — close the dialog.
        closeDialog();
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
