// Accumulate one entry per V2 submit: GD_ASYNC_SUBMIT answers a job id (queued) or a result code (refused, no job made)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const raw = [{{node:get_results.data}}][0];
let results = [];
if (raw) {
  results = typeof raw === "string" ? JSON.parse(raw) : raw;
}
if (!Array.isArray(results)) results = [];
const lineErrors = [{{node:wf_v2submit.data.line_errors}}][0];
results.push({
  so_no: s([{{node:loop_payloads.so_no}}][0]),
  route: "V2",
  code: s([{{node:wf_v2submit.data.result_code}}][0]),
  message: s([{{node:wf_v2submit.data.result_message}}][0]),
  job_id: s([{{node:wf_v2submit.data.job_id}}][0]),
  job_status: s([{{node:wf_v2submit.data.job_status}}][0]),
  gd_no: s([{{node:wf_v2submit.data.gd_no}}][0]),
  line_errors: typeof lineErrors === "string" ? lineErrors : JSON.stringify(lineErrors || []),
});
return { results: results };
