// the receipt prices (CONTRACT.md section 5 "Receipt price") and the engine's uomOf; self-contained
const idaPrS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const idaPrQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// exact text only: ids 27 apart (prod UOMs ...758 / ...785) are one JS double, so replays must parse rows with idaParseJ
const idaPrIdEq = (a, b) => {
  const x = idaPrS(a);
  return x !== "" && x === idaPrS(b);
};
const idaUomConversions = function idaUomConversions(item) {
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
// INVENTORY_BULK_APPLY v10 code_node_IBplan verbatim: its item mapping (untrimmed String ids, Number base_qty), then its uomOf
const idaUomOf = function idaUomOf(item, quantity, uom) {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const it = item || {};
  let conv = Array.isArray(it.table_uom_conversion) ? it.table_uom_conversion : it.uom_conversion_json;
  if (typeof conv === "string") {
    try {
      conv = JSON.parse(conv);
    } catch (e) {
      conv = [];
    }
  }
  // a null row would throw in the engine; every other row maps as the engine maps it
  const rows = arr(conv).filter((c) => c !== null && c !== undefined).map((c) => ({ alt_uom_id: s(c.alt_uom_id), base_qty: Number(c.base_qty) }));
  const based = s(it.based_uom);
  const altQty = idaPrQ8(parseFloat(quantity));
  let baseQty = altQty;
  const altUOM = uom || based;
  const row = rows.find((c) => c.alt_uom_id === altUOM);
  if (row) baseQty = idaPrQ8(altQty * row.base_qty);
  return { altQty: altQty, baseQty: baseQty, altUOM: altUOM, baseUOM: based };
};
const idaItemOf = (items, id) => (Array.isArray(items) ? items : items ? [items] : []).find((it) => it && typeof it === "object" && idaPrIdEq(it.id, id)) || null;
// the classic code_cost_alloc arithmetic line for line (PROVISIONAL COSTING RULE: share by quantity over EVERY line, the last line takes
// the remainder), with the v7 divisor: the line's BASE quantity (the engine and ADD_INVENTORY price an ADD per base unit)
const idaAllocate = function idaAllocate(issuedValue, alloc) {
  const rows = Array.isArray(alloc) ? alloc : [];
  const issued = parseFloat(issuedValue) || 0;
  const totalQty = rows.reduce((sum, a) => sum + idaPrQ8(a && a.share_qty), 0);
  let remaining = issued;
  return rows.map((a, i) => {
    const qty = idaPrQ8(a && a.share_qty);
    const value = i === rows.length - 1 ? remaining : totalQty > 0 ? (issued * qty) / totalQty : 0;
    remaining -= value;
    const base = parseFloat(a && a.base_qty) || 0;
    return { value: value, unit_price: base > 0 ? idaPrQ8(value / base) : 0 };
  });
};
if (typeof module !== "undefined") module.exports = { idaPrIdEq, idaUomConversions, idaUomOf, idaItemOf, idaAllocate };
