// lotIatr_onClick_receive - Location Transfer form, onClick of button_receive (IA transfer request, ENH-20261027-001): production
// confirms the receipt, then the Completed save runs - LOT V2's COMPLETE of the dispatched request, as it was dispatched (an edited
// receipt is refused by the server)
(async () => {
  const v = this.getValues();
  const s = (x) => (x === undefined || x === null ? "" : String(x)).trim();
  try {
    await this.$confirm("Receive " + (s(v.stock_movement_no) || "this transfer request") + "? The dispatched materials move from In Transit into the production bin, as they were dispatched.",
      "Receive transfer request", { confirmButtonText: "Receive", cancelButtonText: "Not now", type: "warning" });
  } catch (e) {
    return;
  }
  await this.triggerEvent("lotV2_onClick_save_completed");
})();
