// PICKING_BULK_COMMIT - P0 REVALIDATE: the picked lines still have the pending / status PREPARE planned from, the Picking
// is still open and no Goods Delivery of the pick was cancelled or completed meanwhile -> P0 DONE; else the job FAILED and
// the Picking lock released (nothing was written)
const commitP0 = function commitP0(entry, payloadRows, facts) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const p = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  const snap = p.snapshot || { rows: {}, gds: {} };
  const rows = {};
  const gds = {};
  let hdr = null;
  for (const f of list(facts)) {
    if (f.kind === "ROW") rows[s(f.id)] = f;
    else if (f.kind === "GD") gds[s(f.id)] = s(f.v1);
    else if (f.kind === "HDR") hdr = f;
  }
  const changed = [];
  if (!hdr) changed.push("the Picking was deleted");
  else if (["Completed", "Cancelled"].indexOf(s(hdr.v1)) >= 0) changed.push("the Picking is " + s(hdr.v1));
  for (const id of Object.keys(snap.rows || {})) {
    const f = rows[id];
    const want = snap.rows[id];
    if (!f) changed.push("line " + id + " was removed");
    else if (q8(f.v1) !== q8(want.pending) || s(f.v2) !== s(want.status)) changed.push("line " + id + " changed (pending " + q8(want.pending) + " -> " + q8(f.v1) + ", " + s(want.status) + " -> " + s(f.v2) + ")");
  }
  for (const g of Object.keys(snap.gds || {})) {
    const st = gds[g];
    if (st === undefined) changed.push("Goods Delivery " + g + " was deleted");
    else if (st === "Cancelled" || st === "Completed") changed.push("Goods Delivery " + g + " is " + st);
  }
  const base = { route: "OK", stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", result_code: "", result_message: "" };
  if (!changed.length) return Object.assign(base, { stepRows: [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: "P0_REVALIDATE", step_status: "DONE", attempt_count: 1, started_at: entry.dbNow, finished_at: entry.dbNow, inventory_operation_id: "", result_ref: Object.keys(snap.rows || {}).length + " line(s) unchanged", error_code: null, error_message: null }], needStep: "YES", result_message: "revalidated" });
  const why = "the Picking changed after it was queued: " + changed.slice(0, 5).join("; ") + (changed.length > 5 ? "; and " + (changed.length - 5) + " more" : "") + ". Nothing was saved; reopen the Picking and confirm again";
  return Object.assign(base, {
    route: "FAIL",
    jobRows: [{ id: entry.jobId, job_status: "FAILED", progress_percent: 0, progress_message: "Not confirmed: the Picking changed meanwhile", attempt_count: entry.attempts, next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: "PK_STALE", error_message: why, error_details: JSON.stringify({ step: "P0_REVALIDATE", changed: changed.slice(0, 50) }), finished_at: entry.dbNow }],
    needJobUpd: "YES", unlockRows: [{ id: entry.pickingId, is_processing: 0 }], needUnlock: "YES", result_code: "PK_STALE", result_message: why,
  });
};
const entry = [{{node:code_node_PCentry.data}}][0];
const res = commitP0(entry, [{{node:sql_node_PCpayload.data}}][0], [{{node:sql_node_PCp0facts.data}}][0]);
console.log("commit P0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
