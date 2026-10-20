// PICKING_FC_DRIVE - State: the job, its FC steps and its deliveries' EDIT_GD jobs as just read -> fcNext's input (the latest
// edit per delivery, its re-plans, the holds to re-plan first) and what the answer reports (counts, the edits to kick)
const DRIVE_INFLIGHT = { QUEUED: true, VALIDATING: true, READY_TO_COMMIT: true, COMMITTING_GD: true };
const driveState = function driveState(entry, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const r = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((x) => x)[0] || {};
  const parse = (t) => { if (Array.isArray(t)) return t; try { const x = JSON.parse(s(t) || "[]"); return Array.isArray(x) ? x : []; } catch (e) { return []; } };
  const yes = (v) => v === true || String(v) === "1" || String(v) === "true";
  const steps = {}, refs = {};
  for (const x of parse(r.steps)) { steps[s(x.name)] = true; refs[s(x.name)] = s(x.ref); }
  const idCmp = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);
  const byGi = {};
  for (const x of parse(r.edits).slice().sort((a, b) => idCmp(s(a.id), s(b.id)))) {
    const m = s(x.fcd).match(/^FCD\|([0-9a-z]{8})\|([0-9]{1,2})$/);
    const gi = m && m[1] === entry.nonce ? Number(m[2]) : -1;
    if (!entry.manifest[gi] || s(x.gd_id) !== entry.manifest[gi].gd_id) continue;
    (byGi[gi] = byGi[gi] || []).push(x);
  }
  const edits = Object.keys(byGi).map((gi) => {
    const all = byGi[gi], x = all[all.length - 1];
    return { gi: Number(gi), job_id: s(x.id), job_status: s(x.status), due: yes(x.due), lease_live: yes(x.live), error_code: s(x.code), error_message: s(x.msg),
      replans: all.length - 1, queued: s(x.queued), finished: s(x.finished) };
  });
  const latest = {};
  for (const x of edits) latest[x.gi] = x;
  // a hold planned before a delivery sharing one of its SO lines was committed holds stale reservations: re-planned first
  const shared = {};
  for (const m of entry.manifest) {
    const x = latest[m.gi];
    if (!x || x.job_status !== "HELD") continue;
    shared[m.gi] = entry.manifest.some((o) => o.gi !== m.gi && latest[o.gi] && latest[o.gi].job_status === "COMPLETED" && latest[o.gi].finished >= x.queued
      && o.so_line_ids.some((id) => m.so_line_ids.indexOf(id) >= 0));
  }
  const flying = edits.filter((x) => DRIVE_INFLIGHT[x.job_status] === true || (x.job_status === "HELD" && x.due));
  return {
    st: { job: { id: s(r.id), status: s(r.job_status) }, steps: steps, manifest: entry.manifest, edits: edits, sharedAfterHold: shared },
    refs: refs, steps: steps, jobStatus: s(r.job_status), rowVersion: Number(r.row_version) || 0, dbNow: s(r.db_now),
    held: edits.filter((x) => x.job_status === "HELD").length, committed: edits.filter((x) => x.job_status === "COMPLETED").length,
    kickAll: flying.filter((x) => !x.lease_live).map((x) => x.job_id),
    // the line weight this call has submitted: the deliveries whose latest edit was queued since the call began
    weightDone: entry.manifest.filter((m) => latest[m.gi] && latest[m.gi].queued >= s(entry.runStart)).reduce((t, m) => t + m.weight, 0),
  };
};
