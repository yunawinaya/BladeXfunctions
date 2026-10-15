// The Item fields the movement builder reads, in the search-node's shape (ids as strings, numbers as numbers, NULL and empty values left out)
const parse = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
  }
};
const raw = [{{node:sql_node_PwItems.data}}][0] || [];
const items = [];
for (const r of Array.isArray(raw) ? raw : [raw]) {
  const o = parse(r && r.j !== undefined ? r.j : r);
  if (!o || !o.id) continue;
  const conv = parse(o.table_uom_conversion);
  o.table_uom_conversion = (Array.isArray(conv) ? conv : []).map((c) => ({
    alt_uom_id: c.alt_uom_id === null || c.alt_uom_id === undefined ? c.alt_uom_id : String(c.alt_uom_id),
    base_qty: c.base_qty === null || c.base_qty === undefined ? c.base_qty : Number(c.base_qty),
  }));
  if (o.item_batch_management !== null && o.item_batch_management !== undefined) o.item_batch_management = Number(o.item_batch_management);
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === "") delete o[k];
  items.push(o);
}
return { items };