// GD_CANCEL_COMMIT - X4 plan: the SO lines and headers recomputed from a FRESH read by the lifted code_node_QtyCheckBatch,
// code_node_UMQapdjk and code_node_lwB2FVe0 (other deliveries may have moved them since PREPARE), recorded as an intent
// (X4|I|nnn: each row's before + after) before anything is written; a re-run works from the intent: at after = done,
// at before = write, else review
const SO_LINE_COLS = ["delivered_qty", "planned_qty", "outstanding_quantity", "line_status"];
const SO_HDR_COLS = ["so_status", "gd_status", "partially_delivered", "fully_delivered"];
const cancelX4Plan = function cancelX4Plan(entry, partRows, intentRows, lineRows, hdrRows) {
  const base = { route: "GO", needIntent: "NO", intentRows: [], lineSlices: [], lineCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const lines = gcRows(lineRows).map(gcObj);
  const hdrs = gcRows(hdrRows).map(gcObj);
  const freshLine = {};
  for (const l of lines) freshLine[l.id] = l;
  const freshHdr = {};
  for (const h of hdrs) freshHdr[h.id] = h;
  let intent = joinChunks(intentRows, "X4|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "X4_SO", "the recorded intent cannot be read", true));
  if (!intent) {
    const so = joinChunks(partRows, entry.partPrefix + "SO|");
    if (!so) return Object.assign(base, stepEnd(entry, "X4_SO", "the sales-order part of the prepared payload is missing", true));
    const gdLineIds = {};
    for (const r of (so.tableGD || []).concat(so.bundleParents || [])) if (r.so_line_item_id) gdLineIds[r.so_line_item_id] = true;
    const pick = (o, cols) => { const x = {}; for (const c of cols) x[c] = o[c] === undefined ? null : o[c]; return x; };
    const shaped = hdrs.map((h) => Object.assign({}, h, { table_so: gcTree(lines.filter((l) => l.sales_order_id === h.id), "sales_order_id") }));
    const ctx = {
      "workflowparams:saveAs": so.saveAs || "Cancelled",
      "workflowparams:allData": { is_select_picking: 0 },
      "node:code_node_hb8ZWe9c": { data: { tableGD: so.tableGD || [], bundleParents: so.bundleParents || [] } },
      "node:code_node_IyJHrBst": { data: { gd_status: "Created", needSOCleanUp: 0, allData: { so_id: so.soIds || [] } } },
      "node:code_picking_defaults": { data: { splitPolicy: so.splitPolicy || "ALLOW_SPLIT" } },
      "node:sql_node_ItemFlags": { data: so.items || [] },
      "node:search_node_SOLine8kQ2": { data: gcSearch(lines.filter((l) => gdLineIds[l.id])) },
      "node:get_node_xTRvHWB8": { data: { count: 1, data: { table_gd: so.original || [] } } },
      "node:search_node_FVhsTRDu": { data: gcSearch(shaped) },
    };
    const run = __withContext(ctx, () => {
      const q = __run("code_node_QtyCheckBatch");
      if (num(q.itemNotFound) === 1) return { stop: "an item of the delivery no longer exists" };
      if (num(q.soLineMissing) === 1) return { stop: s(q.soLineMissingMessage) };
      // if_ACsN1GZD: a Cancelled save never stops on validationMessage
      if (q.validationMessage && (so.saveAs || "Cancelled") !== "Cancelled") return { stop: s(q.validationMessage) };
      __set("node:get_cache_node_alhhxRsa", { data: JSON.stringify(__v("node:code_node_QtyCheckBatch.data.updatedSOTable") || []) });
      __run("code_node_UMQapdjk");
      // classic reads the SO headers (search_node_FVhsTRDu) AFTER update_node_wEJC3qKB wrote the lines: lwB2FVe0's Cancelled
      // branch decides on those planned quantities, so it gets the lines with the written values
      const written = {};
      for (const r of __v("node:code_node_UMQapdjk.data.finalSOTable") || []) written[s(r.id)] = r;
      const after = lines.map((l) => (written[s(l.id)] ? Object.assign({}, l, pick(written[s(l.id)], SO_LINE_COLS)) : l));
      __set("node:search_node_FVhsTRDu", { data: gcSearch(hdrs.map((h) => Object.assign({}, h, { table_so: gcTree(after.filter((l) => l.sales_order_id === h.id), "sales_order_id") }))) });
      __run("code_node_lwB2FVe0");
      return { final: __v("node:code_node_UMQapdjk.data.finalSOTable") || [], heads: __v("node:code_node_lwB2FVe0.data.updatedSOList") || [] };
    });
    if (run.stop) return Object.assign(base, stepEnd(entry, "X4_SO", "the sales orders no longer accept this delivery: " + run.stop, true));
    // update_node_wEJC3qKB applies the rows in order: the last row of an SO line wins
    const lastOf = {};
    for (const r of run.final) lastOf[s(r.id)] = r;
    intent = {
      lines: Object.keys(lastOf).filter((id) => freshLine[id]).map((id) => ({ id: id, before: pick(freshLine[id], SO_LINE_COLS), after: pick(lastOf[id], SO_LINE_COLS) })),
      headers: run.heads.filter((h) => freshHdr[s(h.id)]).map((h) => ({ id: s(h.id), before: pick(freshHdr[s(h.id)], SO_HDR_COLS), after: pick(h, SO_HDR_COLS) })),
    };
    const missing = Object.keys(lastOf).filter((id) => !freshLine[id]);
    if (missing.length) return Object.assign(base, stepEnd(entry, "X4_SO", missing.length + " sales-order line(s) vanished (e.g. " + missing.slice(0, 3).join(", ") + ")", true));
    base.needIntent = "YES";
    base.intentRows = chunkRows(entry, "X4|I|", intent);
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
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "X4_SO", conflicts.length + " sales-order row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { lineSlices: slicesOf(lineWrites, 250), lineCount: lineWrites.length, headerRows: hdrWrites, needHeaders: hdrWrites.length ? "YES" : "NO",
    result_message: lineWrites.length + " SO line(s), " + hdrWrites.length + " SO header(s) to write" });
};
const res = cancelX4Plan([{{node:code_node_XCentry.data}}][0], [{{node:sql_node_XCx4part.data}}][0], [{{node:sql_node_XCx4intent.data}}][0], [{{node:sql_node_XCx4lines.data}}][0], [{{node:sql_node_XCx4hdrs.data}}][0]);
console.log("commit X4 plan", JSON.stringify({ route: res.route, intent: res.needIntent, lines: res.lineCount, headers: res.headerRows.length, result: res.result_code, message: res.result_message }));
return res;
