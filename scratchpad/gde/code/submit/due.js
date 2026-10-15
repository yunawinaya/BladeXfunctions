// GD_EDIT_SUBMIT - Due: the GD reads back Processing under this job's lock -> the job due now, with the Picking's version as
// locked (the version PREPARE and COMMIT hold it at); otherwise nothing (a concurrent submit won: its job falls due itself)
const submitDue = function submitDue(entry, post, rows) {
  const b = list(rows)[0] || {};
  const ok = s(b.job_id) && s(b.job_status) === "QUEUED" && s(b.gd_status) === "Processing" && s(b.lock_ref) === s(post.idemKey);
  if (!ok) return { dueRows: [], needDue: "NO" };
  let req = {};
  try { req = JSON.parse(s(b.request_payload)) || {}; } catch (e) { req = {}; }
  if (s(b.pick_id) && num(b.pick_processing) === 1) req.picking_version = s(b.pick_update_time);
  return { dueRows: [{ id: s(b.job_id), next_attempt_at: s(b.queued_at), request_payload: JSON.stringify(req) }], needDue: "YES" };
};
