// GD_EDIT_COMMIT - the fresh SO rows (SQL, one JSON per row) as the lifted SO nodes take them: the lines, and the headers
// carrying their own lines (table_so) - E0's validation and E4's recompute read the same shape
const geSoFresh = function geSoFresh(lineRows, hdrRows) {
  const obj = (rows) => list(rows).map((r) => (typeof r.j === "string" ? gcStrip(parseJ(r.j)) : r)).filter((x) => x && x.id !== undefined);
  const lines = obj(lineRows), hdrs = obj(hdrRows);
  return { lines: lines, hdrs: hdrs, shaped: hdrs.map((h) => Object.assign({}, h, { table_so: gcTree(lines.filter((l) => s(l.sales_order_id) === s(h.id)), "sales_order_id") })) };
};
// the SOs and SO lines to read fresh for the part SO: the header's so_id and every row (bundle items included) of the edit,
// the stored GD and the table after the edit - a superset; the lifted nodes filter their searches as deployed
const geSoIds = function geSoIds(so) {
  const p = so || {};
  let head = p.soIds;
  if (typeof head === "string") { try { head = JSON.parse(head); } catch (e) { head = [head]; } }
  const rows = [].concat(p.tableGD || [], p.bundleParents || [], p.original || [], p.current || []).flatMap((r) => [r].concat(r.children || []));
  const soIds = new Set((Array.isArray(head) ? head : head ? [head] : []).map(s).filter(digits));
  const lineIds = new Set((p.soLineIds || []).map(s).filter(digits));
  for (const r of rows) { if (digits(r.line_so_id)) soIds.add(s(r.line_so_id)); if (digits(r.so_line_item_id)) lineIds.add(s(r.so_line_item_id)); }
  const json = (set) => JSON.stringify(set.size ? [...set] : ["0"]);
  return { soIdsJson: json(soIds), lineIdsJson: json(lineIds) };
};
