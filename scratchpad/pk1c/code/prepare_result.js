// PICKING_BULK_PREPARE - Result: the job read back after the write is the answer (READY_TO_COMMIT / FAILED)
// 1c: a pick that moves stock answers with code_node_PPfinal (it ran: its route is set)
const prepareResult = function prepareResult(guard, entry, plan, rows, fin) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const e = entry || {};
  const p = fin && s(fin.route) ? fin : plan || {};
  return {
    job_id: guard.jobId, job_status: job ? s(job.job_status) : "", result_code: s(p.result_code) || s(e.result_code), result_message: s(p.result_message) || s(e.result_message),
    line_count: String(p.recordCount || 0), evidence: JSON.stringify({ v: 1, workflow: "PICKING_BULK_PREPARE", entry: s(e.route), plan: s((plan || {}).route), final: s((fin || {}).route), records: p.recordCount || 0, rows: p.touchedRows || 0, gd_lines: p.gdLineCount || 0 }),
  };
};
const res = prepareResult({ jobId: [{{node:code_node_PPguard.data.jobId}}][0] }, { route: [{{node:code_node_PPentry.data.route}}][0], result_code: [{{node:code_node_PPentry.data.result_code}}][0], result_message: [{{node:code_node_PPentry.data.result_message}}][0] },
  { route: [{{node:code_node_PPplan.data.route}}][0], result_code: [{{node:code_node_PPplan.data.result_code}}][0], result_message: [{{node:code_node_PPplan.data.result_message}}][0], recordCount: [{{node:code_node_PPplan.data.recordCount}}][0], touchedRows: [{{node:code_node_PPplan.data.touchedRows}}][0], gdLineCount: [{{node:code_node_PPplan.data.gdLineCount}}][0] },
  [{{node:sql_node_PPback.data}}][0],
  { route: [{{node:code_node_PPfinal.data.route}}][0], result_code: [{{node:code_node_PPfinal.data.result_code}}][0], result_message: [{{node:code_node_PPfinal.data.result_message}}][0], recordCount: [{{node:code_node_PPfinal.data.recordCount}}][0], touchedRows: [{{node:code_node_PPfinal.data.touchedRows}}][0], gdLineCount: [{{node:code_node_PPfinal.data.gdLineCount}}][0] });
console.log("prepare result", JSON.stringify(res));
return res;