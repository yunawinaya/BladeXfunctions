// Stock Count — Save Review (workflow trigger)
// Calls combined SCsaveWorkflow.json with saveAs="Review". Confirmations
// (Recount / In Review / Create Adjustment) stay form-side and pass decision
// flags. On success, completes the draft Stock Adjustment created by the
// workflow via the SA-completion workflow (2032025505853816833).

(async () => {
  const SC_SAVE_WORKFLOW_ID = "2066808904123076610";
  const SA_COMPLETE_WORKFLOW_ID = "2032025505853816833"; // Stock Adjustment completion

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
  const runSCWorkflow = (data, flags) =>
    new Promise((resolve, reject) =>
      this.runWorkflow(
        SC_SAVE_WORKFLOW_ID,
        {
          allData: data,
          saveAs: "Review",
          pageStatus: data.page_status || "Edit",
          organizationId: getOrgId(),
          nickname: this.getVarGlobal("nickname"),
          adjustmentDate: new Date().toISOString().split("T")[0],
          proceedReview: (flags && flags.proceedReview) || "",
          createAdjustment: (flags && flags.createAdjustment) || "",
        },
        (res) => resolve(res),
        (err) => reject(err)
      )
    );
  const runSACompletion = (saRecord) =>
    new Promise((resolve, reject) =>
      this.runWorkflow(
        SA_COMPLETE_WORKFLOW_ID,
        { allData: saRecord, saveAs: "Completed", pageStatus: "Edit" },
        (res) => resolve(res),
        (err) => reject(err)
      )
    );

  try {
    const data = this.getValues();

    const items = (data.table_stock_count || []).filter((i) => i.line_status !== "Cancel");
    if (items.length === 0) {
      this.$message.error("No valid stock count items");
      return;
    }

    let proceedReview = "";
    let createAdjustment = "";

    const hasRecount = items.some((i) => i.line_status === "Recount");
    const allApproved = items.every(
      (i) => i.line_status === "Approved" || i.line_status === "Adjusted"
    );

    // Confirm: Recount items -> review status Recount
    if (hasRecount) {
      const n = items.filter((i) => i.line_status === "Recount").length;
      const r = await this.$confirm(
        `There are <strong>${n} item(s)</strong> that need to be recounted.<br><br>Review status will be set to <strong>'Recount'</strong>.<br><br>Do you want to proceed?`,
        "Recount Items Warning",
        { confirmButtonText: "Proceed", cancelButtonText: "Cancel", type: "warning", dangerouslyUseHTMLString: true }
      ).catch(() => null);
      if (r !== "confirm") return;
      proceedReview = "Yes";
    } else if (!allApproved) {
      // Confirm: pending items -> review status In Review
      const n = items.filter(
        (i) => i.line_status !== "Approved" && i.line_status !== "Adjusted" && i.line_status !== "Recount"
      ).length;
      const r = await this.$confirm(
        `There are <strong>${n} item(s)</strong> that are not approved.<br><br>Review status will be set to <strong>'In Review'</strong>.<br><br>Do you want to proceed?`,
        "Pending Items Warning",
        { confirmButtonText: "Proceed", cancelButtonText: "Cancel", type: "warning", dangerouslyUseHTMLString: true }
      ).catch(() => null);
      if (r !== "confirm") return;
      proceedReview = "Yes";
    }

    // Confirm: create stock adjustment for approved items
    const approved = items.filter(
      (i) => i.review_status === "Approved" && i.line_status !== "Adjusted"
    );
    if (approved.length && !allApproved) {
      const r = await this.$confirm(
        `There are <strong>${approved.length} approved item(s)</strong> ready for adjustment.<br><br>Do you want to create Stock Adjustment and mark them as 'Adjusted'?`,
        "Create Stock Adjustment",
        { confirmButtonText: "Yes, Create Adjustment", cancelButtonText: "No, Skip", type: "info", dangerouslyUseHTMLString: true }
      ).catch(() => null);
      createAdjustment = r === "confirm" ? "Yes" : "";
    } else if (approved.length && allApproved) {
      createAdjustment = "Yes";
    }

    this.showLoading();
    const res = await runSCWorkflow(data, { proceedReview, createAdjustment });
    const r = (res && res.data) || {};
    const code = r.code;
    if ((code && code !== 200 && code !== "200") || r.success === false) {
      this.hideLoading();
      this.$message.error(r.msg || r.message || "Failed to save Review. Please contact support.");
      return;
    }

    // Draft Stock Adjustment was created -> complete it (move inventory)
    const saId = r.stockAdjustmentId;
    if (saId) {
      const sa = await db
        .collection("stock_adjustment")
        .where({ id: saId })
        .get()
        .then((x) => (x.data && x.data[0]) || null)
        .catch(() => null);
      if (sa) {
        sa.id = saId;
        try {
          await runSACompletion(sa);
        } catch (e) {
          console.error("Stock Adjustment completion failed:", e);
        }
      }
    }

    this.$message.success(r.message || r.msg || "Review saved");
    closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error(error);
    this.$message.error((error && (error.message || error.msg)) || "Failed to save Review");
  }
})();
