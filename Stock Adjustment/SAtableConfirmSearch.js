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

    const value = (
      this.getValue("sa_item_balance.search_batch") || ""
    ).trim();

    const rawString = this.getValue("sa_item_balance.table_item_balance_raw");
    const tableItemBalanceRaw = rawString ? JSON.parse(rawString) : [];
    if (!Array.isArray(tableItemBalanceRaw) || tableItemBalanceRaw.length === 0)
      return;

    // Carry the visible rows' edits back into the full set before swapping the
    // table, so searching never drops a quantity the user already typed.
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

    // Empty search behaves like Reset — back to the rows with stock.
    if (!value) {
      await this.setData({
        "sa_item_balance.table_item_balance_raw":
          JSON.stringify(tableItemBalanceRaw),
        "sa_item_balance.table_item_balance":
          tableItemBalanceRaw.filter(hasStock),
      });
      return;
    }

    // Batch numbers live on the batch record, not on the balance row. Resolve
    // them once per dialog session instead of on every dialog open.
    let batchNoMap = this.models["sa_batch_no_map"];
    if (!batchNoMap) {
      const batchIds = [
        ...new Set(
          tableItemBalanceRaw.map((row) => row.batch_id).filter(Boolean),
        ),
      ];
      batchNoMap = {};
      if (batchIds.length > 0) {
        const resBatch = await db
          .collection("batch")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [{ prop: "id", operator: "in", value: batchIds }],
            },
          ])
          .get();
        (resBatch.data || []).forEach((batch) => {
          batchNoMap[batch.id] = batch.batch_number || "";
        });
      }
      this.models["sa_batch_no_map"] = batchNoMap;
    }

    const keyword = value.toLowerCase();
    const matchedRows = tableItemBalanceRaw.filter((row) =>
      (batchNoMap[row.batch_id] || "").toLowerCase().includes(keyword),
    );

    if (matchedRows.length === 0) {
      if (this.$message) {
        this.$message.error(`No batch found matching "${value}".`);
      }
      return;
    }

    await this.setData({
      "sa_item_balance.table_item_balance_raw":
        JSON.stringify(tableItemBalanceRaw),
      "sa_item_balance.table_item_balance": matchedRows,
    });
  } catch (error) {
    console.error("Unexpected error in search batch handler:", error);
  }
})();
