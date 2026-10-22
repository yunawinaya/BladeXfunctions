// RES-01 R5 (scratchpad/iasc/res01/RES01_PLAN.md): a reverted completion of an IA that reserves (a material_hold_status) returns a
// component issued from Reserved (its hold, closed at completion) to the bucket the hold came from: this cycle's Delivered rows (id above
// `bound`, the IA's last revert) say how much of each material|bin|batch came from Unrestricted or Blocked (review I3). A return they do
// not cover, a handling-unit one (never held), every other component and every IA that never reserved: as today (the category it left
// from). One return spanning two buckets is split (one part per bucket), the extra part with a new index after the last. Pure, ES2015: the classic IA_REVERT and
// IA_REVERT_V2_PREPARE inline it
const resRevertAdds = (adds, holdStatus, delivered, bound, items) => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const num = (v) => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const q8 = (v) => Number(num(v).toFixed(8));
  const eps = 0.0000001;
  const list = Array.isArray(adds) ? adds : [];
  if (s(holdStatus) === "") return list.map((a) => a);
  const after = (id) => (s(id).length !== s(bound).length ? s(id).length > s(bound).length : s(id) > s(bound));
  const itemOf = {};
  (Array.isArray(items) ? items : []).forEach((i) => (itemOf[s(i && i.id)] = i));
  // base units per one unit of a row (its item_uom); unknown -> 1
  const factor = (item, uom) => {
    if (!item || !s(uom) || s(uom) === s(item.based_uom)) return 1;
    const c = (Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion : []).find((x) => x && s(x.alt_uom_id) === s(uom));
    return c && num(c.base_qty) > 0 ? num(c.base_qty) : 1;
  };
  const keyOf = (mat, bin, batch) => [s(mat), s(bin), s(batch)].join("|");
  const pool = {};
  (Array.isArray(delivered) ? delivered : []).filter((d) => d && after(d.id))
    .sort((a, b) => s(a.id).length - s(b.id).length || (s(a.id) < s(b.id) ? -1 : s(a.id) > s(b.id) ? 1 : 0))
    .forEach((d) => {
      const k = keyOf(d.material_id, d.bin_location, d.batch_id);
      (pool[k] = pool[k] || []).push({ cat: s(d.from_category) || "Unrestricted", base: q8(num(d.delivered_qty) * factor(itemOf[s(d.material_id)], d.item_uom)) });
    });
  const held = (a) => !!a && s(a.inventory_category) === "Reserved" && !s(a.handling_unit_id);
  const parts = list.map(() => null);
  // one return per held pick: an exact match first, then what is left in order
  list.forEach((a, i) => {
    if (!held(a)) return;
    const e = (pool[keyOf(a.material_id, a.location_id, a.batch_id)] || []).find((x) => x.base > eps && Math.abs(x.base - q8(a.quantity)) < eps);
    if (!e) return;
    parts[i] = [{ qty: q8(a.quantity), cat: e.cat }];
    e.base = 0;
  });
  list.forEach((a, i) => {
    if (!held(a) || parts[i]) return;
    let left = q8(a.quantity);
    const got = [];
    (pool[keyOf(a.material_id, a.location_id, a.batch_id)] || []).forEach((x) => {
      if (left <= eps || x.base <= eps) return;
      const take = q8(Math.min(left, x.base));
      got.push({ qty: take, cat: x.cat });
      x.base = q8(x.base - take);
      left = q8(left - take);
    });
    if (left > eps) got.push({ qty: left, cat: "Reserved" });
    // one part per bucket: a key reserved over several saves has several Delivered rows (R6 live 10-22)
    const merged = [];
    got.forEach((p) => {
      const m = merged.find((x) => x.cat === p.cat);
      if (m) m.qty = q8(m.qty + p.qty);
      else merged.push({ qty: p.qty, cat: p.cat });
    });
    parts[i] = merged;
  });
  let next = list.reduce((m, a) => Math.max(m, Number(a && a.index) || 0), 0);
  const out = [];
  list.forEach((a, i) => {
    if (!parts[i]) return void out.push(a);
    const whole = parts[i].length === 1;
    parts[i].forEach((p, j) => out.push(Object.assign({}, a, { quantity: whole ? a.quantity : p.qty, inventory_category: p.cat }, j > 0 ? { index: ++next } : {})));
  });
  return out;
};
// the cycle a revert undoes starts after the IA's last revert: its highest 'IA-R' movement id among the IA's movements, else the IA id
const resRevertBound = (moves, iaId) => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  let bound = s(iaId);
  (Array.isArray(moves) ? moves : []).forEach((m) => {
    const id = s(m && m.id);
    if (s(m && m.transaction_type) === "IA-R" && (id.length !== bound.length ? id.length > bound.length : id > bound)) bound = id;
  });
  return bound;
};
if (typeof module !== "undefined") module.exports = { resRevertAdds, resRevertBound };
