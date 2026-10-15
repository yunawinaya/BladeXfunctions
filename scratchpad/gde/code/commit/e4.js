// GD_EDIT_COMMIT - E4 SO (gdc's C4): the SO lines and headers recomputed from a FRESH read by the lifted SO nodes (geSoRun:
// code_node_QtyCheckBatch, the removed-lines clean-up, code_node_UMQapdjk, code_node_lwB2FVe0) from the GD side PREPARE
// froze (part SO), recorded as an intent (E4|I|nnn: each row's before + after) before anything is written; a re-run works
// from the intent: at after = done, at before = write, else review. update_node_wEJC3qKB's / update_node_AFswLv4E's columns.
const GE_SO_LINE_COLS = ["delivered_qty", "planned_qty", "outstanding_quantity", "line_status"];
const GE_SO_HDR_COLS = ["so_status", "gd_status", "partially_delivered", "fully_delivered"];
const geSoDec = { delivered_qty: 1, planned_qty: 1, outstanding_quantity: 1 };
const commitE4Plan = function commitE4Plan(entry, soPart, intentRows, lineRows, hdrRows) {
  const base = { route: "GO", needIntent: "NO", intentRows: [], lineSlices: [], lineCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const fresh = geSoFresh(lineRows, hdrRows);
  const lines = fresh.lines, hdrs = fresh.hdrs;
  const freshLine = {}, freshHdr = {};
  for (const l of lines) freshLine[s(l.id)] = l;
  for (const h of hdrs) freshHdr[s(h.id)] = h;
  let intent = joinChunks(intentRows, "E4|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "E4_SO", "the recorded intent cannot be read", true));
  if (!intent) {
    if (!soPart) return Object.assign(base, stepEnd(entry, "E4_SO", "the sales-order part of the prepared payload is missing", true));
    const run = geSoRun(soPart, lines, fresh.shaped);
    if (run.stop) return Object.assign(base, stepEnd(entry, "E4_SO", "the sales orders no longer accept this edit: " + run.stop, true));
    // update_node_wEJC3qKB applies the rows in order: the last row of an SO line wins
    const lastOf = {};
    for (const r of run.final) lastOf[s(r.id)] = r;
    const pick = (o, cols) => { const x = {}; for (const c of cols) x[c] = o[c] === undefined ? null : o[c]; return x; };
    const missing = Object.keys(lastOf).filter((id) => !freshLine[id]);
    if (missing.length) return Object.assign(base, stepEnd(entry, "E4_SO", missing.length + " sales-order line(s) vanished (e.g. " + missing.slice(0, 3).join(", ") + ")", true));
    intent = {
      lines: Object.keys(lastOf).map((id) => ({ id: id, before: pick(freshLine[id], GE_SO_LINE_COLS), after: pick(lastOf[id], GE_SO_LINE_COLS) })),
      headers: run.heads.filter((h) => freshHdr[s(h.id)]).map((h) => ({ id: s(h.id), before: pick(freshHdr[s(h.id)], GE_SO_HDR_COLS), after: pick(h, GE_SO_HDR_COLS) })),
    };
    base.needIntent = "YES";
    base.intentRows = chunkRows(entry, "E4|I|", intent);
  }
  const conflicts = [], lineWrites = [], hdrWrites = [];
  for (const r of intent.lines || []) {
    const cur = freshLine[r.id];
    if (!cur) { conflicts.push(r.id + " (gone)"); continue; }
    if (GE_SO_LINE_COLS.every((c) => sameVal(cur[c], r.after[c]))) continue;
    if (GE_SO_LINE_COLS.every((c) => sameVal(cur[c], r.before[c]))) { const w = { id: r.id }; for (const c of GE_SO_LINE_COLS) w[c] = geSoDec[c] && r.after[c] !== null ? q8(r.after[c]).toFixed(8) : r.after[c]; lineWrites.push(w); }
    else conflicts.push(r.id);
  }
  for (const h of intent.headers || []) {
    const cur = freshHdr[h.id];
    if (!cur) { conflicts.push("SO " + h.id + " (gone)"); continue; }
    if (GE_SO_HDR_COLS.every((c) => sameVal(cur[c], h.after[c]))) continue;
    if (GE_SO_HDR_COLS.every((c) => sameVal(cur[c], h.before[c]))) hdrWrites.push(Object.assign({ id: h.id }, h.after));
    else conflicts.push("SO " + h.id);
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "E4_SO", conflicts.length + " sales-order row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { lineSlices: slicesOf(lineWrites, 250), lineCount: lineWrites.length, headerRows: hdrWrites, needHeaders: hdrWrites.length ? "YES" : "NO",
    result_message: lineWrites.length + " SO line(s), " + hdrWrites.length + " SO header(s) to write" });
};
const commitE4Check = function commitE4Check(entry, intentRows, lineRows, hdrRows) {
  const intent = joinChunks(intentRows, "E4|I|") || { lines: [], headers: [] };
  const obj = (rows) => { const o = {}; for (const r of list(rows)) { const x = typeof r.j === "string" ? parseJ(r.j) : r; if (x && x.id !== undefined) o[s(x.id)] = x; } return o; };
  const lines = obj(lineRows), hdrs = obj(hdrRows);
  const off = (intent.lines || []).filter((r) => !lines[r.id] || !GE_SO_LINE_COLS.every((c) => sameVal(lines[r.id][c], r.after[c]))).map((r) => r.id)
    .concat((intent.headers || []).filter((h) => !hdrs[h.id] || !GE_SO_HDR_COLS.every((c) => sameVal(hdrs[h.id][c], h.after[c]))).map((h) => "SO " + h.id));
  if (off.length) return stepEnd(entry, "E4_SO", off.length + " sales-order row(s) do not read back (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "E4_SO", (intent.lines || []).length + " line(s), " + (intent.headers || []).length + " header(s)", "sales orders saved");
};
