// lotIatr_onClick_dispatch - Location Transfer form, onClick of button_dispatch (IA transfer request, ENH-20261027-001): the warehouse
// confirms the move and its posting date (the Issue Date), then the In Progress save runs - LOT V2's dispatch of a request (STAGE from
// Requested); every check (full picks, the Item Assembly unchanged) is the server's
(async () => {
  const v = this.getValues();
  const s = (x) => (x === undefined || x === null ? "" : String(x)).trim();
  const lines = (Array.isArray(v.stock_movement) ? v.stock_movement : []).length;
  const date = s(v.issue_date).slice(0, 10);
  try {
    await this.$confirm("Dispatch " + (s(v.stock_movement_no) || "this transfer request") + " now? Its " + lines + " line(s) move from the picked bins to In Transit at the production bin, posted on " +
      (date || "the Issue Date") + ". Change the Issue Date first if the posting date is different.", "Dispatch transfer request",
    { confirmButtonText: "Dispatch", cancelButtonText: "Not now", type: "warning" });
  } catch (e) {
    return;
  }
  await this.triggerEvent("lotV2_onClick_save_inprogress");
})();
