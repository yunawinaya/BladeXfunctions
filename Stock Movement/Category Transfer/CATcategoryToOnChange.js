(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const category_to = arguments[0].value;

    // Auto-flip the pair: Unrestricted ↔ Blocked. Only fires for the standard
    // pair; other categories don't get an auto-source.
    let category_from;
    if (category_to === "Unrestricted") category_from = "Blocked";
    else if (category_to === "Blocked") category_from = "Unrestricted";

    // Loop guard: setData on category_from triggers CATcategoryFromOnChange,
    // which setData's category_to back. If both fields are already aligned,
    // skip the write so the chain terminates on the first pass.
    if (category_from !== undefined) {
      const currentFrom = await this.getValue(
        `sm_item_balance.table_item_balance.${rowIndex}.category_from`,
      );
      if (currentFrom !== category_from) {
        await this.setData({
          [`sm_item_balance.table_item_balance.${rowIndex}.category_from`]:
            category_from,
        });
      }
    }

    // Serial-number rows have a parallel raw-table mirror for the filter reset.
    // Sync both fields there too when applicable.
    const serialNumber = await this.getValue(
      `sm_item_balance.table_item_balance.${rowIndex}.serial_number`,
    );
    if (!serialNumber || serialNumber === "") return;

    const rawStr = await this.getValue("sm_item_balance.table_item_balance_raw");
    if (!rawStr) return;
    const tableItemBalanceRaw = JSON.parse(rawStr);

    tableItemBalanceRaw.forEach((item) => {
      if (item.serial_number === serialNumber) {
        item.category_to = category_to;
        if (category_from !== undefined) item.category_from = category_from;
      }
    });

    await this.setData({
      "sm_item_balance.table_item_balance_raw":
        JSON.stringify(tableItemBalanceRaw),
    });
  } catch (error) {
    console.error("Unexpected error in category_to change handler:", error);
  }
})();
