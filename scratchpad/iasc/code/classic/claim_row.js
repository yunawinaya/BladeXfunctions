// IA_SAVE - MIN-02: our claim row: the IA's next claim number (the highest ever + 1: the unique key counts soft-deleted rows too), HELD
// at the server clock (UTC+8, IA_HOLD's)
const cin = [{{node:code_node_IAclaimIn.data}}][0] || {};
const rows = [{{node:sql_node_IAclaimState.data}}][0];
let st = {};
try {
  const r = (Array.isArray(rows) ? rows : rows ? [rows] : [])[0];
  st = (r && r.j !== undefined ? (typeof r.j === "string" ? JSON.parse(r.j) : r.j) : null) || {};
} catch (e) {
  st = {};
}
const n = (parseInt(st.max, 10) || 0) + 1;
const name = "CLAIM|" + n;
return { rows: [{ job_id: "IAS|" + String(cin.ia), organization_id: String(cin.org), step_name: name, step_status: "HELD", attempt_count: 1,
  started_at: String(st.now || ""), finished_at: null, inventory_operation_id: "", result_ref: "", error_code: "", error_message: "" }], name: name };
