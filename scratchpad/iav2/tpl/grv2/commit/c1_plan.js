// GR_COMPLETE_COMMIT - C1 plan: the batch numbers. A re-run reuses the intent (C1|I|nnn); else the auto numbers are
// generated from a FRESH batch_number_config read as N sequential GENERATE_BATCH calls would (code/shared/batchnum.js)
const sqlText = (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "''");
const commitC1Plan = function commitC1Plan(entry, partRows, intentRows, bncRows) {
  const base = { route: "GO", hasIntent: "NO", draft: {}, numbersSql: "[]", stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO",
    batchDelRows: [], needBatchDel: "NO", freeRows: [], needFree: "NO", result_code: "", result_message: "", job_status: "COMMITTING_GR" };
  const part = joinChunks(partRows, entry.partPrefix + "BATCH|");
  if (!part || !Array.isArray(part.rows)) return Object.assign(base, failNoWrite(entry, "GRC_INVALID_DATA", "the batch part of the prepared payload is missing: no stock was moved"));
  const intent = joinChunks(intentRows, "C1|I|");
  if (intent === undefined) return Object.assign(base, failNoWrite(entry, "GRC_INVALID_DATA", "the recorded batch intent cannot be read: no stock was moved"));
  let numbers = intent ? intent.numbers || {} : null;
  if (!intent) {
    const autos = part.rows.filter((r) => !s(r.batch_number) && !digits(r.existing_batch_id));
    const gen = batchnumGenerate(bncRows, autos.map((r) => r.request), entry, part.items || []);
    if (gen.error) return Object.assign(base, failNoWrite(entry, "GRC_BATCH_CONFIG", gen.error + ": no stock was moved"));
    numbers = {};
    autos.forEach((r, i) => { numbers[s(r.key)] = s(gen.numbers[i]); });
    base.draft = { numbers: numbers, configs: gen.configs || [] };
  } else base.hasIntent = "YES";
  const seen = {};
  const nums = [];
  for (const r of part.rows) {
    if (digits(r.existing_batch_id)) continue;
    const n = s(r.batch_number) || s(numbers[s(r.key)]);
    if (!n) return Object.assign(base, failNoWrite(entry, "GRC_INVALID_DATA", "batch row " + s(r.key) + " has no number: no stock was moved"));
    if (!seen[n]) { seen[n] = true; nums.push({ n: n }); }
  }
  return Object.assign(base, { numbersSql: sqlText(JSON.stringify(nums)), result_message: nums.length + " batch number(s) to check" + (intent ? " (intent reused)" : "") });
};
const res = commitC1Plan([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc1part.data}}][0], [{{node:sql_node_RCc1intent.data}}][0], [{{node:sql_node_RCc1bnc.data}}][0]);
console.log("commit C1 plan", JSON.stringify({ route: res.route, intent: res.hasIntent, result: res.result_code, message: res.result_message }));
return res;
