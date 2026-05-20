(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const category_from = arguments[0].value;

    // Auto-flip the pair: Unrestricted ↔ Blocked. Only fires for the standard
    // pair; other categories don't get an auto-target.
    let category_to;
    if (category_from === "Unrestricted") category_to = "Blocked";
    else if (category_from === "Blocked") category_to = "Unrestricted";

    // Loop guard: setData on category_to triggers CATcategoryToOnChange, which
    // setData's category_from back. If both fields are already aligned, skip
    // the write so the chain terminates on the first pass.
    if (category_to !== undefined) {
      const currentTo = await this.getValue(
        `sm_item_balance.table_item_balance.${rowIndex}.category_to`,
      );
      if (currentTo !== category_to) {
        await this.setData({
          [`sm_item_balance.table_item_balance.${rowIndex}.category_to`]:
            category_to,
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
        item.category_from = category_from;
        if (category_to !== undefined) item.category_to = category_to;
      }
    });

    await this.setData({
      "sm_item_balance.table_item_balance_raw":
        JSON.stringify(tableItemBalanceRaw),
    });
  } catch (error) {
    console.error("Unexpected error in category_from change handler:", error);
  }
})();
