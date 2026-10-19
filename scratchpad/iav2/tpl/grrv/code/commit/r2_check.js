// GR_REVERT_COMMIT - R2 check: every FIFO layer and weighted-average batch row of the receipt removed, every restated
// weighted average at its after-values -> DONE
const WA_COLS = ["wa_quantity", "wa_cost_price"];
const commitR2Check = function commitR2Check(entry, inp, intentRows, fifoRows, waRows) {
  const intent = joinChunks(intentRows, "R2|I|");
  if (list(inp.waRestate).length && !intent) return stepEnd(entry, "R2_COSTING", "the intent was not recorded", false);
  const fifo = byId(fifoRows);
  const wa = byId(waRows);
  const off = [];
  for (const f of list(inp.fifo)) if (!fifo[s(f.id)] || String(fifo[s(f.id)].is_deleted) !== "1") off.push("FIFO layer " + s(f.id));
  for (const w of list(inp.waDelete)) if (!wa[s(w.id)] || String(wa[s(w.id)].is_deleted) !== "1") off.push("weighted-average row " + s(w.id));
  for (const r of (intent && intent.wa) || []) {
    const cur = wa[s(r.id)];
    if (!cur || !WA_COLS.every((c) => sameStored(r.after[c], cur[c]))) off.push("weighted average " + s(r.id));
  }
  if (off.length) return stepEnd(entry, "R2_COSTING", off.length + " costing row(s) not as intended after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "R2_COSTING", list(inp.fifo).length + " FIFO layer(s), " + list(inp.waDelete).length + " weighted-average row(s) removed, " + ((intent && intent.wa) || []).length + " restated",
    "costing restored");
};
const res = commitR2Check([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCr2in.data}}][0], [{{node:sql_node_VCr2intentB.data}}][0], [{{node:sql_node_VCr2fifoB.data}}][0],
  [{{node:sql_node_VCr2waB.data}}][0]);
console.log("commit R2 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
