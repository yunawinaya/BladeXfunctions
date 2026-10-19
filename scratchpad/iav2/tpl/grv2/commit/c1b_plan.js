// GR_COMPLETE_COMMIT - C1B plan: the generated batch numbers onto their GR lines (code_node_ApplyBatches' overlay), by line id
const commitC1bPlan = function commitC1bPlan(entry, grPartRows, intentRows, lineRows) {
  const base = { route: "GO", lineSlices: [], lineCount: 0, stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", batchDelRows: [],
    needBatchDel: "NO", freeRows: [], needFree: "NO", result_code: "", result_message: "", job_status: "COMMITTING_GR" };
  const g = joinChunks(grPartRows, entry.partPrefix + "GR|");
  const intent = joinChunks(intentRows, "C1|I|");
  if (!g || !intent) return Object.assign(base, failNoWrite(entry, "GRC_INVALID_DATA", "the receipt part or the batch intent is missing: no stock was moved"));
  const cur = {};
  for (const r of list(lineRows)) {
    const o = parseJ(r.j);
    if (o && o.id) cur[s(o.id)] = o;
  }
  const writes = [];
  for (const a of g.autoLines || []) {
    const n = s((intent.numbers || {})[s(a.key)]);
    if (!cur[s(a.id)] || !n) return Object.assign(base, failNoWrite(entry, "GRC_INVALID_DATA", "receipt line " + s(a.id) + " or its generated batch number is missing: no stock was moved"));
    if (s(cur[s(a.id)].item_batch_no) !== n) writes.push({ id: s(a.id), item_batch_no: n });
  }
  return Object.assign(base, { lineSlices: slicesOf(writes, 250), lineCount: writes.length, result_message: writes.length + " receipt line(s) to number" });
};
const res = commitC1bPlan([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc1bpart.data}}][0], [{{node:sql_node_RCc1bintent.data}}][0], [{{node:sql_node_RCc1blines.data}}][0]);
console.log("commit C1B plan", JSON.stringify({ route: res.route, lines: res.lineCount, result: res.result_code, message: res.result_message }));
return res;
