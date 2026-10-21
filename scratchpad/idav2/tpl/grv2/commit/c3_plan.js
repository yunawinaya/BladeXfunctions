// GR_COMPLETE_COMMIT - C3 plan: the PO lines (code_node_H4Eg0oEI), their on-order rows (code_node_W4nXz7Yb, every live row of
// the PO line as update_node_J2vH9sLc's filter writes them) and the PO headers (code_node_KAeXsqwm, lifted) recomputed from
// a FRESH read plus this receipt's deltas, recorded as an intent (C3|I|nnn: each row's before + after) before anything is
// written; a re-run works from the intent: at after = done, at before = write, else review
const POL_COLS = ["received_qty", "outstanding_quantity", "line_status", "created_received_qty"];
const OO_COLS = ["open_qty", "received_qty"];
const POH_COLS = ["po_status", "gr_status", "partially_received", "fully_received"];
// code_node_KAeXsqwm (GOODS_RECEIVING dev v100), verbatim: poDatas = the purchase orders with their top-level table_po rows
const kaeXsqwm = function kaeXsqwm(poDatas) {
  const poDataUpdates = [];
  const isBundleChildLine = (item) =>
    Boolean(item.item_bundle_id) && Boolean(item.item_id);
  for (const po of poDatas) {
    const tablePO = (po.table_po || []).filter((item) => !isBundleChildLine(item));
    if (tablePO.length === 0) {
      continue;
    }
    const totalItems = tablePO.length;
    let partiallyReceivedItems = 0;
    let fullyReceivedItems = 0;
    for (const item of tablePO) {
      const quantity = parseFloat(item.quantity || 0);
      const receivedQty = parseFloat(item.received_qty || 0);
      if (receivedQty > 0) {
        partiallyReceivedItems++;
        if (receivedQty >= quantity) {
          fullyReceivedItems++;
        }
      }
    }
    const allItemsComplete = fullyReceivedItems === totalItems;
    const anyItemProcessing = partiallyReceivedItems > 0;
    let newPOStatus = po.po_status;
    let newGRStatus = po.gr_status;
    if (po.po_status !== "Completed") {
      if (allItemsComplete) {
        newPOStatus = "Completed";
        newGRStatus = "Fully Received";
      } else if (anyItemProcessing) {
        newPOStatus = "Processing";
        newGRStatus = "Partially Received";
      }
    } else {
      if (allItemsComplete) {
        newGRStatus = "Fully Received";
      } else if (anyItemProcessing) {
        newGRStatus = "Partially Received";
      }
    }
    const partiallyReceivedRatio = `${partiallyReceivedItems} / ${totalItems}`;
    const fullyReceivedRatio = `${fullyReceivedItems} / ${totalItems}`;
    poDataUpdates.push({
      id: po.id,
      po_status: newPOStatus,
      gr_status: newGRStatus,
      partially_received: partiallyReceivedRatio,
      fully_received: fullyReceivedRatio,
    });
  }
  return poDataUpdates;
};
const pickCols = (o, cols) => { const x = {}; for (const c of cols) x[c] = o[c] === undefined ? null : o[c]; return x; };
const rowsOf = (rows) => list(rows).map((r) => parseJ(r.j)).filter((o) => o && o.id);
const commitC3Plan = function commitC3Plan(entry, partRows, intentRows, polRows, ooRows, pohRows) {
  const base = { route: "GO", needIntent: "NO", intentRows: [], lineSlices: [], lineCount: 0, ooSlices: [], ooCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_GR" };
  const lines = rowsOf(polRows);
  const oos = rowsOf(ooRows);
  const hdrs = rowsOf(pohRows);
  const freshLine = {};
  for (const l of lines) freshLine[s(l.id)] = l;
  const freshOo = {};
  for (const o of oos) freshOo[s(o.id)] = o;
  const freshHdr = {};
  for (const h of hdrs) freshHdr[s(h.id)] = h;
  let intent = joinChunks(intentRows, "C3|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "C3_PO", "the recorded intent cannot be read", true));
  if (!intent) {
    const po = joinChunks(partRows, entry.partPrefix + "PO|");
    if (!po || !Array.isArray(po.poLines)) return Object.assign(base, stepEnd(entry, "C3_PO", "the purchase-order part of the prepared payload is missing", true));
    const missing = po.poLines.filter((l) => !freshLine[s(l.id)]).map((l) => s(l.id));
    if (missing.length) return Object.assign(base, stepEnd(entry, "C3_PO", missing.length + " purchase order line(s) vanished after the stock was received (e.g. " + missing.slice(0, 3).join(", ") + ")", true));
    const afterLine = {};
    const lineIntent = [];
    for (const l of po.poLines) {
      const cur = freshLine[s(l.id)];
      const poQty = q8(cur.quantity) || 0;
      const newReceivedQty = q8(num(cur.received_qty) + num(l.delta_received)) || 0;
      const newOutstandingQty = Math.max(0, q8(poQty - newReceivedQty)) || 0;
      const after = {
        received_qty: newReceivedQty,
        outstanding_quantity: newOutstandingQty,
        line_status: newOutstandingQty <= 0 ? "Completed" : "Processing",
        created_received_qty: po.fromCreated ? Math.max(0, q8(num(cur.created_received_qty) - num(l.release_created))) : q8(cur.created_received_qty || 0),
      };
      afterLine[s(l.id)] = after;
      lineIntent.push({ id: s(l.id), before: pickCols(cur, POL_COLS), after: after });
    }
    const ooIntent = [];
    for (const o of po.onOrder || []) {
      const rows = oos.filter((r) => s(r.po_line_id) === s(o.po_line_id)).sort((a, b) => (a.id.length - b.id.length) || (a.id < b.id ? -1 : 1));
      if (!rows.length) continue;
      const delta = o.delta_exact === undefined || o.delta_exact === null ? num(o.delta) : num(o.delta_exact);
      const after = { open_qty: q8(Math.max(0, num(rows[0].open_qty) - delta)), received_qty: q8(num(rows[0].received_qty) + delta) };
      for (const r of rows) ooIntent.push({ id: s(r.id), before: pickCols(r, OO_COLS), after: after });
    }
    const poDatas = hdrs.map((h) => Object.assign({}, h, {
      table_po: lines.filter((l) => s(l.purchase_order_id) === s(h.id) && !digits(l.parent_id)).map((l) => Object.assign({}, l, afterLine[s(l.id)] || {})),
    }));
    const hdrIntent = kaeXsqwm(poDatas).map((u) => ({ id: s(u.id), before: pickCols(freshHdr[s(u.id)], POH_COLS), after: pickCols(u, POH_COLS) }));
    intent = { lines: lineIntent, oo: ooIntent, headers: hdrIntent };
    base.needIntent = "YES";
    base.intentRows = chunkRows(entry, "C3|I|", intent);
  }
  const conflicts = [];
  const pass = (rows, fresh, cols, out, tag) => {
    for (const r of rows || []) {
      const cur = fresh[r.id];
      if (!cur) { conflicts.push(tag + r.id + " (gone)"); continue; }
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
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "C3_PO", conflicts.length + " purchase-order row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const lineOut = lineWrites.map((r) => ({ id: r.id, received_qty: qtyStr(r.received_qty), outstanding_quantity: qtyStr(r.outstanding_quantity), line_status: r.line_status,
    created_received_qty: qtyStr(r.created_received_qty) }));
  const ooOut = ooWrites.map((r) => ({ id: r.id, open_qty: qtyStr(r.open_qty), received_qty: qtyStr(r.received_qty) }));
  return Object.assign(base, { lineSlices: slicesOf(lineOut, 250), lineCount: lineOut.length, ooSlices: slicesOf(ooOut, 250), ooCount: ooOut.length, headerRows: hdrWrites,
    needHeaders: hdrWrites.length ? "YES" : "NO", result_message: lineOut.length + " PO line(s), " + ooOut.length + " on-order row(s), " + hdrWrites.length + " PO header(s) to write" });
};
const res = commitC3Plan([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc3part.data}}][0], [{{node:sql_node_RCc3intent.data}}][0], [{{node:sql_node_RCc3pol.data}}][0],
  [{{node:sql_node_RCc3oo.data}}][0], [{{node:sql_node_RCc3poh.data}}][0]);
console.log("commit C3 plan", JSON.stringify({ route: res.route, intent: res.needIntent, lines: res.lineCount, oo: res.ooCount, headers: res.headerRows.length, result: res.result_code, message: res.result_message }));
return res;
