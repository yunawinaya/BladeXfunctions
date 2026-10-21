// GR_COMPLETE_COMMIT - C1 decide: against the live batch rows of the organization with those numbers (compared as
// utf8mb4_general_ci does) - an auto number another batch holds -> FAILED ("Duplicate Batch Format found.",
// GENERATE_BATCH's get-node check); a row whose number + item + plant exists -> that batch is reused
// (code_node_ip8w2l8k / search_existing_batch, oldest first); else ONE batch row per number + item (add_node_F9KqZLfd's
// columns, no parent_transaction_no) - none for a line that only consumes a number (insert false: stock control 0). The
// intent (numbers, configs before / after, reuse) is recorded before anything is written; the configs get their
// after-state unless they already hold it or have moved past it
const commitC1Decide = function commitC1Decide(entry, plan, partRows, intentRows, bncRows, dupRows) {
  const base = { route: "GO", intentRows: [], needIntent: "NO", bncRows: [], needBnc: "NO", batchRows: [], needBatch: "NO", stepRows: [], needStep: "NO", jobRows: [],
    needJobUpd: "NO", unlockRows: [], needUnlock: "NO", batchDelRows: [], needBatchDel: "NO", freeRows: [], needFree: "NO", result_code: "", result_message: "", job_status: "COMMITTING_GR" };
  const part = joinChunks(partRows, entry.partPrefix + "BATCH|") || { rows: [] };
  const rows = list(dupRows).map((r) => parseJ(r.j)).filter((o) => o && o.id);
  const mine = rows.filter((o) => s(o.transaction_no) === entry.grNo);
  const others = rows.filter((o) => s(o.transaction_no) !== entry.grNo);
  const ours = mine.map((o) => s(o.id));
  let intent = plan.hasIntent === "YES" ? null : plan.draft;
  const recorded = plan.hasIntent === "YES";
  const byId = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);
  if (!recorded) {
    const numbers = intent.numbers || {};
    const adopt = {};
    for (const r of part.rows) {
      if (digits(r.existing_batch_id)) continue;
      const n = s(r.batch_number) || s(numbers[s(r.key)]);
      const auto = !s(r.batch_number);
      if (auto && others.some((o) => batchKey(o.batch_number) === batchKey(n))) {
        return Object.assign(base, failNoWrite(entry, "GRC_BATCH_DUPLICATE", "Duplicate Batch Format found. (generated batch number " + n + "): no stock was moved", ours));
      }
      const same = others.filter((o) => batchKey(o.batch_number) === batchKey(n) && s(o.material_id) === s(r.material_id) && s(o.plant_id) === s(r.plant_id)).map((o) => s(o.id)).sort(byId);
      if (same.length) adopt[s(r.key)] = same[0];
    }
    intent = { numbers: numbers, configs: intent.configs || [], adopt: adopt };
    base.intentRows = chunkRows(entry, "C1|I|", intent);
    base.needIntent = "YES";
  } else intent = joinChunks(intentRows, "C1|I|") || { numbers: {}, configs: [], adopt: {} };
  // configs: write the after-state unless already there or moved past it (a running number never goes back)
  const fresh = {};
  for (const r of list(bncRows)) {
    const o = parseJ(r.j);
    if (o && o.id) fresh[s(o.id)] = o;
  }
  for (const c of intent.configs || []) {
    const cur = fresh[s(c.id)];
    if (!cur) return Object.assign(base, failNoWrite(entry, "GRC_BATCH_CONFIG", "batch number configuration " + s(c.id) + " no longer exists: no stock was moved", ours));
    const at = (x) => num(cur.running_number) === num(x.running_number) && s(cur.last_reset_date) === s(x.last_reset_date);
    const ahead = s(cur.last_reset_date) > s(c.after.last_reset_date) || (s(cur.last_reset_date) === s(c.after.last_reset_date) && num(cur.running_number) >= num(c.after.running_number));
    if (at(c.after) || (!at(c.before) && ahead)) continue;
    base.bncRows.push({ id: s(c.id), running_number: num(c.after.running_number), last_reset_date: c.after.last_reset_date === undefined || c.after.last_reset_date === null ? (cur.last_reset_date === undefined ? null : cur.last_reset_date) : c.after.last_reset_date });
  }
  // batch rows: one per number + item, skipping reused batches and rows an earlier run of this job inserted
  const have = {};
  for (const o of mine) have[batchKey(o.batch_number) + "|" + s(o.material_id)] = true;
  const made = {};
  for (const r of part.rows) {
    if (r.insert === false || digits(r.existing_batch_id) || digits((intent.adopt || {})[s(r.key)])) continue;
    const n = s(r.batch_number) || s((intent.numbers || {})[s(r.key)]);
    const k = batchKey(n) + "|" + s(r.material_id);
    if (have[k] || made[k]) continue;
    made[k] = true;
    base.batchRows.push({ batch_number: n, material_id: s(r.material_id), initial_quantity: qtyStr(r.initial_quantity), transaction_no: entry.grNo, plant_id: s(r.plant_id),
      organization_id: s(r.organization_id), remark: r.remark === undefined ? null : r.remark, remark2: r.remark2 === undefined ? null : r.remark2,
      remark3: r.remark3 === undefined ? null : r.remark3, manufacturing_date: r.manufacturing_date || null, expired_date: r.expired_date || null });
  }
  base.needBnc = base.bncRows.length ? "YES" : "NO";
  base.needBatch = base.batchRows.length ? "YES" : "NO";
  base.result_message = base.batchRows.length + " batch row(s) to add, " + Object.keys(intent.adopt || {}).length + " reused, " + base.bncRows.length + " configuration(s) to advance";
  return base;
};
const res = commitC1Decide([{{node:code_node_RCentry.data}}][0], [{{node:code_node_RCc1plan.data}}][0], [{{node:sql_node_RCc1part.data}}][0], [{{node:sql_node_RCc1intent.data}}][0],
  [{{node:sql_node_RCc1bnc.data}}][0], [{{node:sql_node_RCc1dup.data}}][0]);
console.log("commit C1 decide", JSON.stringify({ route: res.route, intent: res.needIntent, batches: res.batchRows.length, configs: res.bncRows.length, result: res.result_code, message: res.result_message }));
return res;
