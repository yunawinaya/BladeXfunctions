// Initializes a newly-added table_hu row as a Generated HU.
// Paste into the `onTableHuRowAdd` handler slot (key 6ig0cg3h).
//
// Field setup:
//   hu_row_type   = "generated"   — distinguishes from Locked rows sourced from table_hu_source
//   temp_data     = "[]"          — empty pack list (JSON string)
//   item_count    = 0             — rollup
//   total_quantity = 0            — rollup
//   hu_status     = "Unpacked"    — initial pack status
//   handling_no   — left blank; backend workflow fills on save (GR pattern).

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;

    await this.setData({
      [`table_hu.${rowIndex}.hu_row_type`]: "generated",
      [`table_hu.${rowIndex}.temp_data`]: "[]",
      [`table_hu.${rowIndex}.item_count`]: 0,
      [`table_hu.${rowIndex}.total_quantity`]: 0,
      [`table_hu.${rowIndex}.hu_status`]: "Unpacked",
    });
  } catch (error) {
    console.error("PackingOnTableHuRowAdd error:", error);
    this.$message.error(error.message || String(error));
  }
})();
