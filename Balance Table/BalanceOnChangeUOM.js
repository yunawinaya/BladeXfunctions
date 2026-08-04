// UOM tab > "Item Balance": select `balance_uom` (hg3nzlbr) onChange -> refresh grid
// `table_balance_uom` (jyta6m4r), which is backed by the BALANCE_UOM_CONVERSION workflow.
(async () => {
  if (!this.getValue("material_id")) return;

  try {
    // Let the select's model commit before the grid re-reads {{value:balance_uom}};
    // without it the refresh can race and re-query with the PREVIOUS uom.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const grid = await this.getComponent("balance_dialog.table_balance_uom");
    grid?.refreshChange();
  } catch (error) {
    console.error("[balance_uom onChange] refresh failed", error);
  }
})();
