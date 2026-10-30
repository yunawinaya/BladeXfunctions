// lotIatr_onClick_cancelRequest - Location Transfer form, onClick of button_cancel_request (IA transfer request, ENH-20261027-001): a
// Requested request cancelled by IA_TRANSFER_REQUEST CANCEL - state only, no stock call (nothing has moved before the dispatch); its
// Item Assembly can make a new request afterwards
const IATR_WF = "1985966508400201729"; // IA_TRANSFER_REQUEST
(async () => {
  const v = this.getValues();
  const s = (x) => (x === undefined || x === null ? "" : String(x)).trim();
  try {
    await this.$confirm("Cancel transfer request " + s(v.stock_movement_no) + "? Nothing has moved yet; its Item Assembly can make a new request afterwards.", "Cancel transfer request",
      { confirmButtonText: "Cancel Request", cancelButtonText: "Keep it", type: "warning" });
  } catch (e) {
    return;
  }
  this.showLoading("Cancelling the transfer request...");
  const params = { operation: "CANCEL", ia_id: s(v.source_ia_id), organization_id: s(v.organization_id), lot_id: s(v.id),
    idempotency_key: ("IATR:" + s(v.id) + ":cancel:" + Date.now()).slice(0, 128) };
  let res = null;
  try {
    res = await new Promise((resolve, reject) => this.runWorkflow(IATR_WF, params, (r) => resolve(r), (e) => reject(e)));
  } catch (e) {
    console.error("IA transfer request: cancel failed", e);
  }
  this.hideLoading();
  const r = (res && res.data) || {};
  if (s(r.code) === "200") {
    this.$message.success(s(r.message) || "Transfer request cancelled.");
    if (this.parentGenerateForm) {
      this.parentGenerateForm.$refs.SuPageDialogRef.hide();
      this.parentGenerateForm.refresh();
    }
    return;
  }
  this.$message.error(s(r.message) || "The transfer request could not be cancelled. Please try again.");
})();
