// Picking 1d - a GD line's fingerprint as Force Complete planned against it. PICKING_BULK_PREPARE (fcPlan) writes it;
// GD_EDIT_SUBMIT (source PICKING_FC) recomputes it on the stored line: any difference = the delivery changed since PREPARE.
// Self-contained: inlined into both workflows (and fcRowsFingerprint into PICKING_FC_DRIVE).
const fcLineFingerprint = function fcLineFingerprint(l) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
  const r8 = (v) => Math.round(Number(v) * 1e8) / 1e8;
  const nb = (b) => (b === "undefined" || b === null || b === undefined || b === "" ? "none" : String(b));
  let entries = [];
  if (Array.isArray(l.temp_qty_data)) entries = l.temp_qty_data;
  else if (s(l.temp_qty_data)) { try { const x = JSON.parse(l.temp_qty_data); if (Array.isArray(x)) entries = x; } catch (e) { entries = []; } }
  const by = {};
  for (const e of entries) {
    const k = s(e.location_id) + "_" + nb(e.batch_id) + "_" + (s(e.handling_unit_id) || "no_hu");
    by[k] = (by[k] || 0) + num(e.gd_quantity);
  }
  const canon = Object.keys(by).filter((k) => by[k] > 1e-6).map((k) => k + ":" + r8(by[k])).sort().join("|");
  return { gd_qty: num(l.gd_qty).toFixed(8), base_qty: num(l.base_qty).toFixed(8), temp_qty_data: canon, picking_status: s(l.picking_status) };
};

// The Picking's rows (id + line_status) as PREPARE planned against them: PICKING_FC_DRIVE's F0 and COMMIT's P0F recompute it
const fcRowsFingerprint = function fcRowsFingerprint(rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const text = (rows || []).map((r) => s(r.id) + ":" + s(r.line_status)).sort().join("|");
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + c) >>> 0; }
  return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
};

if (typeof module !== "undefined") module.exports = { fcLineFingerprint, fcRowsFingerprint };
