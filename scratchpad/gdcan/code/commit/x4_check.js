// GD_CANCEL_COMMIT - X4 check: every SO line and header of the intent reads back at its after-values -> DONE
const SO_LINE_COLS = ["delivered_qty", "planned_qty", "outstanding_quantity", "line_status"];
const SO_HDR_COLS = ["so_status", "gd_status", "partially_delivered", "fully_delivered"];
const cancelX4Check = function cancelX4Check(entry, intentRows, lineRows, hdrRows) {
  const intent = joinChunks(intentRows, "X4|I|");
  if (!intent) return stepEnd(entry, "X4_SO", "the recorded intent cannot be read back", false);
  const now = {};
  for (const r of gcRows(lineRows).map(gcObj)) now[r.id] = r;
  const nowH = {};
  for (const r of gcRows(hdrRows).map(gcObj)) nowH[r.id] = r;
  const off = (intent.lines || []).filter((r) => !now[r.id] || !SO_LINE_COLS.every((c) => sameVal(now[r.id][c], r.after[c])));
  const offH = (intent.headers || []).filter((h) => !nowH[h.id] || !SO_HDR_COLS.every((c) => sameVal(nowH[h.id][c], h.after[c])));
  if (off.length || offH.length) return stepEnd(entry, "X4_SO", off.length + " SO line(s) and " + offH.length + " SO header(s) do not read back", false);
  return stepOk(entry, "X4_SO", (intent.lines || []).length + " SO line(s), " + (intent.headers || []).length + " SO header(s)", "sales orders updated");
};
const res = cancelX4Check([{{node:code_node_XCentry.data}}][0], [{{node:sql_node_XCx4intentB.data}}][0], [{{node:sql_node_XCx4linesB.data}}][0], [{{node:sql_node_XCx4hdrsB.data}}][0]);
console.log("commit X4 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
