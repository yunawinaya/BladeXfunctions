// PUTAWAY_BULK_COMMIT - P3 plan: the in-transit ledger - the rows the confirmation consumes (code_node_ITmatch's updates, by
// id: at after = done, at the row as PREPARE read it = write, else review) and the remainders it splits off (its creates,
// each found again by job_line_key)
const IT_UPD_COLS = ["transit_qty", "received_qty", "open_qty", "status", "received_date", "to_bin", "to_category", "target_doc_type", "target_doc_id", "target_doc_no", "target_doc_line_id"];
const IT_BEFORE = ["status", "open_qty", "received_qty", "transit_qty"];
const commitP3Plan = function commitP3Plan(entry, itPartRows, updRows, keyRows) {
  const base = { route: "GO", updSlices: [], updCount: 0, addSlices: [], addCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_PUTAWAY" };
  const it = joinChunks(itPartRows, entry.partPrefix + "IT|");
  if (!it) return Object.assign(base, stepEnd(entry, "P3_TRANSIT", "the in-transit part of the prepared payload is missing", true));
  const cur = {};
  for (const r of list(updRows)) { const o = typeof r.j === "string" ? parseJ(r.j) : r.j || r; if (o && o.id !== undefined) cur[s(o.id)] = o; }
  const upd = [];
  const conflicts = [];
  for (const u of it.updates || []) {
    const c = cur[s(u.id)];
    if (!c) { conflicts.push(s(u.id) + " (gone)"); continue; }
    if (IT_UPD_COLS.every((k) => k === "received_date" || sameStored(u[k], c[k]))) continue;
    if (IT_BEFORE.every((k) => sameVal(c[k], (u.before || {})[k]))) { const o = { id: s(u.id) }; for (const k of IT_UPD_COLS) o[k] = u[k] === undefined ? null : u[k]; upd.push(o); }
    else conflicts.push(s(u.id));
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "P3_TRANSIT", conflicts.length + " in-transit row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const have = {};
  for (const r of list(keyRows)) { const o = typeof r.j === "string" ? parseJ(r.j) : r.j || r; if (o && s(o.job_line_key)) have[s(o.job_line_key)] = true; }
  const add = (it.creates || []).filter((c) => !have[s(c.job_line_key)]);
  return Object.assign(base, { updSlices: slicesOf(upd, 250), updCount: upd.length, addSlices: slicesOf(add, 250), addCount: add.length,
    result_message: upd.length + " in-transit row(s) to close, " + add.length + " remainder(s) to add" });
};
const res = commitP3Plan([{{node:code_node_PCentry.data}}][0], [{{node:sql_node_PCp3part.data}}][0], [{{node:sql_node_PCp3rows.data}}][0], [{{node:sql_node_PCp3keys.data}}][0]);
console.log("commit P3 plan", JSON.stringify({ route: res.route, upd: res.updCount, add: res.addCount, result: res.result_code, message: res.result_message }));
return res;
