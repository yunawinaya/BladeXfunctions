const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const saveWorkflow = async (data) => {
  await this.runWorkflow(
    "2069257894280118274",
    { allData: data },
    (res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    },
    async (error) => {
      this.hideLoading();
      console.error(error);
      if (error.data?.code === 402) {
        await this.$confirm(
          `${error.data.msg}<br><br><strong>Do you wish to continue?</strong>`,
          `Existing draft records detected`,
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "error",
            dangerouslyUseHTMLString: true,
          },
        ).catch(async () => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving purchase order cancelled.");
        });

        this.showLoading("Saving Purchase Orders...");
        await this.runWorkflow(
          "1998576990124572673",
          { po_id: data.id },
          async (res) => {
            await saveWorkflow(data);
          },
          (error) => {
            this.hideLoading();
            this.$message.error(error || error.toString());
            console.error(error);
          },
        );
      }
    },
  );
};

(async () => {
  this.showLoading("Saving Purchase Orders...");
  const data = this.getValues();
  let entry = data;
  console.log("data", data);
  for (const [index, lineItem] of data.table_po.entries()) {
    await this.validate(`table_po.${index}.unit_price`);
  }

  entry.po_status = "Issued";

  const {
    draft_status,
    issued_status,
    processing_status,
    completed_status,
    cancelled_status,
    ...cleanData
  } = entry;

  await saveWorkflow(cleanData);
})();
