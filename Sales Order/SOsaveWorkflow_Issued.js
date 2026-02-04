const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const submitForm = async (data) => {
  this.submit({
    validate: false,
  })
    .then((res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    })
    .catch(async (error) => {
      this.hideLoading();
      console.error(error);
      if (error.data?.code === 402) {
        // 402 - Credit limit block
        const cleanMessage = error.data?.msg.replace(/^Block - /, "");

        await this.$alert(`${cleanMessage}`, "", {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      } else if (error.data?.code === 403) {
        // 403 - Credit limit override
        const cleanMessage = error.data?.msg.replace(/^Override - /, "");
        await this.$confirm(`${cleanMessage}`, ``, {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving purchase order cancelled.");
        });

        this.showLoading("Saving Sales Order...");
        this.models["need_cl"] = "not required";

        await submitForm(data);
      } else if (error.data?.code === 404) {
        // 404 - Existing Draft GD/SI
        await this.$confirm(
          `${error.data.msg}<br><br><strong>Do you wish to continue?</strong>`,
          `Existing draft records detected`,
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "error",
            dangerouslyUseHTMLString: true,
          },
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving sales order cancelled.");
        });
        this.showLoading("Saving Sales Order...");
        await this.runWorkflow(
          "2000407100609073154",
          { so_id: data.id },
          async (res) => {
            await submitForm(data);
          },
          (error) => {
            this.hideLoading();
            this.$message.error(error || error.toString());
            console.error(error);
          },
        );
      }
    });
};

(async () => {
  this.showLoading("Saving Sales Order...");
  const data = this.getValues();

  for (const [index, soLineItem] of data.table_so.entries()) {
    await this.validate(`table_so.${index}.so_item_price`);
  }

  this.models["so_status"] = "Issued";
  this.models["production_status"] = "Not Created";
  console.log("this.models", this.models);

  await submitForm(data);
})();
