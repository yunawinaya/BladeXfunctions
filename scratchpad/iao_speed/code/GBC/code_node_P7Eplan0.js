// GD_BULK_COMMIT - P7E_REORDER plan: the reorder signal of the old save's GD_CREATED (REORDER_SET_REDIS), once per job.
// Runs only after this run committed the job, and never writes a FAILED row: Entry reads any FAILED step as a clean
// failure and would soft-delete a delivery that is already Created. REORDER appends deltas, so a STARTED row is final.
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((r) => r);
const guard = [{{node:code_node_WaEyJtlE.data}}][0] || {};
const pre = [{{node:code_node_rZGbQJid.data}}][0] || {};
const tRoute = [{{node:code_node_Tbpchorx.data.tRoute}}][0];
const prepRows = list([{{node:sql_node_hSfouTOr.data}}][0]);
const NAME = "P7E_REORDER";
let why = "";
if (s(tRoute) !== "GD_COMMITTED") why = "the job was not committed by this run (" + s(tRoute) + ")";
else if ((pre.steps || {})[NAME]) why = NAME + " already recorded: never repeated";
let p = null;
if (!why) {
  try {
    p = JSON.parse(s((prepRows[0] || {}).prepared_payload));
  } catch (e) {
    p = null;
  }
  if (!p || !Array.isArray(p.lines)) why = "prepared_payload unreadable at P7E";
}
const rows = [];
if (!why) {
  // REORDER reads table_gd rows (temp_qty_data, gd_qty, base_qty); a bundle row is replaced by its items
  for (const top of p.lines) {
    if (!top) continue;
    const isBundle = !!s(top.item_bundle_id) && !s(top.material_id);
    const lineRows = isBundle ? (Array.isArray(top.children) ? top.children : []) : [top];
    for (const r of lineRows) {
      if (!r || !s(r.material_id)) continue;
      rows.push({ material_id: s(r.material_id), gd_qty: s(r.gd_qty), base_qty: s(r.base_qty), temp_qty_data: typeof r.temp_qty_data === "string" ? r.temp_qty_data : JSON.stringify(r.temp_qty_data || []) });
    }
  }
  if (!rows.length) why = "no stock lines";
}
const go = why === "";
const stepAddRows = go ? [{ job_id: s(guard.jobId), organization_id: s(pre.organizationId), step_name: NAME, step_status: "STARTED", attempt_count: 1, started_at: s(pre.dbNow), inventory_operation_id: s(pre.operationId), result_ref: String(rows.length), error_code: null, error_message: null }] : [];
console.log("publish P7E plan", JSON.stringify({ go: go, rows: rows.length, why: why }));
return { publish_route: go ? "CALL" : "SKIP", needP7E: go ? "YES" : "NO", stepAddRows: stepAddRows, latestRows: go ? rows : [], organizationId: s(pre.organizationId), rowCount: String(rows.length), dbNow: s(pre.dbNow), jsAt: s(pre.jsAt), result_message: go ? "GD_CREATED reorder, " + rows.length + " lines" : why };
