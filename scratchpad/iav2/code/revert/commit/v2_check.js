// IA_REVERT_V2_COMMIT - V2 check: every costing row of the part at its after-values -> DONE, else retry
const commitV2Check = function commitV2Check(entry, inp, fifoRows, waRows) {
  const fifo = byId(fifoRows);
  const wa = byId(waRows);
  const off = [];
  for (const r of list(inp.fifo)) if (!fifo[s(r.id)] || String(fifo[s(r.id)].is_deleted) !== "1") off.push("FIFO layer " + s(r.id));
  for (const r of list(inp.waDelete)) if (!wa[s(r.id)] || String(wa[s(r.id)].is_deleted) !== "1") off.push("weighted-average row " + s(r.id));
  for (const r of list(inp.waRestate)) {
    const cur = wa[s(r.id)];
    if (!cur || !Object.keys(r.after || {}).every((c) => iaSameStored(r.after[c], cur[c]))) off.push("weighted average " + s(r.id));
  }
  if (off.length) return stepEnd(entry, "V2_COST", off.length + " costing row(s) not as intended after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "V2_COST", list(inp.fifo).length + " FIFO layer(s), " + list(inp.waDelete).length + " weighted-average row(s) removed, " + list(inp.waRestate).length + " restated",
    "costing restored");
};
const res = commitV2Check([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCv2in.data}}][0], [{{node:sql_node_IVCv2fifoB.data}}][0], [{{node:sql_node_IVCv2waB.data}}][0]);
console.log("commit V2 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
