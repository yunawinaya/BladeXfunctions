// Stock Count — Save Stock Count / counting completion (workflow trigger)
// Calls combined SCsaveWorkflow.json with saveAs="Stock Count".
// Confirmation (uncounted items -> In Progress) stays form-side here.

(async () => {
  const SC_SAVE_WORKFLOW_ID = "2066808904123076610";

  const closeDialog = () => {
    if (this.parentGenerateForm) {
      this.parentGenerateForm.$refs.SuPageDialogRef.hide();
      this.parentGenerateForm.refresh();
      this.hideLoading();
    }
  };
  const getOrgId = () => {
    let o = this.getVarGlobal("deptParentId");
    if (o === "0") o = this.getVarSystem("deptIds").split(",")[0];
    return o;
  };
  const runSCWorkflow = (saveAs, data) =>
    new Promise((resolve, reject) =>
      this.runWorkflow(
        SC_SAVE_WORKFLOW_ID,
        {
          allData: data,
          saveAs,
          pageStatus: data.page_status,
          organizationId: getOrgId(),
          nickname: this.getVarGlobal("nickname"),
          adjustmentDate: new Date().toISOString().split("T")[0],
          proceedReview: "",
          createAdjustment: "",
        },
        (res) => resolve(res),
        (err) => reject(err)
      )
    );
  const handleResult = (res, successMsg) => {
    const r = (res && res.data) || {};
    const code = r.code;
    if ((code && code !== 200 && code !== "200") || r.success === false) {
      this.hideLoading();
      this.$message.error(r.msg || r.message || "Failed to save. Please contact support.");
      return false;
    }
    this.$message.success(r.message || r.msg || successMsg);
    closeDialog();
    return true;
  };

  try {
    const data = this.getValues();

    const approvedItems = this.models["approvedItems"] || [];
    let rows = data.table_stock_count || [];
    if (approvedItems.length) rows = [...rows, ...approvedItems];

    // Confirm: not all line items counted -> status will be In Progress
    const unlocked = rows.filter((i) => i.is_counted === 0 || !i.is_counted);
    if (unlocked.length) {
      const r = await this.$confirm(
        `Not all line items are counted. <br><br><strong>${unlocked.length} item(s)</strong> are not counted.<br><br>Stock Count status will be set to <strong>'In Progress'</strong>.<br><br>Do you want to proceed?`,
        "Uncounted Line Items Warning",
        { confirmButtonText: "Proceed", cancelButtonText: "Cancel", type: "warning", dangerouslyUseHTMLString: true }
      ).catch(() => null);
      if (r !== "confirm") return;
    }

    this.showLoading();
    data.approvedItems = approvedItems; // workflow merges these into table_stock_count
    const res = await runSCWorkflow("Stock Count", data);
    handleResult(res, "Stock Count saved");
  } catch (error) {
    this.hideLoading();
    console.error(error);
    this.$message.error((error && (error.message || error.msg)) || "Failed to save Stock Count");
  }
})();
