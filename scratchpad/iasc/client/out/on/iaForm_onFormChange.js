// onFormChange - Small Cycle (scratchpad/iasc): RES-01 MIN-06 (BA 10-22). A Created IA's reservation row says when the form holds
// unsaved changes to what the reservation reads (its figures are the last save's), and drops it when they match again. The newest change
// checks 400 ms later (a burst, e.g. an auto-allocation, costs one check); nothing to do for an IA whose row has no fingerprint.
// RES-01 MIN-06 (BA 10-22): what the reservation reads from the form as one cheap string - each line's id, item, unit and picks (hashed),
// and the plant; Required and the display columns are left out (the open itself fills them)
const RES_DIRTY = " · Unsaved changes: not reserved until saved.";
const resHash = (t) => {
  const text = t === undefined || t === null ? "" : typeof t === "string" ? t : JSON.stringify(t);
  let x = 2166136261;
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619) >>> 0;
  return x.toString(36);
};
const resFp = (v) => (Array.isArray(v && v.stock_movement) ? v.stock_movement : [])
  .map((l) => [l && l.id, l && l.item_selection, l && l.quantity_uom].map((x) => (x === undefined || x === null ? "" : String(x))).join("|") + "|" +
    resHash(l && l.temp_qty_data) + "|" + resHash(l && l.temp_hu_data))
  .join(";") + "#" + String((v && v.issuing_operation_faci) || "");
(() => {
  const st = this.models["_data"] || {};
  if (!st.res_fp) return;
  const seq = (Number(st.res_seq) || 0) + 1;
  this.models["_data"] = Object.assign({}, st, { res_seq: seq });
  setTimeout(() => {
    const now = this.models["_data"] || {};
    if (now.res_seq !== seq || !now.res_fp) return;
    const dirty = resFp(this.getValues()) !== now.res_fp;
    if (dirty === (now.res_dirty === true)) return;
    this.models["_data"] = Object.assign({}, now, { res_dirty: dirty });
    this.setData({ res_summary: String(now.res_row || "") + (dirty ? RES_DIRTY : "") });
  }, 400);
})();
