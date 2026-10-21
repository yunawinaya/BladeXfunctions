// GR_REVERT_COMMIT - R4 plan: grRvBuild's purchase-order side (section 9) on a FRESH read under this job's purchase-order
// locks - each PO line loses what the receipt added (received_qty, outstanding_quantity, line_status) and gets its Created
// reservation back (created_received_qty), every live on-order row of the line loses the receipt's base quantity, the PO
// headers recounted - recorded as an intent (R4|I|nnn: each row's before + after) before anything is written; a re-run works
// from the intent: at after = done, at before = write, else review
const POL_COLS = ["received_qty", "outstanding_quantity", "line_status", "created_received_qty"];
const OO_COLS = ["open_qty", "received_qty"];
const POH_COLS = ["po_status", "gr_status", "partially_received", "fully_received"];
const pickCols = (o, cols) => {
  const x = {};
  for (const c of cols) x[c] = o[c] === undefined ? null : o[c];
  return x;
};
const commitR4Plan = function commitR4Plan(entry, partRows, intentRows, polRows, ooRows, pohRows) {
  const base = { route: "GO", needIntent: "NO", intentRows: [], lineSlices: [], lineCount: 0, ooSlices: [], ooCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_REVERT" };
  const lines = rowsOf(polRows);
  const oos = rowsOf(ooRows);
  const hdrs = rowsOf(pohRows);
  const freshLine = byId(polRows);
  const freshOo = byId(ooRows);
  const freshHdr = byId(pohRows);
  let intent = joinChunks(intentRows, "R4|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "R4_PO", "the recorded intent cannot be read", true));
  if (!intent) {
    const po = joinChunks(partRows, entry.partPrefix + "PO|");
    if (!po || !Array.isArray(po.poLines)) return Object.assign(base, stepEnd(entry, "R4_PO", "the purchase-order part of the prepared payload is missing", true));
    const missing = po.poLines.filter((l) => !freshLine[s(l.id)]).map((l) => s(l.id));
    if (missing.length) return Object.assign(base, stepEnd(entry, "R4_PO", missing.length + " purchase order line(s) vanished after the stock was taken back (e.g. " + missing.slice(0, 3).join(", ") + ")", true));
    const afterLine = {};
    const lineIntent = [];
    for (const l of po.poLines) {
      const cur = freshLine[s(l.id)];
      const quantity = num(cur.quantity);
      const newRecv = Math.max(0, q8(num(cur.received_qty) - num(l.recv)));
      const st = s(cur.line_status);
      const lineStatus = st === "Cancelled" || st === "Draft" ? st : quantity > 0 && newRecv >= quantity - EPS ? "Completed" : newRecv > EPS ? "Processing" : "Issued";
      const after = { received_qty: newRecv, outstanding_quantity: Math.max(0, q8(quantity - newRecv)), line_status: lineStatus, created_received_qty: q8(num(cur.created_received_qty) + num(l.res)) };
      afterLine[s(l.id)] = after;
      lineIntent.push({ id: s(l.id), before: pickCols(cur, POL_COLS), after: after });
    }
    const ooIntent = [];
    for (const o of po.onOrder || []) {
      for (const r of oos.filter((x) => s(x.po_line_id) === s(o.po_line_id))) {
        const newRecv = Math.max(0, q8(num(r.received_qty) - num(o.base)));
        ooIntent.push({ id: s(r.id), before: pickCols(r, OO_COLS), after: { open_qty: Math.max(0, q8(num(r.scheduled_qty) - newRecv)), received_qty: newRecv } });
      }
    }
    // an item bundle is ONE receivable line: the bundle row is counted, its items are not (grRvBuild's rule)
    const hdrIntent = [];
    for (const h of hdrs) {
      const tablePO = lines.filter((l) => s(l.purchase_order_id) === s(h.id) && !digits(l.parent_id) && !(s(l.item_bundle_id) && s(l.item_id)));
      if (!tablePO.length) continue;
      let partially = 0;
      let fully = 0;
      for (const item of tablePO) {
        const upd = afterLine[s(item.id)];
        const receivedQty = upd ? num(upd.received_qty) : num(item.received_qty);
        if (receivedQty > 0) {
          partially++;
          if (receivedQty >= num(item.quantity)) fully++;
        }
      }
      const cur = s(h.po_status);
      const poStatus = fully === tablePO.length ? "Completed" : partially > 0 ? "Processing" : cur === "Processing" || cur === "Completed" ? "Issued" : cur;
      hdrIntent.push({ id: s(h.id), before: pickCols(h, POH_COLS), after: { po_status: poStatus, gr_status: "Created", partially_received: partially + " / " + tablePO.length,
        fully_received: fully + " / " + tablePO.length } });
    }
    intent = { lines: lineIntent, oo: ooIntent, headers: hdrIntent };
    base.needIntent = "YES";
    base.intentRows = chunkRows(entry, "R4|I|", intent);
  }
  const conflicts = [];
  const pass = (rows, fresh, cols, out, tag) => {
    for (const r of rows || []) {
      const cur = fresh[r.id];
      if (!cur) {
        conflicts.push(tag + r.id + " (gone)");
        continue;
      }
      if (cols.every((c) => sameStored(r.after[c], cur[c]))) continue;
      if (cols.every((c) => sameVal(cur[c], r.before[c]))) out.push(Object.assign({ id: r.id }, r.after));
      else conflicts.push(tag + r.id);
    }
  };
  const lineWrites = [];
  const ooWrites = [];
  const hdrWrites = [];
  pass(intent.lines, freshLine, POL_COLS, lineWrites, "PO line ");
  pass(intent.oo, freshOo, OO_COLS, ooWrites, "on-order ");
  pass(intent.headers, freshHdr, POH_COLS, hdrWrites, "PO ");
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "R4_PO", conflicts.length + " purchase-order row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const lineOut = lineWrites.map((r) => ({ id: r.id, received_qty: qtyStr(r.received_qty), outstanding_quantity: qtyStr(r.outstanding_quantity), line_status: r.line_status,
    created_received_qty: qtyStr(r.created_received_qty) }));
  const ooOut = ooWrites.map((r) => ({ id: r.id, open_qty: qtyStr(r.open_qty), received_qty: qtyStr(r.received_qty) }));
  return Object.assign(base, { lineSlices: slicesOf(lineOut, 250), lineCount: lineOut.length, ooSlices: slicesOf(ooOut, 250), ooCount: ooOut.length, headerRows: hdrWrites,
    needHeaders: hdrWrites.length ? "YES" : "NO", result_message: lineOut.length + " PO line(s), " + ooOut.length + " on-order row(s), " + hdrWrites.length + " PO header(s) to write" });
};
const res = commitR4Plan([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr4part.data}}][0], [{{node:sql_node_VCr4intent.data}}][0], [{{node:sql_node_VCr4pol.data}}][0],
  [{{node:sql_node_VCr4oo.data}}][0], [{{node:sql_node_VCr4poh.data}}][0]);
console.log("commit R4 plan", JSON.stringify({ route: res.route, intent: res.needIntent, lines: res.lineCount, oo: res.ooCount, headers: res.headerRows.length, result: res.result_code, message: res.result_message }));
return res;
