// the receipt price (CONTRACT.md section 5 "Receipt price") and the engine's uomOf; self-contained
const iaPrS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const iaPrQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// exact text only: ids 27 apart (prod UOMs ...758 / ...785) are one JS double, so replays must parse rows with iaParseJ
const iaPrIdEq = (a, b) => {
  const x = iaPrS(a);
  return x !== "" && x === iaPrS(b);
};
const iaUomConversions = function iaUomConversions(item) {
  const it = item || {};
  let conv = it.table_uom_conversion;
  if (!Array.isArray(conv)) {
    conv = it.uom_conversion_json;
    if (typeof conv === "string") {
      try {
        conv = JSON.parse(conv.replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
      } catch (e) {
        conv = [];
      }
    }
  }
  return (Array.isArray(conv) ? conv : []).filter((c) => c && typeof c === "object");
};
// INVENTORY_BULK_APPLY core uomOf: q8 qty, the line UOM (else the base UOM), one conversion row of that alt UOM, else 1:1
const iaUomOf = function iaUomOf(item, quantity, uom) {
  const it = item || {};
  const altQty = iaPrQ8(parseFloat(quantity));
  let baseQty = altQty;
  const altUOM = uom || it.based_uom;
  const conv = iaUomConversions(it).find((c) => iaPrIdEq(c.alt_uom_id, altUOM));
  if (conv) baseQty = iaPrQ8(altQty * Number(conv.base_qty));
  return { altQty: altQty, baseQty: baseQty, altUOM: altUOM, baseUOM: it.based_uom };
};
const iaItemOf = (items, id) => (Array.isArray(items) ? items : items ? [items] : []).find((it) => it && typeof it === "object" && iaPrIdEq(it.id, id)) || null;
// per BASE unit of the receipt (the engine prices ADD per base unit); non-stock lines add nothing (user decision 2026-10-19)
const receiptUnitPrice = function receiptUnitPrice(input) {
  const p = input || {};
  const base = parseFloat(p.receiptBaseQty) || 0;
  if (!(base > 0)) return 0;
  const out = (Array.isArray(p.outTotals) ? p.outTotals : [p.outTotals]).reduce((n, t) => n + (parseFloat(t) || 0), 0);
  return iaPrQ8(out / base + (parseFloat(p.assemblyCost) || 0));
};
if (typeof module !== "undefined") module.exports = { iaPrIdEq, iaUomConversions, iaUomOf, iaItemOf, receiptUnitPrice };
