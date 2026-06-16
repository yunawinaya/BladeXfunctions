// Stock Count — Save as Draft (workflow trigger)
// Calls combined SCsaveWorkflow.json with saveAs="Draft".

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
    this.showLoading();
    const data = this.getValues();
    const res = await runSCWorkflow("Draft", data);
    handleResult(res, "Saved as Draft");
  } catch (error) {
    this.hideLoading();
    console.error(error);
    this.$message.error((error && (error.message || error.msg)) || "Failed to save Draft");
  }
})();
