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
