// PICKING_FC_DRIVE - Entry: the job must be a force complete READY_TO_COMMIT / COMMITTING_PICKING with a readable plan (fc:
// nonce, manifest, fingerprints). FC_GDS already written -> DONE, nothing written (the worker publishes). A live lease of
// another run -> WAIT, nothing written; else the claim: lease DRV|<nonce> for 10 min (the calling worker's lease is taken
// over, as COMMIT does), the Picking lock touched, and the loop's slots (at most 12 actions per call)
const DRIVE_SLOTS = 12;
const driveEntry = function driveEntry(guard, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const num = (v) => Number(v) || 0;
  const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
  const r = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((x) => x)[0] || {};
  const dbNow = s(r.db_now);
  const base = { route: "NONE", jobId: s(guard.jobId), organizationId: "0", pickingId: "0", pickingNo: "", jobStatus: s(r.job_status), dbNow: dbNow, runStart: dbNow,
    nonce: "", manifest: [], fp: {}, counts: {}, snapToStatus: "", snapGds: {}, gdIdsSql: "0", gdIdsAllSql: "0", edLikeSql: "1 = 0", slots: [],
    claimRows: [], needClaim: "NO", touchRows: [], needTouch: "NO", result_code: "", result_message: "" };
  const out = (route, code, message, extra) => Object.assign(base, { route: route, result_code: code || "", result_message: message || "" }, extra || {});
  if (!s(r.id) || String(r.is_deleted) === "1") return out("REJECT", "PK_INVALID_DATA", "job " + guard.jobId + " was not found");
  if (s(r.command) !== "CONFIRM_PICKING" || s(r.operation) !== "FORCE_COMPLETE") return out("REJECT", "PK_INVALID_DATA", "job " + guard.jobId + " is not a force complete");
  const status = s(r.job_status);
  if (status !== "READY_TO_COMMIT" && status !== "COMMITTING_PICKING") return out("NONE", "", "job is " + (status || "without a status") + ": nothing to drive");
  if (status === "COMMITTING_PICKING" && s(r.fc_steps).split(",").indexOf("FC_GDS") >= 0) return out("DONE", "", "every delivery is updated: the Picking is saved next");
  let fc = null, snapGds = {}, gdAll = [];
  try {
    fc = JSON.parse(s(r.fc) || "null");
    snapGds = JSON.parse(s(r.snap_gds) || "{}") || {};
    gdAll = JSON.parse(s(r.gd_ids_all) || "[]") || [];
  } catch (e) {
    fc = null;
  }
  const manifest = fc && Array.isArray(fc.manifest) ? fc.manifest.map((m) => ({ gi: num(m.gi), gd_id: s(m.gd_id), gd_no: s(m.gd_no),
    so_line_ids: (Array.isArray(m.so_line_ids) ? m.so_line_ids : []).map(s), weight: num(m.weight) })) : null;
  if (!fc || !/^[0-9a-z]{8}$/.test(s(fc.nonce)) || !manifest || !manifest.every((m, i) => m.gi === i && digits(m.gd_id)) || !digits(r.picking_id)) {
    return out("REJECT", "PK_INVALID_DATA", "job " + guard.jobId + ": the force complete's plan could not be read");
  }
  const owner = s(r.lease_owner);
  if (owner && String(r.lease_live) === "1" && owner !== guard.leaseOwner && owner !== s(guard.callerLease)) {
    return out("WAIT", "", "the job is driven by " + owner + " until " + s(r.lease_expires_at));
  }
  const ids = manifest.map((m) => m.gd_id);
  const all = (Array.isArray(gdAll) ? gdAll : []).map(s).filter(digits);
  return out("GO", "", "drive " + manifest.length + " deliver" + (manifest.length === 1 ? "y" : "ies"), {
    organizationId: s(r.organization_id), pickingId: s(r.picking_id), pickingNo: s(r.picking_no), nonce: s(fc.nonce), manifest: manifest, fp: fc.fp || {}, counts: fc.counts || {},
    snapToStatus: s(r.snap_to_status), snapGds: snapGds, gdIdsSql: ids.length ? ids.join(",") : "0", gdIdsAllSql: all.length ? all.join(",") : "0",
    // EDIT_GD jobs by their idempotency key (GDE|<gd>|<n>): the (tenant, organization, key) index
    edLikeSql: ids.length ? ids.map((g) => "e.idempotency_key LIKE 'GDE|" + g + "|%'").join(" OR ") : "1 = 0",
    slots: Array.from({ length: DRIVE_SLOTS }, (x, i) => i),
    claimRows: [{ id: s(r.id), lease_owner: guard.leaseOwner, lease_expires_at: s(r.lease_until), row_version: num(r.row_version) + 1 }], needClaim: "YES",
    touchRows: [{ id: s(r.picking_id), is_processing: 1 }], needTouch: "YES",
  });
};
const res = driveEntry([{{node:code_node_DRguard.data}}][0], [{{node:sql_node_DRjob.data}}][0]);
console.log("drive entry", JSON.stringify({ route: res.route, job: res.jobId, status: res.jobStatus, gds: res.manifest.length, result: res.result_code, message: res.result_message }));
return res;
