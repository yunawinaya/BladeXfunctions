// GD_REVERT_COMMIT - R3 SALES ORDERS: GD_REVERT_COMPLETED's code_node_hrComputeSoUpdates (lifted) on a FRESH read of the sales
// orders - it takes this delivery's quantities off what the lines hold now, so a delivery written since PREPARE stays counted -
// recorded as an intent (R3|I|nnn: each row's before + after) before anything is written; a re-run works from the intent: at
// after = done, at before = write, else review
const SO_LINE_COLS = ["planned_qty", "delivered_qty", "outstanding_quantity", "line_status"];
const SO_HDR_COLS = ["so_status", "gd_status", "partially_delivered", "fully_delivered"];
const r3Pick = (o, cols) => {
  const x = {};
  for (const c of cols) x[c] = o && o[c] !== undefined ? o[c] : null;
  return x;
};
const revertR3Plan = function revertR3Plan(entry, partRows, intentRows, lineRows, hdrRows) {
  const base = { route: "GO", needIntent: "NO", intentRows: [], lineSlices: [], lineCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "",
    job_status: "COMMITTING_GD" };
  const lines = gcRows(lineRows).map(gcObj);
  const hdrs = gcRows(hdrRows).map(gcObj);
  const freshLine = {};
  for (const l of lines) freshLine[s(l.id)] = l;
  const freshHdr = {};
  for (const h of hdrs) freshHdr[s(h.id)] = h;
  let intent = joinChunks(intentRows, "R3|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "R3_SO", "the recorded intent cannot be read", true));
  if (!intent) {
    const so = joinChunks(partRows, entry.partPrefix + "SO|");
    if (!so || !Array.isArray(so.lines)) return Object.assign(base, stepEnd(entry, "R3_SO", "the sales-order part of the prepared payload is missing", true));
    const gone = (so.sol || []).map((r) => s(r.id)).filter((id) => !freshLine[id]).concat((so.soh || []).map((r) => "SO " + s(r.id)).filter((id) => !freshHdr[id.slice(3)]));
    if (gone.length) return Object.assign(base, stepEnd(entry, "R3_SO", gone.length + " sales-order row(s) vanished (e.g. " + gone.slice(0, 3).join(", ") + ")", true));
    const lineIds = {};
    for (const r of so.lines.concat(so.bundles || [])) if (r.so_line_item_id) lineIds[s(r.so_line_item_id)] = true;
    // as PREPARE (chain.js) and classic feed it: the SO lines the delivery names, the sales orders with all their lines
    const ctx = {
      "node:code_node_hrExtract": { data: { tableData: so.lines, bundleParentLines: so.bundles || [] } },
      "node:search_node_hrCurSoLines": { data: gcSearch(lines.filter((l) => lineIds[s(l.id)])) },
      "node:search_node_hrCurSoHdr": { data: gcSearch(hdrs.map((h) => Object.assign({}, h, { table_so: gcTree(lines.filter((l) => l.sales_order_id === h.id), "sales_order_id") }))) },
    };
    const out = __withContext(ctx, () => __run("code_node_hrComputeSoUpdates"));
    intent = {
      lines: (out.soLineUpdates || []).map((u) => ({ id: s(u.id), before: r3Pick(freshLine[s(u.id)], SO_LINE_COLS), after: r3Pick(u, SO_LINE_COLS) })),
      headers: (out.soHeaderUpdates || []).map((h) => ({ id: s(h.id), before: r3Pick(freshHdr[s(h.id)], SO_HDR_COLS), after: r3Pick(h, SO_HDR_COLS) })),
    };
    base.needIntent = "YES";
    base.intentRows = chunkRows(entry, "R3|I|", intent);
  }
  const conflicts = [];
  const lineWrites = [];
  for (const r of intent.lines || []) {
    const cur = freshLine[r.id];
    if (!cur) { conflicts.push(r.id + " (gone)"); continue; }
    if (SO_LINE_COLS.every((c) => sameVal(cur[c], r.after[c]))) continue;
    if (SO_LINE_COLS.every((c) => sameVal(cur[c], r.before[c]))) lineWrites.push(Object.assign({ id: r.id }, r.after));
    else conflicts.push(r.id);
  }
  const hdrWrites = [];
  for (const h of intent.headers || []) {
    const cur = freshHdr[h.id];
    if (!cur) { conflicts.push("SO " + h.id + " (gone)"); continue; }
    if (SO_HDR_COLS.every((c) => sameVal(cur[c], h.after[c]))) continue;
    if (SO_HDR_COLS.every((c) => sameVal(cur[c], h.before[c]))) hdrWrites.push(Object.assign({ id: h.id }, h.after));
    else conflicts.push("SO " + h.id);
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "R3_SO", conflicts.length + " sales-order row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { lineSlices: slicesOf(lineWrites, 250), lineCount: lineWrites.length, headerRows: hdrWrites, needHeaders: hdrWrites.length ? "YES" : "NO",
    result_message: lineWrites.length + " SO line(s), " + hdrWrites.length + " SO header(s) to write" });
};
// R3 check: every SO line and header of the intent reads back at its after-values -> DONE
const revertR3Check = function revertR3Check(entry, intentRows, lineRows, hdrRows) {
  const intent = joinChunks(intentRows, "R3|I|");
  if (!intent) return stepEnd(entry, "R3_SO", "the recorded intent cannot be read back", false);
  const now = {};
  for (const r of gcRows(lineRows).map(gcObj)) now[s(r.id)] = r;
  const nowH = {};
  for (const r of gcRows(hdrRows).map(gcObj)) nowH[s(r.id)] = r;
  const off = (intent.lines || []).filter((r) => !now[r.id] || !SO_LINE_COLS.every((c) => sameVal(now[r.id][c], r.after[c])));
  const offH = (intent.headers || []).filter((h) => !nowH[h.id] || !SO_HDR_COLS.every((c) => sameVal(nowH[h.id][c], h.after[c])));
  if (off.length || offH.length) return stepEnd(entry, "R3_SO", off.length + " SO line(s) and " + offH.length + " SO header(s) do not read back", false);
  return stepOk(entry, "R3_SO", (intent.lines || []).length + " SO line(s), " + (intent.headers || []).length + " SO header(s)", "sales orders updated");
};
