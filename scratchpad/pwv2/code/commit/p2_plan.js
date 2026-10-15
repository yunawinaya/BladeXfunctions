// PUTAWAY_BULK_COMMIT - P2 plan: the putaway's lines (code_node_KbJLkjP8's columns, by id: at after = done, at before =
// write, else review), its records (the stored ones + this job's new ones, each found again by job_line_key - the
// whole-subform write update_node_wYdL6wYD does; a key missing from a written row is stored NULL, so the stored rows go back
// with every column) and its to_status
const PW_LINE_COLS = ["pending_process_qty", "putaway_qty", "line_status", "target_location", "remark", "is_split", "parent_or_child"];
const PW_DEC_COLS = ["pending_process_qty", "putaway_qty"];
const PW_NESTED_DROP = ["create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id", "transfer_order_putaway_id"];
const objsOf = (rows) => list(rows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r.j || r)).filter((o) => o && o.id !== undefined);
const commitP2Plan = function commitP2Plan(entry, toPartRows, toRows, lineRows, recordRows) {
  const base = { route: "GO", lineSlices: [], lineCount: 0, headerRow: {}, needHeader: "NO", recordCount: 0, newRecords: 0, jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_PUTAWAY" };
  const to = joinChunks(toPartRows, entry.partPrefix + "TO|");
  if (!to) return Object.assign(base, stepEnd(entry, "P2_TO", "the putaway part of the prepared payload is missing", true));
  const lines = {};
  for (const o of objsOf(lineRows)) lines[s(o.id)] = o;
  const writes = [];
  const conflicts = [];
  for (const l of to.lines || []) {
    const cur = lines[s(l.id)];
    const cols = Object.keys(l.after || {});
    if (!cur) { conflicts.push(s(l.id) + " (gone)"); continue; }
    if (cols.every((c) => sameStored(l.after[c], cur[c]))) continue;
    // update_node_PCp2write maps every PW_LINE_COLS column: one missing from the row is stored NULL, so the rest keep their stored value
    const kept = {};
    for (const c of PW_LINE_COLS) kept[c] = cur[c] === undefined || cur[c] === null ? null : PW_DEC_COLS.indexOf(c) >= 0 ? Number(parseFloat(cur[c]).toFixed(8)).toFixed(8) : s(cur[c]);
    if (cols.every((c) => sameVal(cur[c], (l.before || {})[c]))) writes.push(Object.assign({ id: s(l.id) }, kept, l.after));
    else conflicts.push(s(l.id));
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "P2_TO", conflicts.length + " putaway line(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const stored = objsOf(recordRows);
  const have = {};
  for (const r of stored) if (s(r.job_line_key)) have[s(r.job_line_key)] = true;
  const fresh = (to.records || []).filter((r) => !have[s(r.job_line_key)]);
  const head = list(toRows)[0] || {};
  const strip = (r) => { const o = Object.assign({}, r); for (const k of PW_NESTED_DROP) delete o[k]; for (const k of Object.keys(o)) if (typeof o[k] === "number" && Math.abs(o[k]) >= 1e15) o[k] = String(o[k]); return o; };
  const needHeader = fresh.length > 0 || s(head.to_status) !== s(to.to_status);
  const header = needHeader ? { id: entry.toId, to_status: s(to.to_status), table_putaway_records: stored.map(strip).concat(fresh.map(strip)) } : {};
  return Object.assign(base, { lineSlices: slicesOf(writes, 250), lineCount: writes.length, headerRow: header, needHeader: needHeader ? "YES" : "NO",
    recordCount: stored.length + fresh.length, newRecords: fresh.length,
    result_message: writes.length + " line(s), " + fresh.length + " new record(s) of " + (stored.length + fresh.length) + ", to_status " + s(to.to_status) });
};
const res = commitP2Plan([{{node:code_node_PCentry.data}}][0], [{{node:sql_node_PCp2part.data}}][0], [{{node:sql_node_PCp2head.data}}][0], [{{node:sql_node_PCp2lines.data}}][0],
  [{{node:sql_node_PCp2records.data}}][0]);
console.log("commit P2 plan", JSON.stringify({ route: res.route, lines: res.lineCount, header: res.needHeader, records: res.recordCount, fresh: res.newRecords, result: res.result_code, message: res.result_message }));
return res;
