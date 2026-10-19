// GR_COMPLETE_COMMIT - C3 check: every intent row reads back at its after-values -> the purchase-order locks freed + C3 DONE
const commitC3Check = function commitC3Check(entry, intentRows, polRows, ooRows, pohRows) {
  const intent = joinChunks(intentRows, "C3|I|");
  if (!intent) return stepEnd(entry, "C3_PO", "the intent was not recorded", false);
  const fresh = (rows) => { const m = {}; for (const r of list(rows)) { const o = parseJ(r.j); if (o && o.id) m[s(o.id)] = o; } return m; };
  const sets = [[intent.lines, fresh(polRows), ["received_qty", "outstanding_quantity", "line_status", "created_received_qty"], "PO line "],
    [intent.oo, fresh(ooRows), ["open_qty", "received_qty"], "on-order "], [intent.headers, fresh(pohRows), ["po_status", "gr_status", "partially_received", "fully_received"], "PO "]];
  const off = [];
  for (const [rows, cur, cols, tag] of sets) {
    for (const r of rows || []) {
      const c = cur[r.id];
      if (!c || !cols.every((k) => sameStored(r.after[k], c[k]))) off.push(tag + r.id);
    }
  }
  if (off.length) return stepEnd(entry, "C3_PO", off.length + " purchase-order row(s) not at the intended values after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  const ok = stepOk(entry, "C3_PO", (intent.lines || []).length + " PO line(s), " + (intent.oo || []).length + " on-order row(s), " + (intent.headers || []).length + " PO header(s)", "purchase orders updated");
  ok.freeRows = freeRowsOf(entry);
  ok.needFree = ok.freeRows.length ? "YES" : "NO";
  return ok;
};
const res = commitC3Check([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc3intentB.data}}][0], [{{node:sql_node_RCc3polB.data}}][0], [{{node:sql_node_RCc3ooB.data}}][0], [{{node:sql_node_RCc3pohB.data}}][0]);
console.log("commit C3 check", JSON.stringify({ route: res.route, free: (res.freeRows || []).length, result: res.result_code, message: res.result_message }));
return res;
