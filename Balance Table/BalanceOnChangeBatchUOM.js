// UOM tab > "Item Batch Balance": select `batch_balance_uom` (wqhzdo1j) onChange -> refresh
// grid `table_batch_balance_uom` (w3o8eedj), backed by the BALANCE_UOM_CONVERSION workflow.
(async () => {
  if (!this.getValue("material_id")) return;

  try {
    // Let the select's model commit before the grid re-reads {{value:batch_balance_uom}};
    // without it the refresh can race and re-query with the PREVIOUS uom.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const grid = await this.getComponent("balance_dialog.table_batch_balance_uom");
    grid?.refreshChange();
  } catch (error) {
    console.error("[batch_balance_uom onChange] refresh failed", error);
  }
})();
