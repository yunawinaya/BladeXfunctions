// PUTAWAY_BULK_COMMIT - P0 REVALIDATE: the putaway is unchanged since PREPARE read it (header update_time, every confirmed
// line's stored values, every in-transit row the confirmation consumes) -> DONE; else FAILED, the putaway released
// (nothing was moved)
const PW_LINE_COLS = ["pending_process_qty", "putaway_qty", "line_status", "target_location", "remark", "is_split", "parent_or_child"];
const IT_BEFORE = ["status", "open_qty", "received_qty", "transit_qty"];
const rowsById = (rows) => { const m = {}; for (const r of list(rows)) { const o = typeof r.j === "string" ? parseJ(r.j) : r.j || r; if (o && o.id !== undefined) m[s(o.id)] = o; } return m; };
const commitP0 = function commitP0(entry, toPartRows, itPartRows, toRows, lineRows, itRows) {
  const to = joinChunks(toPartRows, entry.partPrefix + "TO|");
  const it = joinChunks(itPartRows, entry.partPrefix + "IT|");
  if (!to || !it) return failNoWrite(entry, "PWC_INVALID_DATA", "the putaway part of the prepared payload is missing: no stock was moved");
  const head = list(toRows)[0] || {};
  const t19 = (v) => s(v).replace("T", " ").slice(0, 19);
  if (t19(head.update_time) !== t19((to.before || {}).update_time)) return failNoWrite(entry, "PWC_TO_CHANGED", "the putaway was changed after it was prepared: please confirm it again (no stock was moved)");
  const lines = rowsById(lineRows);
  const changed = [];
  for (const l of to.lines || []) {
    const cur = lines[s(l.id)];
    if (!cur || !Object.keys(l.before || {}).every((c) => sameVal(cur[c], l.before[c]))) changed.push(s(l.id));
  }
  if (changed.length) return failNoWrite(entry, "PWC_TO_CHANGED", changed.length + " putaway line(s) changed after the putaway was prepared (e.g. " + changed.slice(0, 3).join(", ") + "): please confirm it again (no stock was moved)");
  const rows = rowsById(itRows);
  const moved = [];
  for (const u of it.updates || []) {
    const cur = rows[s(u.id)];
    if (!cur || !IT_BEFORE.every((c) => sameVal(cur[c], (u.before || {})[c]))) moved.push(s(u.id));
  }
  if (moved.length) return failNoWrite(entry, "PWC_TRANSIT_CHANGED", moved.length + " in-transit row(s) changed after the putaway was prepared (e.g. " + moved.slice(0, 3).join(", ") + "): please confirm it again (no stock was moved)");
  return stepOk(entry, "P0_REVALIDATE", (to.lines || []).length + " line(s), " + (it.updates || []).length + " in-transit row(s) as prepared", "revalidated");
};
const res = commitP0([{{node:code_node_PCentry.data}}][0], [{{node:sql_node_PCp0to.data}}][0], [{{node:sql_node_PCp0it.data}}][0], [{{node:sql_node_PCp0head.data}}][0],
  [{{node:sql_node_PCp0lines.data}}][0], [{{node:sql_node_PCp0transit.data}}][0]);
console.log("commit P0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
