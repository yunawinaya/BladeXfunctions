// C1's call into the lifted GENERATE_BATCH numbering (code/shared/batchnum.js bnNumber): fresh config rows, the BATCH part's
// items and the auto rows' requests in call order -> { error } or { numbers: [...], configs: [{ id, before, after }] }
// (an after.last_reset_date of null = GENERATE_BATCH left the column alone: it stays at before's value)
const batchnumGenerate = function batchnumGenerate(bncRows, requests, entry, items) {
  if (typeof bnNumber !== "function") return { error: "batch numbering is not wired into GR_COMPLETE_COMMIT" };
  if (!requests.length) return { numbers: [], configs: [] };
  const out = bnNumber(list(bncRows), items || [], requests, { now: Date.now() });
  if (!out || !out.ok) {
    const at = out ? out.failedAt : -1;
    const f = (out && out.results && out.results[at]) || {};
    return { error: "the batch number of row " + (at + 1) + " could not be generated: " + (s(f.message) || s(f.code) || "no answer") };
  }
  const configs = Object.keys(out.configs || {}).map((id) => {
    const c = out.configs[id];
    const before = { running_number: num(c.before.running_number), last_reset_date: c.before.last_reset_date === undefined ? null : c.before.last_reset_date };
    const after = { running_number: num(c.after.running_number), last_reset_date: c.after.last_reset_date === null || c.after.last_reset_date === undefined ? before.last_reset_date : c.after.last_reset_date };
    return { id: s(id), before: before, after: after };
  });
  return { numbers: out.results.map((r) => s(r.batch_number)), configs: configs };
};
