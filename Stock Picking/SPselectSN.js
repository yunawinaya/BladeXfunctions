(async () => {
  try {
    const selectedSN = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    const changedRow = arguments[0].row;
    console.log("Selected SN", selectedSN);

    const pickedQty = selectedSN.length > 0 ? selectedSN.length : 0;

    // arguments[0].rowIndex is a position in the TOP-LEVEL array, so it does not
    // address a bundle's items -- they sit under their bundle row as `children`.
    // The row is located by fm_key instead, which identifies a row wherever it
    // sits in the tree, with id and then the top-level index as fallbacks, and
    // the path it is addressed by is built from where it was found.
    const resolveRow = (allRows, changed, idx) => {
      const keys = [];
      if (changed && changed.fm_key != null)
        keys.push(["fm_key", String(changed.fm_key)]);
      if (changed && changed.id != null) keys.push(["id", String(changed.id)]);

      for (const [field, want] of keys) {
        for (let i = 0; i < allRows.length; i++) {
          const parent = allRows[i];
          if (parent && parent[field] != null && String(parent[field]) === want) {
            return { row: parent, path: `table_picking_items.${i}` };
          }

          const kids = Array.isArray(parent && parent.children)
            ? parent.children
            : [];

          for (let j = 0; j < kids.length; j++) {
            if (kids[j] && kids[j][field] != null && String(kids[j][field]) === want) {
              return {
                row: kids[j],
                path: `table_picking_items.${i}.children.${j}`,
              };
            }
          }
        }
      }

      const fallback = allRows[idx];
      return fallback
        ? { row: fallback, path: `table_picking_items.${idx}` }
        : null;
    };

    const rows = this.getValue("table_picking_items") || [];
    const resolved = resolveRow(rows, changedRow, rowIndex);
    if (!resolved) return;

    // Live net weight from the picked qty (the workflow recomputes it
    // authoritatively on save).
    const { row, path } = resolved;
    const weightConversion = parseFloat(row.weight_conversion) || 0;

    await this.setData({
      [`${path}.picked_qty`]: pickedQty,
      [`${path}.net_weight`]:
        Math.round((pickedQty * weightConversion) * 1000) / 1000,
    });
  } catch (error) {
    console.error("Unexpected error in selected SN handler:", error);
  }
})();
