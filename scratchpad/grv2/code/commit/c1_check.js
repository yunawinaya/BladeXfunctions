// GR_COMPLETE_COMMIT - C1 check: every planned batch number has its batch row (this receipt's, or the one reused) and every
// configuration holds at least its after-state -> DONE; else retry, then FAILED (the receipt back, these batch rows removed)
const commitC1Check = function commitC1Check(entry, partRows, intentRows, bncRows, backRows) {
  const part = joinChunks(partRows, entry.partPrefix + "BATCH|") || { rows: [] };
  const intent = joinChunks(intentRows, "C1|I|");
  const mine = list(backRows).map((r) => parseJ(r.j)).filter((o) => o && o.id && s(o.transaction_no) === entry.grNo);
  const ours = mine.map((o) => s(o.id));
  const retry = (why) => (entry.attempts >= MAX_RETRIES ? failNoWrite(entry, "GRC_STEP_FAILED", "C1_BATCHES: " + why + " (after " + entry.attempts + " retries): no stock was moved", ours) : stepEnd(entry, "C1_BATCHES", why, false));
  if (!intent) return retry("the batch intent was not recorded");
  const ids = batchIdMap(entry, partRows, intentRows, backRows);
  const missing = part.rows.filter((r) => r.insert !== false && !ids[s(r.key)]).map((r) => s(r.key));
  if (missing.length) return retry(missing.length + " batch row(s) missing after the write (e.g. " + missing.slice(0, 3).join(", ") + ")");
  const count = {};
  for (const o of mine) {
    const k = batchKey(o.batch_number) + "|" + s(o.material_id);
    count[k] = (count[k] || 0) + 1;
  }
  const twice = Object.keys(count).filter((k) => count[k] > 1);
  if (twice.length) return retry(twice.length + " batch number(s) inserted twice (e.g. " + twice.slice(0, 3).join(", ") + ")");
  const fresh = {};
  for (const r of list(bncRows)) {
    const o = parseJ(r.j);
    if (o && o.id) fresh[s(o.id)] = o;
  }
  const behind = (intent.configs || []).filter((c) => {
    const cur = fresh[s(c.id)] || {};
    return s(cur.last_reset_date) < s(c.after.last_reset_date) || (s(cur.last_reset_date) === s(c.after.last_reset_date) && num(cur.running_number) < num(c.after.running_number));
  }).map((c) => s(c.id));
  if (behind.length) return retry(behind.length + " batch number configuration(s) behind their after-state (e.g. " + behind.slice(0, 3).join(", ") + ")");
  return stepOk(entry, "C1_BATCHES", mine.length + " batch row(s), " + Object.keys(intent.adopt || {}).length + " reused", "batches ready");
};
const res = commitC1Check([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc1part.data}}][0], [{{node:sql_node_RCc1intentB.data}}][0], [{{node:sql_node_RCc1bncB.data}}][0],
  [{{node:sql_node_RCc1back.data}}][0]);
console.log("commit C1 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
