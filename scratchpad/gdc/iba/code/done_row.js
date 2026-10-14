// INVENTORY_BULK_APPLY step rows: IBA|DONE carries the per-movement answer a repeat call returns; IBA|REVIEW the reason
const s = (v) => (v === undefined || v === null ? "" : String(v));
const op = s([{{node:code_node_IBguard.data.operationKey}}][0]);
const org = s([{{node:code_node_IBguard.data.organizationId}}][0]);
const verify = [{{node:code_node_IBverify.data}}][0] || {};
const plan = [{{node:code_node_IBplan.data}}][0] || {};
const ok = s(verify.route) === "DONE";
const row = ok
  ? { job_id: op, organization_id: org, step_name: "IBA|DONE", step_status: "DONE", attempt_count: 0, result_ref: JSON.stringify({ results: plan.results || [], summary: plan.summary || {} }) }
  : { job_id: op, organization_id: org, step_name: "IBA|REVIEW", step_status: "REVIEW", attempt_count: 0, error_code: "READBACK", error_message: s(verify.problems) };
return { rows: [row], ok: ok ? "YES" : "NO" };
