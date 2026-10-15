// Every in-transit row of this Goods Receiving (all statuses: the matcher needs the closed ones to refuse double
// consumption), in the search-node's shape: decimals as numbers, ids as strings, NULL and empty values left out
const parse = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
  }
};
const raw = [{{node:sql_node_PwTransit.data}}][0] || [];
const rows = [];
for (const r of Array.isArray(raw) ? raw : [raw]) {
  const o = parse(r && r.j !== undefined ? r.j : r);
  if (!o || !o.id) continue;
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === "") delete o[k];
  for (const k of ["transit_qty", "received_qty", "open_qty", "line_no"]) if (o[k] !== undefined) o[k] = Number(o[k]);
  rows.push(o);
}
return { rows };