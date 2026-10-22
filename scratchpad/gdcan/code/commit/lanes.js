// a write pass's first __LANES__ slices run in parallel lanes, the rest in the loop; a missing or repeated row id sends every slice to the loop
const list = (r) => (Array.isArray(r) ? r : r ? [r] : []);
const slices = list([{{node:__SRC__}}][0]);
const rowIds = [];
for (const s of slices) for (const r of list(s && s.rows)) rowIds.push(r && r.id !== undefined && r.id !== null ? String(r.id) : "");
const cut = rowIds.indexOf("") >= 0 || new Set(rowIds).size !== rowIds.length ? 0 : Math.min(slices.length, __LANES__);
const out = { rest: slices.slice(cut), hasRest: slices.length > cut ? "YES" : "NO", count: String(rowIds.length) };
for (let k = 0; k < __LANES__; k++) {
  const rows = k < cut ? list(slices[k] && slices[k].rows) : [];
  out["lane" + k] = rows;
  out["has" + k] = rows.length ? "YES" : "NO";
}
return out;
