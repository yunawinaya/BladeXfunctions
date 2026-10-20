// GD_EDIT_SUBMIT - Picking Force Complete (source PICKING_FC, Picking V2 stage 1d): the parts PICKING_BULK_PREPARE wrote
// (gd_publish_step FCD|<nonce>|<gi>|<nnn>, the text in result_ref) -> the edit as this module's delta against the GD as stored.
// The force complete may only close lines, shrink them to what was picked and remove the unpicked ones.
const FC_CELLS = ["temp_qty_data", "view_stock", "temp_hu_data", "gd_qty", "base_qty", "gd_delivered_qty", "gd_undelivered_qty", "plan_qty",
  "plan_temp_qty_data", "plan_view_stock", "is_force_complete", "picking_status"];
const fcParts = function fcParts(rows) {
  const sorted = list(rows).slice().sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : s(a.step_name) > s(b.step_name) ? 1 : 0));
  const text = sorted.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join("");
  try { const x = JSON.parse(text); return x && typeof x === "object" && !Array.isArray(x) ? x : null; } catch (e) { return null; }
};
const fcDelta = function fcDelta(stored, parts) {
  const bad = (code, message) => ({ ok: false, code: code, message: message });
  if (!parts || typeof parts !== "object" || !parts.cells || typeof parts.cells !== "object" || !Array.isArray(parts.removed) || !parts.base || typeof parts.base !== "object") {
    return bad("400", "the force complete's planned changes could not be read");
  }
  const lines = {};
  for (const r of (stored && stored.table_gd) || []) { lines[s(r.id)] = r; for (const c of r.children || []) lines[s(c.id)] = c; }
  for (const id of Object.keys(parts.cells).concat(parts.removed).concat(Object.keys(parts.base))) {
    if (!lines[s(id)]) return bad("409", "GDE_FC_STALE: line " + id + " is no longer on the delivery");
  }
  for (const id of Object.keys(parts.cells)) {
    for (const k of Object.keys(parts.cells[id] || {})) if (FC_CELLS.indexOf(k) < 0) return bad("400", "the force complete may not change " + k + " (line " + id + ")");
  }
  for (const id of Object.keys(parts.base)) {
    const now = fcLineFingerprint(lines[s(id)]), was = parts.base[id] || {};
    if (["gd_qty", "base_qty", "temp_qty_data", "picking_status"].some((k) => s(now[k]) !== s(was[k]))) return bad("409", "GDE_FC_STALE: line " + id + " changed since the force complete was planned");
  }
  const gone = {};
  for (const id of parts.removed) gone[s(id)] = true;
  const layout = [];
  for (const r of stored.table_gd || []) {
    if (gone[s(r.id)]) continue;
    layout.push({ ref: s(r.id), children: (r.children || []).map((c) => s(c.id)).filter((id) => !gone[id]) });
  }
  if (!layout.length) return bad("400", "the force complete would leave the delivery without lines");
  return { ok: true, delta: { header: {}, dropHeader: [], lines: Object.keys(parts.cells).map((id) => ({ id: s(id), cells: parts.cells[id], drop: [] })),
    added: [], removed: parts.removed.map(s), layout: layout } };
};
