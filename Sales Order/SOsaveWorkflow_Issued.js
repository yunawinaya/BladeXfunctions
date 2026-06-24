const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const submitForm = async (data) => {
  await this.runWorkflow(
    "1988908545345945602",
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
        data.need_cl = "not required";

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
      } else if (error.data?.code === 405) {
        // 405 - Create SI with 0 total amount
        await this.$confirm(`${error.data.msg}`, `0 total amount detected`, {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving sales order cancelled.");
        });
        this.showLoading("Saving Sales Order...");
        data.create_si = "Yes";

        await submitForm(data);
      }
    },
  );
};

(async () => {
  this.showLoading("Saving Sales Order...");
  const data = this.getValues();
  let entry = data;

  for (const [index, soLineItem] of entry.table_so.entries()) {
    await this.validate(`table_so.${index}.so_item_price`);
  }

  entry.so_status =
    entry.so_status === "Processing" ? entry.so_status : "Issued";
  if (!entry.previous_status || entry.previous_status === "Draft") {
    entry.production_status = "Not Created";
  }

  await submitForm(entry);
})();
