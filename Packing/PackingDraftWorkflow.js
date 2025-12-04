const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading("Drafting Packing...");

    const data = this.getValues();
    console.log("data", data);

    let workflowResult;

    await this.runWorkflow(
      "1994279909883895810",
      { entry: data, saveAs: "Draft" },
      async (res) => {
        console.log("Packing drafted successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to draft Packing:", err);
        workflowResult = err;
      }
    );

    if (
      workflowResult.data.errorStatus &&
      workflowResult.data.errorStatus !== ""
    ) {
      if (workflowResult.data.errorStatus === "missingFields") {
        this.hideLoading();
        this.$message.error(
          `Validation errors: ${workflowResult.data.message}`
        );
        return;
      }

      // Handle any other error status
      if (workflowResult.data.message) {
        this.hideLoading();
        this.$message.error(workflowResult.data.message);
        return;
      }
    }

    if (workflowResult.data.status === "Success") {
      const entry = workflowResult.data.entry;
      console.log("entry", entry);

      if (entry.page_status === "Add") {
        const finalData = await db.collection("packing").add(entry);
        console.log("Added successfully:", finalData);
      } else if (entry.page_status === "Edit") {
        const updatedData = await db
          .collection("packing")
          .doc(entry.id)
          .update(entry);
        console.log("Updated successfully:", updatedData);
      }
      this.$message.success("Packing drafted successfully");
      this.hideLoading();
      closeDialog();
    }
  } catch (error) {
    console.error("Error:", error);
    this.$message.error("Failed to draft Packing");
    this.hideLoading();
    closeDialog();
  }
})();
