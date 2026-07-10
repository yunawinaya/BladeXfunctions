// Thin wrapper: the ONLY client-side responsibility is the interactive
// zero-return-qty confirm (a workflow can't prompt the user). All data
// transforms (drop zero lines, reserve created_return_qty on the GR/PO lines,
// doc no, status) live in PRTsaveWorkflow's saveAs: "Created" branch.
// A Created purchase return reserves the return quantity but moves no inventory.
const PRT_SAVE_WORKFLOW_ID = "2066433188188499969";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

(async () => {
  try {
    this.showLoading("Saving Purchase Return as Created...");
    const data = this.getValues();
    const lines = data.table_prt || [];

    // Block when nothing is being returned
    const totalQty = lines.reduce(
      (sum, item) => sum + (parseFloat(item.return_quantity) || 0),
      0,
    );
    if (totalQty === 0) {
      this.hideLoading();
      this.$message.error("Total return quantity is 0.");
      return;
    }

    // Interactive confirm for zero-qty lines (the workflow drops them on save)
    const zeroQtyArray = [];
    lines.forEach((item, index) => {
      if (!(parseFloat(item.return_quantity) > 0)) zeroQtyArray.push(`#${index + 1}`);
    });
    if (zeroQtyArray.length > 0) {
      try {
        await this.$confirm(
          `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
            zeroQtyArray.length > 1 ? "ve" : "s"
          } a zero return quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 return quantity.\nWould you like to proceed?`,
          "Zero Return Quantity Detected",
          {
            confirmButtonText: "OK",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: false,
          },
        );
      } catch {
        this.hideLoading();
        return; // user cancelled
      }
    }

    let workflowResult;
    await this.runWorkflow(
      PRT_SAVE_WORKFLOW_ID,
      { allData: data, saveAs: "Created", pageStatus: data.page_status },
      async (res) => {
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Purchase Return as Created:", err);
        this.hideLoading();
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    const code = workflowResult.data.code;
    if (code === "200" || code === 200 || workflowResult.data.success === true) {
      this.hideLoading();
      this.$message.success(
        workflowResult.data.message ||
          workflowResult.data.msg ||
          "Purchase Return saved as Created successfully",
      );
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.msg ||
          workflowResult.data.message ||
          "Failed to save Purchase Return as Created",
      );
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    this.$message.error(error.message || error || "Failed to save Purchase Return as Created");
  }
})();
