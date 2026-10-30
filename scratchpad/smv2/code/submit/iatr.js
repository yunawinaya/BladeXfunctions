// LOT_V2_SUBMIT - IA transfer request (ENH-20261027-001, scratchpad/iatr). A dispatch (STAGE from Requested): a Created IA's
// request (reserved, Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md) goes on when its lines are as stored and its
// picks and the IA's reservation each equal what is requested (rrDispatchCheck); a Draft IA's request (made before reserved
// requests) only when every line is picked in full and is exactly what its Item Assembly asks for now (iatrDispatchCheck). A
// receipt only as it was dispatched (not edited); a Created IA's carries good / defect per line (form.iatr_receipts, rrReceivePlan),
// stored for PREPARE as the S|<nonce>|RECEIPTS part. Every other transfer passes untouched
const submitIatr = function submitIatr(guard, entry, keys, gate, form, readRows) {
  const go = { route: "GO", code: "", message: "", errorCode: "", partNames: [], partChunks: [] };
  const stop = (message, code) => ({ route: "STOP", code: "400", message: message, errorCode: code || "LOT_REQUEST_MOVE", partNames: [], partChunks: [] });
  if (s(entry.purpose) !== "YES") return go;
  if (s(entry.action) === "COMPLETE" && num(gate.edited) === 1) {
    return stop("This dispatched request can't be edited: receive it as it was dispatched, or cancel it.");
  }
  if (s(keys.needIatr) !== "YES") return go;
  const row = list(readRows)[0] || {};
  const r = (typeof row.j === "string" ? iatrParseObj(row.j) : row.j) || {};
  const stored = list(r.lines);
  const ia = r.ia && typeof r.ia === "object" ? r.ia : {};
  if (s(keys.iatrMode) === "RECEIVE") {
    if (s(ia.status) !== "Created") return go;
    const receipts = rrReceiptsOf(stored, form && form.iatr_receipts);
    const rv = rrReceivePlan(stored, receipts, { iaId: s(entry.sourceIaId), lotId: s(guard.lotId), location_id: s((stored[0] || {}).location_id) });
    if (!rv.ok) return stop(rv.message, rv.code);
    const long = stored.findIndex((l) => s((receipts[s(l.id)] || {}).reason).length > 255);
    if (long >= 0) return stop("Line " + (long + 1) + ": the defect reason is too long (255 characters at most).", "IATR_DEFECT_REASON");
    const text = JSON.stringify({ lotId: s(guard.lotId), receipts: receipts });
    const prefix = "S|" + guard.nonce + "|RECEIPTS|";
    for (let at = 0, n = 1; at < text.length || n === 1; at += LOT_CHUNK, n++) {
      go.partNames.push(prefix + String(n).padStart(3, "0"));
      go.partChunks.push(text.slice(at, at + LOT_CHUNK));
    }
    return go;
  }
  if (s(ia.status) === "Created") {
    const c = rrDispatchCheck(stored, flatOf(form && form.stock_movement), list(r.holds));
    return c.ok ? go : stop(c.message, c.code);
  }
  const items = {};
  for (const it of list(r.items)) if (it && s(it.id)) items[s(it.id)] = it;
  const dest = stored[0] || {};
  const demand = iatrDemand(list(r.ia_lines), items);
  const iaFp = demand.ok ? iatrFingerprint(demand.lines, { plant: ia.plant, storage: dest.storage_location_id, bin: dest.location_id, itemId: ia.item_id,
    itemQty: ia.item_qty, plannedQty: ia.planned_output_qty, mode: ia.bom_consumption_mode, bomId: ia.source_bom_id }) : "IR2:" + demand.message;
  const incoming = flatOf(form && form.stock_movement);
  const c = iatrDispatchCheck(stored, incoming, { iaStatus: ia.status, iaFp: iaFp, lotFp: s(entry.sourceIaFp), demand: demand.ok ? demand.lines : null });
  return c.ok ? go : stop(c.message, c.code);
};
// a JSON object from SQL text (16+ digit numbers kept as text)
const iatrParseObj = function iatrParseObj(t) {
  try {
    return JSON.parse(String(t || "").replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, n) => (n === undefined ? m : pre + '"' + n + '"')));
  } catch (e) {
    return null;
  }
};
const res = submitIatr([{{node:code_node_LSguard.data}}][0], [{{node:code_node_LSentry.data}}][0], [{{node:code_node_LSkeys.data}}][0], [{{node:code_node_LSgate.data}}][0],
  [{{workflowparams:form}}][0], [{{node:sql_node_LSiatr.data}}][0]);
console.log("submit iatr", JSON.stringify({ route: res.route, code: res.errorCode, parts: res.partNames.length }));
return res;
