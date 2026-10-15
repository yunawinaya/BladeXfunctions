// GR_REVERT_COMMIT - R4 check: every intent row reads back at its after-values -> the purchase-order locks freed + R4 DONE
const commitR4Check = function commitR4Check(entry, intentRows, polRows, ooRows, pohRows) {
  const intent = joinChunks(intentRows, "R4|I|");
  if (!intent) return stepEnd(entry, "R4_PO", "the intent was not recorded", false);
  const sets = [[intent.lines, byId(polRows), ["received_qty", "outstanding_quantity", "line_status", "created_received_qty"], "PO line "],
    [intent.oo, byId(ooRows), ["open_qty", "received_qty"], "on-order "], [intent.headers, byId(pohRows), ["po_status", "gr_status", "partially_received", "fully_received"], "PO "]];
  const off = [];
  for (const [rows, cur, cols, tag] of sets) {
    for (const r of rows || []) {
      const c = cur[r.id];
      if (!c || !cols.every((k) => sameStored(r.after[k], c[k]))) off.push(tag + r.id);
    }
  }
  if (off.length) return stepEnd(entry, "R4_PO", off.length + " purchase-order row(s) not at the intended values after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  const ok = stepOk(entry, "R4_PO", (intent.lines || []).length + " PO line(s), " + (intent.oo || []).length + " on-order row(s), " + (intent.headers || []).length + " PO header(s)", "purchase orders restored");
  ok.freeRows = freeRowsOf(entry);
  ok.needFree = ok.freeRows.length ? "YES" : "NO";
  return ok;
};
const res = commitR4Check([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr4intentB.data}}][0], [{{node:sql_node_VCr4polB.data}}][0], [{{node:sql_node_VCr4ooB.data}}][0], [{{node:sql_node_VCr4pohB.data}}][0]);
console.log("commit R4 check", JSON.stringify({ route: res.route, free: (res.freeRows || []).length, result: res.result_code, message: res.result_message }));
return res;
