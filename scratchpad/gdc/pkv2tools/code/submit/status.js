// PICKING_ASYNC_SUBMIT - Status: the Picking's latest CONFIRM_PICKING job (open -> the form shows "being saved"; FAILED /
// REQUIRES_REVIEW / a reduced line -> the form reports it once)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const rows = [{{node:sql_node_PSstatus.data}}][0];
const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
return job
  ? { route: "STATUS", result_code: s(job.error_code), result_message: s(job.error_message) || s(job.progress_message), job_id: s(job.id), job_status: s(job.job_status) }
  : { route: "STATUS", result_code: "", result_message: "", job_id: "", job_status: "" };
