// Recomputes table_item_source row state (picked_qty, remaining_qty,
// qty_to_pick, line_status) as a projection of all table_hu[*].temp_data.
//
// Call after every pick, unpack, or onMounted via:
//   await this.triggerEvent("PackingRecomputeSource");
//
// This is the single source of truth for picked/remaining math — no
// picked_qty counter is stored on the source row itself.

(async () => {
  try {
    const tableHu = this.getValue("table_hu") || [];
    const tableItemSource = this.getValue("table_item_source") || [];

    const pickedByLine = {};
    for (const hu of tableHu) {
      const entries = JSON.parse(hu.temp_data || "[]");
      for (const entry of entries) {
        const key = entry.line_item_id;
        if (!key) continue;
        pickedByLine[key] =
          (pickedByLine[key] || 0) + (Number(entry.total_quantity) || 0);
      }
    }

    const updates = {};
    const missingIdIndexes = [];
    for (let i = 0; i < tableItemSource.length; i++) {
      const row = tableItemSource[i];
      if (!row.id) missingIdIndexes.push(i);
      const total = Number(row.total_quantity) || 0;
      const picked = pickedByLine[row.id] || 0;
      const remaining = Math.max(0, total - picked);

      const status =
        picked === 0
          ? "Open"
          : picked < total
            ? "Partially Picked"
            : "Fully Picked";

      const currentQtyToPick = Number(row.qty_to_pick);
      const newQtyToPick =
        Number.isFinite(currentQtyToPick) &&
        currentQtyToPick > 0 &&
        currentQtyToPick <= remaining
          ? currentQtyToPick
          : remaining;

      updates[`table_item_source.${i}.picked_qty`] = picked;
      updates[`table_item_source.${i}.remaining_qty`] = remaining;
      updates[`table_item_source.${i}.qty_to_pick`] = newQtyToPick;
      updates[`table_item_source.${i}.line_status`] = status;
    }

    if (Object.keys(updates).length > 0) {
      await this.setData(updates);
    }

    if (missingIdIndexes.length > 0) {
      console.warn(
        `PackingRecomputeSource: ${missingIdIndexes.length} table_item_source row(s) have no 'id' — picked qty cannot be attributed. Rows: ${missingIdIndexes.join(", ")}. Fix the source data loader.`,
      );
    }
  } catch (error) {
    console.error("PackingRecomputeSource error:", error);
    this.$message.error(error.message || String(error));
  }
})();
