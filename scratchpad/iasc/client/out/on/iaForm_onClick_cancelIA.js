// onClick_cancelIA - Small Cycle (scratchpad/iasc): RES-01 Cancel (user 10-22, like Goods Delivery). A saved Created IA only: asks
// first, then IA_HOLD CANCEL releases everything the IA holds and only then sets it Cancelled; a release that does not finish leaves it
// Created (Needs review) and says so. One cancel per click (the form's ia_submitting flag).
const RES_HOLD = "2112752274794217473"; // IA_HOLD
(async () => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  if ((this.models["_data"] || {}).ia_submitting === 1) {
    this.$message.warning("Workflow is already in progress. Please wait.");
    return;
  }
  const v = this.getValues();
  const id = s(v.id);
  const org = s(v.organization_id);
  if (!/^[1-9][0-9]{0,19}$/.test(RES_HOLD) || !/^[0-9]{1,20}$/.test(id) || !/^[0-9]{1,20}$/.test(org) || s(v.item_assembly_status) !== "Created") {
    this.$message.error("Only a saved Created Item Assembly can be cancelled.");
    return;
  }
  const label = s(v.stock_movement_no) || "this Item Assembly";
  try {
    await this.$confirm(`Cancel Item Assembly ${label}? Its reserved materials are released and it can no longer be changed.`, "Cancel Item Assembly", {
      confirmButtonText: "Cancel it",
      cancelButtonText: "Keep it",
      type: "warning",
    });
  } catch (e) {
    return;
  }
  this.models["_data"] = { ...this.models["_data"], ia_submitting: 1 };
  this.showLoading("Cancelling...");
  let d = null;
  try {
    const res = await new Promise((resolve, reject) => {
      const p = this.runWorkflow(RES_HOLD, { ia_id: id, organization_id: org, operation: "CANCEL", source: "FORM" }, (r) => resolve(r), (e) => reject(e));
      if (p && typeof p.then === "function") p.then((r) => resolve(r), (e) => reject(e));
    });
    d = (res && res.data) || null;
  } catch (e) {
    console.error("RES-01: the cancel failed", e);
  } finally {
    this.hideLoading();
    this.models["_data"] = { ...this.models["_data"], ia_submitting: 0 };
  }
  let r = null;
  try {
    r = d && s(d.result_json) ? JSON.parse(s(d.result_json)) : null;
  } catch (e) {
    r = null;
  }
  if (d && s(d.code) === "200" && r && r.cancelled === true) {
    this.$message.success(`Item Assembly ${label} is cancelled; its reserved materials are released.`);
    if (this.parentGenerateForm) {
      this.parentGenerateForm.$refs.SuPageDialogRef.hide();
      this.parentGenerateForm.refresh();
    }
    return;
  }
  this.$message.error(s(d && d.message) || "The Item Assembly could not be cancelled now: try again.");
})();
