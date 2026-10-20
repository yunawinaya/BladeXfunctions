// PICKING_BULK_PREPARE 1d - Force complete: the deliveries' lines, every record of them (with its bin / batch / HU names), the
// other open Pickings naming them -> fcPlan -> parts (gd_publish_step FCD|<nonce>|<gi>|<nnn>, each delivery's {cells, removed, base}
// in result_ref) + the job READY_TO_COMMIT (prepared_payload: CONFIRM's shape - no records, no GD line updates, the row patch -
// plus the fc manifest), or FAILED with the reason and the Picking unlocked. Nothing is written to a delivery here.
const FC_CHUNK = 400000;
const fcDbAddSeconds = function fcDbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const prepareFc = function prepareFc(entry, hdrRows, lineRows, gdRows, recRows, otherRows, uuid) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const num = (v) => Number(v) || 0;
  const q8 = (v) => Number(v).toFixed(8);
  const e = entry || {};
  const jobId = s(e.jobId), pickingId = s(e.pickingId), org = s(e.organizationId);
  const req = e.request || {};
  const nonce = (s(uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8).toLowerCase();
  const endNow = (Number(e.jsAt) > 0 ? fcDbAddSeconds(e.dbNow, Math.max(0, Math.floor((Date.now() - Number(e.jsAt)) / 1000))) : "") || s(e.dbNow);
  const base = { route: "FAIL", nonce: nonce, partRows: [], needParts: "NO", readyRows: [], needReady: "NO", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO",
    result_code: "", result_message: "", job_status: "", gdCount: 0, partCount: 0 };
  const fail = (code, message) => Object.assign({}, base, {
    jobRows: [{ id: jobId, job_status: "FAILED", progress_percent: 0, progress_message: ("Not force completed: " + message).slice(0, 250), row_version: num(e.rowVersion) + 1,
      error_code: code, error_message: message, error_details: JSON.stringify({ step: "PICKING_BULK_PREPARE", operation: "FORCE_COMPLETE" }), lease_owner: null, lease_expires_at: null,
      finished_at: endNow || null }],
    needJobUpd: "YES", unlockRows: /^[0-9]{1,20}$/.test(pickingId) ? [{ id: pickingId, is_processing: 0 }] : [], needUnlock: /^[0-9]{1,20}$/.test(pickingId) ? "YES" : "NO",
    result_code: code, result_message: message, job_status: "FAILED",
  });
  if (s(e.route) === "FAIL") return fail(s(e.result_code) || "PK_INVALID_REQUEST", s(e.result_message) || "the request is not valid");
  const hdr = list(hdrRows).filter((r) => s(r.id))[0] || null;
  if (!hdr || String(hdr.is_deleted) === "1") return fail("PK_NOT_FOUND", "Picking " + pickingId + " was not found");
  // SUBMIT sent these to the classic force complete; a setup changed since then is refused rather than half-handled
  if (s(hdr.picking_after) === "Sales Order" || num(hdr.allow_full_picking) === 1 || num(hdr.auto_completed_gd) === 1 || num(hdr.setup_loading_bay) === 1 || num(hdr.is_loading_bay) === 1) {
    return fail("PK_FC_SETUP_CHANGED", "Picking Setup changed since the force complete was submitted (Picking Plan, Full Picking, Auto Complete GD or Loading Bay): nothing was saved. Try again.");
  }
  const gds = {};
  for (const g of list(gdRows)) if (s(g.goods_delivery_id) && !gds[s(g.goods_delivery_id)]) gds[s(g.goods_delivery_id)] = { id: s(g.goods_delivery_id), delivery_no: s(g.delivery_no), gd_status: s(g.gd_status) };
  const names = { bins: {}, batches: {}, hus: {} };
  const nm = (map, id, name) => { if (s(id) && s(name)) names[map][s(id)] = s(name); };
  for (const r of list(recRows)) {
    nm("bins", r.source_bin, r.source_bin_name); nm("bins", r.target_location, r.target_location_name);
    nm("batches", r.batch_no, r.batch_name); nm("batches", r.target_batch, r.target_batch_name); nm("hus", r.handling_unit_id, r.hu_name);
  }
  const rows = list(lineRows).filter((r) => s(r.id));
  const plan = fcPlan({ picking: { id: s(hdr.id), to_id: s(hdr.to_id), to_status: s(hdr.to_status) }, rows: rows, gds: Object.keys(gds).map((k) => gds[k]),
    gdLines: list(gdRows), records: list(recRows), otherOpen: list(otherRows), names: names });
  if (!plan.ok) return fail(plan.code, plan.message);

  const partRows = [];
  for (const d of plan.deltas) {
    const text = JSON.stringify({ cells: d.cells, removed: d.removed, base: d.base });
    for (let at = 0, k = 0; at < text.length; at += FC_CHUNK, k++) {
      partRows.push({ job_id: jobId, organization_id: org, step_name: "FCD|" + nonce + "|" + d.gi + "|" + String(k).padStart(3, "0"), step_status: "PAYLOAD", attempt_count: 0,
        result_ref: text.slice(at, at + FC_CHUNK) });
    }
  }
  const rowPatch = {}, snapRows = {};
  const byId = {};
  for (const r of rows) byId[s(r.id)] = r;
  for (const p of plan.rowPatch) {
    rowPatch[p.id] = { line_status: p.line_status, pending_process_qty: 0, picked_qty: 0 };
    snapRows[p.id] = { pending: q8(num((byId[p.id] || {}).pending_process_qty)), status: s((byId[p.id] || {}).line_status) };
  }
  const gdIdsAll = Object.keys(rows.reduce((o, r) => Object.assign(o, s(r.gd_id) && s(r.line_status) !== "Cancelled" ? { [s(r.gd_id)]: true } : {}), {})).sort();
  const c = plan.counts;
  const message = s(hdr.to_id) + " force completed: " + c.gds + " deliver" + (c.gds === 1 ? "y" : "ies") + " updated, " + c.reduced + " line(s) reduced, " + c.removed + " removed";
  const snapGds = {};
  for (const g of gdIdsAll) snapGds[g] = (gds[g] || {}).gd_status || "";
  const prepared = {
    v: 1, prepared_by: "PICKING_BULK_PREPARE", job_id: jobId, picking_id: pickingId, picking_no: s(hdr.to_id), organization_id: org, plant_id: s(hdr.plant_id),
    operation: "FORCE_COMPLETE", full_picking: 0, confirmed_by: s(req.confirmed_by), confirmed_at: s(e.confirmedAt),
    header_patch: {}, records: [], row_patch: rowPatch, gd_lines: [], gd_ids: gdIdsAll, gd_ids_all: gdIdsAll,
    snapshot: { to_status: s(hdr.to_status), rows: snapRows, gds: snapGds }, clamped: [], result_message: message,
    packing: { required: num(hdr.packing_required) === 1 ? 1 : 0, auto: num(hdr.auto_trigger_pkg) === 1 ? 1 : 0, packing_mode: s(hdr.packing_mode) },
    fc: { nonce: nonce, manifest: plan.deltas.map((d) => ({ gi: d.gi, gd_id: d.gd_id, gd_no: d.gd_no, so_line_ids: d.so_line_ids, weight: d.weight })), counts: c, fp: plan.snapshot },
  };
  const ready = {
    id: jobId, job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to force complete: " + c.gds + " deliver" + (c.gds === 1 ? "y" : "ies") + " to update").slice(0, 250),
    row_version: num(e.rowVersion) + 1, error_code: null, error_message: null, error_details: null,
    prepared_payload: JSON.stringify(prepared), line_count: Object.keys(rowPatch).length, picking_no: s(hdr.to_id),
  };
  return Object.assign({}, base, { route: "OK", partRows: partRows, needParts: partRows.length ? "YES" : "NO", readyRows: [ready], needReady: "YES",
    result_message: message, job_status: "READY_TO_COMMIT", gdCount: plan.deltas.length, partCount: partRows.length });
};
const res = prepareFc({ jobId: [{{node:code_node_PPentry.data.jobId}}][0], pickingId: [{{node:code_node_PPentry.data.pickingId}}][0], rowVersion: [{{node:code_node_PPentry.data.rowVersion}}][0],
  dbNow: [{{node:code_node_PPentry.data.dbNow}}][0], jsAt: [{{node:code_node_PPentry.data.jsAt}}][0], organizationId: [{{node:code_node_PPentry.data.organizationId}}][0],
  confirmedAt: [{{node:code_node_PPentry.data.confirmedAt}}][0], request: [{{node:code_node_PPentry.data.request}}][0], route: [{{node:code_node_PPentry.data.route}}][0] },
  [{{node:sql_node_PPhdr.data}}][0], [{{node:sql_node_PPlines.data}}][0], [{{node:sql_node_PPfcGd.data}}][0], [{{node:sql_node_PPfcRecs.data}}][0], [{{node:sql_node_PPfcOther.data}}][0],
  [{{system:uuid}}][0]);
console.log("prepare fc", JSON.stringify({ route: res.route, gds: res.gdCount, parts: res.partCount, result: res.result_code, message: res.result_message }));
return res;
