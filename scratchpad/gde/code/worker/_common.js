const PKC = {
  retry: { max_retries: 3, base_delay_ms: 2000, max_delay_ms: 30000 },
  worker_budget_seconds: 20,
  states: ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD"],
  hard: ["GDE_INVALID_REQUEST", "GDE_INVALID_DATA", "GDE_GD_NOT_FOUND", "GDE_NOT_LOCKED", "GDE_NOT_ELIGIBLE", "GDE_PLAN_FAILED", "GDE_PICKING_CHANGED", "GDE_PICKING_MISMATCH",
    "GDE_RES_UNREAD", "GDE_NO_AFTER_IMAGE", "GDE_STALE", "GDE_SO_REFUSED", "JOB_ILLEGAL_TRANSITION"],
};
// a refusal PREPARE / COMMIT answers that no retry changes: the list, an inventory refusal, a GOODS_DELIVERY stop (GDE_400 ...)
const isHard = function isHard(code) {
  const c = String(code || "");
  return PKC.hard.indexOf(c) >= 0 || /^GDE_(INVENTORY_[A-Z0-9_]+|[0-9]{3})$/.test(c);
};
// the unlocks a job row read by wjob_sql allows: gd_id is the GD while Processing under this job's lock, pick_id our Picking
// while still at the version this job locked it at ('0' otherwise)
const unlockOf = function unlockOf(r) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const id = (v) => (/^[0-9]{1,20}$/.test(s(v)) && s(v) !== "0" ? s(v) : "");
  const gd = id((r || {}).gd_id), pk = id((r || {}).pick_id);
  return { gd: gd ? [{ id: gd, gd_status: s(r.stored_status) === "Draft" ? "Draft" : "Created" }] : [], pick: pk ? [{ id: pk, is_processing: 0 }] : [] };
};
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
