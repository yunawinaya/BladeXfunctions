// PICKING_BULK_COMMIT - P6 FINISH: the Picking lock released (is_processing 0) and the job COMPLETED with the picker's
// message (the clamp report of code_node_ClampMsg when a line was reduced)
const commitFinish = function commitFinish(entry, payloadRows, p5) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  let p = {};
  try {
    p = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  } catch (e) {
    p = {};
  }
  const message = s(p.result_message) || "Picking processed successfully";
  const clamped = Array.isArray(p.clamped) ? p.clamped : [];
  return {
    unlockRows: [{ id: entry.pickingId, is_processing: 0 }],
    jobRows: [{ id: entry.jobId, job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), attempt_count: entry.attempts, next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: clamped.length ? "PK_CLAMPED" : null, error_message: clamped.length ? message : null, error_details: clamped.length ? JSON.stringify({ clamped: clamped.slice(0, 200) }) : null, finished_at: entry.dbNow }],
    result_message: message + (s(p5 && p5.result_message) ? " (" + s(p5.result_message) + ")" : ""),
  };
};
const entry = [{{node:code_node_PCentry.data}}][0];
const res = commitFinish(entry, [{{node:sql_node_PCpayload.data}}][0], [{{node:code_node_PCp5check.data}}][0]);
console.log("commit finish", JSON.stringify({ message: res.result_message }));
return res;
