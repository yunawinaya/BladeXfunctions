// RES-01 R4 (scratchpad/iasc/res01/RES01_PLAN.md): an IA that reserves completes from its holds. Each pick is split by the IA's own
// Allocated holds of its line + material + bin + batch + category, in pick order: the held part from Reserved, the rest as picked.
// A reservation still running (a live hold ticket, a row Processing / Releasing), or holds that could not be read -> busy.
// `used`: what it took from Reserved, base units per line|material|bin|batch|category (IA_HOLD's CLOSE delivers the holds by it).
// Pure, ES2015: IA_SAVE's code_node_RESsplit, IA_V2_PREPARE's plan and IA_HOLD's delta inline it
const resSplitLines = (lines, st, items) => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const num = (v) => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const q8 = (v) => Number(num(v).toFixed(8));
  const busy = { busy: true, lines: [], used: {} };
  if (!st || typeof st !== "object") return busy;
  const rows = Array.isArray(st.rows) ? st.rows : [];
  if (num(st.live) > 0 || rows.some((r) => s(r.status) === "Processing" || s(r.status) === "Releasing")) return busy;
  const itemOf = {};
  (Array.isArray(items) ? items : []).forEach((i) => (itemOf[s(i && i.id)] = i));
  // base units per one unit (the line's, or a hold's); unknown -> 1
  const factor = (item, uom) => {
    if (!item || !s(uom) || s(uom) === s(item.based_uom)) return 1;
    const c = (Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion : []).find((x) => x && s(x.alt_uom_id) === s(uom));
    return c && num(c.base_qty) > 0 ? num(c.base_qty) : 1;
  };
  const left = {};
  rows.filter((r) => s(r.status) === "Allocated").forEach((r) => {
    const key = [s(r.doc_line_id), s(r.material_id), s(r.bin_location), s(r.batch_id), s(r.from_category) || "Unrestricted"].join("|");
    left[key] = q8((left[key] || 0) + num(r.open_qty) * factor(itemOf[s(r.material_id)], r.item_uom));
  });
  const parse = (t) => {
    try {
      const x = typeof t === "string" ? JSON.parse(t || "[]") : t;
      return Array.isArray(x) ? x : [];
    } catch (e) {
      return [];
    }
  };
  const used = {};
  const out = (Array.isArray(lines) ? lines : []).map((l) => {
    const picks = parse(l && l.temp_qty_data);
    if (!picks.length) return l;
    const f = factor(itemOf[s(l.item_selection)], l.quantity_uom);
    const next = [];
    picks.forEach((p) => {
      const qty = q8(p && p.sm_quantity);
      const cat = s(p && p.category) || "Unrestricted";
      if (!(qty > 0) || s(p.handling_unit_id)) return void next.push(p);
      const key = [s(l.id), s(l.item_selection), s(p.location_id), s(p.batch_id), cat].join("|");
      const held = q8(Math.min(qty, Math.floor(((left[key] || 0) / f) * 1e8 + 1e-7) / 1e8));
      if (held > 0.0000001) {
        next.push(Object.assign({}, p, { sm_quantity: held, category: "Reserved" }));
        left[key] = q8((left[key] || 0) - held * f);
        used[key] = q8((used[key] || 0) + held * f);
      }
      if (qty - held > 0.0000001) next.push(Object.assign({}, p, { sm_quantity: q8(qty - held) }));
    });
    return Object.assign({}, l, { temp_qty_data: JSON.stringify(next) });
  });
  const split = { busy: false, lines: out, used: used };
  return split;
};
if (typeof module !== "undefined") module.exports = { resSplitLines };
