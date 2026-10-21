// GR's _batchnum_adapter.js for SUBMIT's dry run and COMMIT D1 (CONTRACT.md section 6); duplicates are D1's, so no `existing`
const idaBnS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const idaBnNum = (v) => Number(v || 0);
const idaBnRows = (rows) => (Array.isArray(rows) ? rows : rows ? [rows] : []).map((r) => {
  if (r && typeof r === "object" && typeof r.j === "string") {
    try {
      return JSON.parse(r.j);
    } catch (e) {
      return {};
    }
  }
  return r && typeof r === "object" ? r : {};
});
const idaBatchnum = function idaBatchnum(configRows, itemRows, requests, now) {
  if (typeof bnNumber !== "function") return { error: "batch numbering (code/shared/batchnum.js) is not included", failedAt: -1 };
  const reqs = Array.isArray(requests) ? requests : [];
  if (!reqs.length) return { numbers: [], configs: [] };
  const cfg = Array.isArray(configRows) ? configRows : configRows ? [configRows] : [];
  let out = null;
  try {
    out = bnNumber(cfg, itemRows || [], reqs, { now: typeof now === "number" ? now : Date.now() });
  } catch (e) {
    // a lifted GENERATE_BATCH body threw (e.g. a NULL batch_format): name the configurations without a format
    const bad = idaBnRows(cfg).filter((c) => typeof c.batch_format !== "string" || c.batch_format === "").map((c) => idaBnS(c.id)).filter((x) => x);
    return { error: "The batch number could not be generated" + (bad.length ? " (batch number configuration " + bad.join(", ") + " has no batch format)" : "")
      + ": " + (idaBnS(e && e.message) || "the numbering failed"), failedAt: -1 };
  }
  if (!out || !out.ok) {
    const at = out ? out.failedAt : -1;
    const f = (out && out.results && out.results[at]) || {};
    return { error: idaBnS(f.message) || idaBnS(f.code) || "the batch number could not be generated", failedAt: at };
  }
  const configs = Object.keys(out.configs || {}).map((id) => {
    const c = out.configs[id] || {};
    const b = c.before || {};
    const a = c.after || {};
    const before = { running_number: idaBnNum(b.running_number), last_reset_date: b.last_reset_date === undefined ? null : b.last_reset_date };
    const after = { running_number: idaBnNum(a.running_number), last_reset_date: a.last_reset_date === null || a.last_reset_date === undefined ? before.last_reset_date : a.last_reset_date };
    return { id: idaBnS(id), before: before, after: after };
  });
  return { numbers: out.results.map((r) => idaBnS(r.batch_number)), configs: configs };
};
if (typeof module !== "undefined") module.exports = { idaBatchnum };
