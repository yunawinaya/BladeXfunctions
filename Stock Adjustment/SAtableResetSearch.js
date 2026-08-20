(async () => {
  try {
    const rowKey = (row) =>
      `${row.location_id || "no_location"}-${
        row.serial_number || "no_serial"
      }-${row.batch_id || "no_batch"}`;

    const hasStock = (record) =>
      (record.block_qty && record.block_qty > 0) ||
      (record.reserved_qty && record.reserved_qty > 0) ||
      (record.unrestricted_qty && record.unrestricted_qty > 0) ||
      (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
      (record.intransit_qty && record.intransit_qty > 0) ||
      (record.balance_quantity && record.balance_quantity > 0) ||
      (record.sa_quantity && record.sa_quantity !== 0);

    const rawString = this.getValue("sa_item_balance.table_item_balance_raw");
    const tableItemBalanceRaw = rawString ? JSON.parse(rawString) : [];

    if (
      !Array.isArray(tableItemBalanceRaw) ||
      tableItemBalanceRaw.length === 0
    ) {
      await this.setData({ "sa_item_balance.search_batch": "" });
      return;
    }

    // Same sync-then-swap as the search: whatever the user typed on the rows
    // currently on screen survives the restore.
    const visibleRows =
      this.getValue("sa_item_balance.table_item_balance") || [];
    const visibleMap = new Map(visibleRows.map((row) => [rowKey(row), row]));

    tableItemBalanceRaw.forEach((row) => {
      const visibleRow = visibleMap.get(rowKey(row));
      if (!visibleRow) return;
      row.category = visibleRow.category;
      row.sa_quantity = visibleRow.sa_quantity;
      row.movement_type = visibleRow.movement_type;
      row.remarks = visibleRow.remarks;
    });

    await this.setData({
      "sa_item_balance.table_item_balance_raw":
        JSON.stringify(tableItemBalanceRaw),
      "sa_item_balance.table_item_balance": tableItemBalanceRaw.filter(hasStock),
      "sa_item_balance.search_batch": "",
    });
  } catch (error) {
    console.error("Unexpected error in reset batch search handler:", error);
  }
})();
