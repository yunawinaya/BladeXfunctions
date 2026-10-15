// table_po is a tree: an item bundle is ONE row with its items under `children`.
// Only the items are materials -- the bundle row itself has no item_id -- so they
// are the rows on order, and reading the top level alone left them with no
// on_order_purchase_order row at all. Goods Receiving then had nothing to
// decrement on completion. Get On Order Lines returns the lines already flat,
// each bundle row followed by its items, in the order the PO read-back nests them.
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const text = (v) => (v === undefined || v === null || v === "" ? undefined : String(v));
const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
const parse = (v) => {
  if (Array.isArray(v)) return v;
  try {
    const x = typeof v === "string" && v ? JSON.parse(v) : [];
    return Array.isArray(x) ? x : [];
  } catch (e) {
    return [];
  }
};

const head = {{node:code_resolve_latest.data.poData}} || {};
const poFull = { id: head.id, purchase_order_no: head.purchase_order_no, po_plant: head.po_plant, organization_id: head.organization_id };
// The rows as the get / search nodes handed them on: ids as strings, numbers as numbers, NULL columns absent
const latestLines = list({{node:sql_oo_lines.data}}).map((r) => ({
  id: text(r.id),
  item_id: text(r.item_id),
  quantity: num(r.quantity),
  quantity_uom: text(r.quantity_uom),
  preq_id: text(r.preq_id),
  preq_line_id: text(r.preq_line_id),
}));
const fetched = list({{node:sql_onorder.data}}).map((r) => ({
  id: text(r.id),
  po_id: text(r.po_id),
  po_line_id: text(r.po_line_id),
  material_id: text(r.material_id),
  purchase_order_number: r.purchase_order_number,
  purchase_order_line: num(r.purchase_order_line),
  received_qty: num(r.received_qty),
}));
const itemById = new Map();
for (const r of list({{node:sql_oo_items.data}})) {
  const id = String(r.id);
  if (!itemById.has(id)) itemById.set(id, { id: id, table_uom_conversion: parse(r.uom_json) });
}

const round8 = (n) => Math.round((parseFloat(n) || 0) * 100000000) / 100000000;

// The fetch is keyed on po_id OR purchase_order_number, because a PO number is not unique
// (purchase_order_no_type -9999 is user-typed) and rows written before po_id existed carry
// none. `mine` is this PO's own rows - the only ones we are ever allowed to delete.
// `orphan` are unstamped rows under the same number: adoptable, so an edit repairs one
// instead of adding a second row beside it, but never deleted (it may be a sibling's).
const poId = String(poFull.id);
const mine = fetched.filter(e => String(e.po_id || '') === poId);
const orphan = fetched.filter(e => !e.po_id && String(e.purchase_order_number) === String(poFull.purchase_order_no));
const existing = mine.concat(orphan);

const baseQtyFor = (line) => {
  const itemData = itemById.get(String(line.item_id));
  const altQty = parseFloat(line.quantity) || 0;
  let baseQty = altQty;
  if (itemData && Array.isArray(itemData.table_uom_conversion) && itemData.table_uom_conversion.length > 0) {
    const conv = itemData.table_uom_conversion.find(c => String(c.alt_uom_id) === String(line.quantity_uom));
    if (conv) baseQty = round8(altQty * parseFloat(conv.base_qty));
  }
  return baseQty;
};

const desired = [];
for (const [index, line] of latestLines.entries()) {
  const itemData = itemById.get(String(line.item_id));
  if (!itemData) continue;
  desired.push({
    po_line_id: line.id,
    purchase_order_number: poFull.purchase_order_no,
    material_id: line.item_id,
    purchase_order_line: index + 1,
    scheduled_qty: baseQtyFor(line),
    plant_id: poFull.po_plant,
    organization_id: poFull.organization_id,
    po_id: poFull.id,
    parent_id: line.preq_id || null,
    parent_line_id: line.preq_line_id || null
  });
}

const toAdd = [], toUpdate = [], toDelete = [];
const usedExistingIds = new Set();

// The first unused existing row, in fetch order, on po_line_id; else on material + line number (legacy rows).
// Indexed by key: the same row the linear scans picked, without an O(lines x rows) search.
const byLine = new Map();
const byMaterialLine = new Map();
for (const e of existing) {
  if (e.po_line_id != null) {
    const k = String(e.po_line_id);
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(e);
  }
  const k2 = String(e.material_id) + "|" + Number(e.purchase_order_line);
  if (!byMaterialLine.has(k2)) byMaterialLine.set(k2, []);
  byMaterialLine.get(k2).push(e);
}
const firstUnused = (rows) => (rows || []).find((e) => !usedExistingIds.has(e.id));
const findExisting = (d) => {
  const m = firstUnused(byLine.get(String(d.po_line_id)));
  if (m) return m;
  return firstUnused(byMaterialLine.get(String(d.material_id) + "|" + Number(d.purchase_order_line)));
};

// No Add/Clone shortcut. `existing` is already scoped to this PO, so on a genuine Add it is
// empty and every line falls through to toAdd anyway; reconciling uniformly means a re-entry
// over an already-issued PO updates its own rows instead of laying down a duplicate set.
for (const d of desired) {
  const match = findExisting(d);
  if (!match) {
    toAdd.push({
      purchase_order_number: d.purchase_order_number,
      material_id: d.material_id,
      purchase_order_line: d.purchase_order_line,
      scheduled_qty: d.scheduled_qty,
      open_qty: d.scheduled_qty,
      received_qty: 0,
      plant_id: d.plant_id,
      organization_id: d.organization_id,
      po_id: d.po_id,
      po_line_id: d.po_line_id,
      parent_id: d.parent_id,
      parent_line_id: d.parent_line_id
    });
  } else {
    usedExistingIds.add(match.id);
    const received = Math.max(0, round8(match.received_qty || 0));
    const newOpen = Math.max(0, round8(d.scheduled_qty - received));
    // Re-stamp every PO-owned column, not just the quantities: po_plant and the line's item
    // stay editable while the PO is Issued, and an adopted legacy row has no po_id/po_line_id
    // at all. received_qty is owned by the GR flow - never write it from here.
    toUpdate.push({
      id: match.id,
      scheduled_qty: d.scheduled_qty,
      open_qty: newOpen,
      purchase_order_number: d.purchase_order_number,
      purchase_order_line: d.purchase_order_line,
      material_id: d.material_id,
      plant_id: d.plant_id,
      organization_id: d.organization_id,
      po_id: d.po_id,
      po_line_id: d.po_line_id,
      parent_id: d.parent_id,
      parent_line_id: d.parent_line_id
    });
  }
}

// Only rows this PO owns are swept, so an unmatched orphan stays put rather than being
// deleted out from under whichever PO it really belongs to.
for (const e of mine) {
  if (!usedExistingIds.has(e.id)) toDelete.push({ id: e.id });
}

const preqIds = head.preq_id || [];
const hasPreq = Array.isArray(preqIds) && preqIds.length > 0;

// Written in slices of <= 250 rows per add / update / delete call
const SLICE = 250;
const slices = (rows) => {
  const out = [];
  for (let i = 0; i < rows.length; i += SLICE) out.push({ rows: rows.slice(i, i + SLICE) });
  return out;
};

return {
  addSlices: slices(toAdd),
  updateSlices: slices(toUpdate),
  deleteSlices: slices(toDelete),
  hasAdds: toAdd.length > 0,
  hasUpdates: toUpdate.length > 0,
  hasDeletes: toDelete.length > 0,
  hasPreq: hasPreq,
};
