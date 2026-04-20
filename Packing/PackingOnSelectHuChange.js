// Single-select enforcement for table_hu rows.
// Paste into the `onSelectHuChange` handler slot (key e9skheri).
//
// When select_hu is toggled on a row:
//   - Turning ON  → clear select_hu on all other rows, write selected_hu_index = rowIndex.
//   - Turning OFF → if this row was the selected one, reset selected_hu_index to -1.
//
// Radio-like behavior implemented manually because the low-code switch column
// doesn't natively enforce single-select across rows.

(async () => {
  try {
    const { rowIndex, value } = arguments[0];
    const turnedOn = value === 1 || value === true;
    const tableHu = this.getValue("table_hu") || [];

    if (turnedOn) {
      const updates = { selected_hu_index: rowIndex };
      for (let i = 0; i < tableHu.length; i++) {
        if (i !== rowIndex && tableHu[i].select_hu) {
          updates[`table_hu.${i}.select_hu`] = 0;
        }
      }
      await this.setData(updates);
    } else {
      const currentSelected = Number(this.getValue("selected_hu_index"));
      if (currentSelected === rowIndex) {
        await this.setData({ selected_hu_index: -1 });
      }
    }
  } catch (error) {
    console.error("PackingOnSelectHuChange error:", error);
    this.$message.error(error.message || String(error));
  }
})();
