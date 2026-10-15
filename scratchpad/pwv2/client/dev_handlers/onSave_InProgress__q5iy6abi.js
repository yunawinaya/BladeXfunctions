const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

// Saving as In Progress is the same operation as saving as Completed: the workflow
// works out to_status from the line statuses it computes, so a partial putaway lands
// on In Progress and a full one on Completed. The difference between the two buttons
// is only that Completed additionally refuses a partial putaway of a handling unit.
//
// This used to be a 68 KB client-side reimplementation of that workflow which walked
// table_putaway_item top level only. With an item bundle that meant the bundle row --
// which holds no stock -- was booked as if it were a real line, none of the items
// under it moved at all, and their putaway_qty was left behind for the next Complete
// to post a second time.
(async () => {
  try {
    this.showLoading("Saving Putaway as In Progress...");

    const data = this.getValues();
    const arrayData = Array.isArray(data) ? data : [data];

    let workflowResult;

    await this.runWorkflow(
      "2031190421336195074",
      {
        arrayData: arrayData,
        saveAs: "In Progress",
        pageStatus: data.page_status,
        confirmed_by: this.getVarGlobal("nickname"),
      },
      async (res) => {
        console.log("Putaway saved successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Putaway:", err);
        this.hideLoading();
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    if (
      workflowResult.data.code === "400" ||
      workflowResult.data.code === 400 ||
      workflowResult.data.success === false
    ) {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.msg ||
          workflowResult.data.message ||
          "Failed to save Putaway",
      );
      return;
    }

    if (
      workflowResult.data.code === "200" ||
      workflowResult.data.code === 200 ||
      workflowResult.data.success === true
    ) {
      this.hideLoading();
      this.$message.success(
        workflowResult.data.message ||
          workflowResult.data.msg ||
          "Putaway saved successfully",
      );
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    this.$message.error(error.message || "Failed to save Putaway");
  }
})();