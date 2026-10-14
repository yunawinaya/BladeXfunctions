// PICKING_BULK_PREPARE - Result: the job read back after the write is the answer (READY_TO_COMMIT / FAILED)
const prepareResult = function prepareResult(guard, entry, plan, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const e = entry || {};
  const p = plan || {};
  return {
    job_id: guard.jobId, job_status: job ? s(job.job_status) : "", result_code: s(p.result_code) || s(e.result_code), result_message: s(p.result_message) || s(e.result_message),
    line_count: String(p.recordCount || 0), evidence: JSON.stringify({ v: 1, workflow: "PICKING_BULK_PREPARE", entry: s(e.route), plan: s(p.route), records: p.recordCount || 0, rows: p.touchedRows || 0, gd_lines: p.gdLineCount || 0 }),
  };
};
const guard = [{{node:code_node_PPguard.data}}][0];
const res = prepareResult(guard, [{{node:code_node_PPentry.data}}][0], [{{node:code_node_PPplan.data}}][0], [{{node:sql_node_PPback.data}}][0]);
console.log("prepare result", JSON.stringify(res));
return res;
