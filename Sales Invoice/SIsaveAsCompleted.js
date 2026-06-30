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
      // Internal-trading signals come back on the SUCCESS channel (code 200) so
      // they do NOT trigger the platform's error toast.
      const out = (res && res.data) || {};

      if (Number(out.pi_confirm) === 411) {
        // Linked to an internal PO — confirm auto-creating the Purchase Invoice.
        this.hideLoading();
        const cleanMessage =
          out.msg ||
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

        if (proceed) {
          data.auto_pi_confirmed = true;
        } else {
          data.auto_pi_skip = true;
        }

        this.showLoading("Saving Sales Invoice...");
        await submitForm(data);
        return;
      }

      if (Number(out.pi_trigger_failed) === 1) {
        // SI completed, but the linked auto-PI creation failed (non-blocking).
        this.hideLoading();
        const cleanMessage =
          out.pi_message ||
          "The invoice was completed, but the linked Purchase Invoice could not be created automatically. Please create it manually.";

        await this.$alert(`${cleanMessage}`, "Purchase Invoice not created", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });
        closeDialog();
        return;
      }

      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
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
