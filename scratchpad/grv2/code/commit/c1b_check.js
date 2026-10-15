// GR_COMPLETE_COMMIT - C1B check: every auto line reads back with its generated number -> DONE
const commitC1bCheck = function commitC1bCheck(entry, grPartRows, intentRows, lineRows) {
  const g = joinChunks(grPartRows, entry.partPrefix + "GR|") || {};
  const intent = joinChunks(intentRows, "C1|I|") || {};
  const cur = {};
  for (const r of list(lineRows)) {
    const o = parseJ(r.j);
    if (o && o.id) cur[s(o.id)] = o;
  }
  const off = (g.autoLines || []).filter((a) => !cur[s(a.id)] || s(cur[s(a.id)].item_batch_no) !== s((intent.numbers || {})[s(a.key)])).map((a) => s(a.id));
  if (off.length) {
    const why = off.length + " receipt line(s) without their batch number after the write (e.g. " + off.slice(0, 3).join(", ") + ")";
    return entry.attempts >= MAX_RETRIES ? failNoWrite(entry, "GRC_STEP_FAILED", "C1B_LINES: " + why + ": no stock was moved") : stepEnd(entry, "C1B_LINES", why, false);
  }
  return stepOk(entry, "C1B_LINES", (g.autoLines || []).length + " line(s) numbered", "receipt lines numbered");
};
const res = commitC1bCheck([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc1bpart.data}}][0], [{{node:sql_node_RCc1bintent.data}}][0], [{{node:sql_node_RCc1blinesB.data}}][0]);
console.log("commit C1B check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
