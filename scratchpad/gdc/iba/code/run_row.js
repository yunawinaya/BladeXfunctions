// INVENTORY_BULK_APPLY run marker: this call's generation (unique job / step: a twin call inserting the same generation fails its run)
const s = (v) => (v === undefined || v === null ? "" : String(v));
const st = [{{node:code_node_IBstate.data}}][0] || {};
return { rows: [{ job_id: s([{{node:code_node_IBguard.data.operationKey}}][0]), organization_id: s([{{node:code_node_IBguard.data.organizationId}}][0]),
  step_name: s(st.runStep), step_status: "RUNNING", attempt_count: 0, result_ref: s([{{node:code_node_IBguard.data.nonce}}][0]), started_at: s(st.dbNow),
  finished_at: s(st.dbNow), error_code: "", error_message: "" }] };
