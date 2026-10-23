// GD_ASYNC_SUBMIT - Credit check decision: classic's 402 / 403 (result "failed": "Block - " blocks, else an Override the form
// asks about); either one is answered before any job is made
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const cl = [{{node:workflow_node_GScl.data}}][0] || {};
const message = s(cl.message);
const failed = s(cl.result) === "failed";
const blocked = failed && message.indexOf("Block - ") !== -1;
const code = !failed ? "" : blocked ? "GD_CREDIT_LIMIT_BLOCKED" : "GD_CREDIT_LIMIT_OVERRIDE";
console.log("submit credit decision", JSON.stringify({ result: s(cl.result), code: code, message: message }));
return {
  route: code ? "STOP" : "GO",
  result_code: code,
  result_message: code ? message.replace(/^(Block|Override) - /, "") || (blocked ? "Credit limit exceeded" : "Credit limit warning") : "",
  job_id: "",
  job_status: "",
  created: "NO",
  idempotency_key: s([{{node:code_node_EluyWNR5.data.idempotencyKey}}][0]),
  payload_hash: s([{{node:code_node_EluyWNR5.data.payloadHash}}][0]),
  gd_id: "",
  gd_no: "",
  progress_message: "",
  line_errors: "[]",
  evidence: JSON.stringify({ v: 1, workflow: "GD_ASYNC_SUBMIT", path: code ? (blocked ? "CREDIT_BLOCK" : "CREDIT_OVERRIDE") : "CREDIT_OK", result: s(cl.result), total: [{{node:code_node_GSclPlan.data.total}}][0] }),
};
