// onChange of a line's Required - Small Cycle (scratchpad/iasc): RF-09 (BA 10-22). A Required typed by hand is the user's: the line's
// required_manual flag ("1") keeps it through re-scales (IA_SAVE never makes it follow the BOM reference, even when it equals the old one);
// emptied, the line follows the reference again ("")
const args = arguments[0] || {};
(() => {
  const i = args.rowIndex;
  if (!Number.isInteger(i) || i < 0) return;
  const v = args.value;
  const flag = v === undefined || v === null || String(v).trim() === "" ? "" : "1";
  const row = ((this.getValues() || {}).stock_movement || [])[i] || {};
  if (String(row.required_manual === undefined || row.required_manual === null ? "" : row.required_manual) === flag) return;
  this.setData({ [`stock_movement.${i}.required_manual`]: flag });
})();
