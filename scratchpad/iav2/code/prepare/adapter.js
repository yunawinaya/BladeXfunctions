// IA_V2_PREPARE - SQL rows -> the shapes the lifted bodies read (status = prevStatus; temp_qty_data stays the stored TEXT)
const iaAdaptDrop = (o) => {
  const r = {};
  for (const k of Object.keys(o || {})) {
    const v = o[k];
    if (v === null || v === undefined || v === "") continue;
    r[k] = v;
  }
  return r;
};
const iaAdaptHeader = function iaAdaptHeader(row, prevStatus) {
  const h = iaAdaptDrop(row);
  delete h.ia_v2_job_id;
  h.item_assembly_status = prevStatus;
  if (h.item_qty !== undefined) h.item_qty = Number(h.item_qty);
  // code_fillback compares the Manual Input rule with !== -9999
  if (iaS(h.stock_movement_no_type) === "-9999") h.stock_movement_no_type = -9999;
  return h;
};
const iaAdaptIdKey = (v) => String(iaS(v).length).padStart(2, "0") + iaS(v);
const iaAdaptLines = function iaAdaptLines(rows) {
  const at = (v) => (/^[0-9]{1,15}$/.test(iaS(v)) ? Number(iaS(v)) : Infinity);
  const lines = iaRows(rows).map((r) => {
    const o = iaAdaptDrop(r);
    if (o.total_quantity !== undefined) o.total_quantity = Number(o.total_quantity);
    return o;
  });
  return lines.sort((a, b) => {
    const x = at(a.line_index);
    const y = at(b.line_index);
    if (x !== y) return x < y ? -1 : 1;
    const p = iaAdaptIdKey(a.id);
    const q = iaAdaptIdKey(b.id);
    return p < q ? -1 : p > q ? 1 : 0;
  });
};
const iaAdaptItems = (rows) => iaRows(rows).map((r) => {
  const o = iaAdaptDrop(r);
  for (const k of ["assembly_cost", "purchase_unit_price"]) if (o[k] !== undefined) o[k] = Number(o[k]);
  o.table_uom_conversion = iaList(o.table_uom_conversion).filter((c) => c && typeof c === "object").map((c) => ({ alt_uom_id: iaS(c.alt_uom_id), base_qty: Number(c.base_qty) }));
  return o;
});
