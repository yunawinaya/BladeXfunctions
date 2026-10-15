// GD_EDIT_SUBMIT - Held: an EDIT_GD job a cascade parked HELD on this GD whose hold has ended (next_attempt_at reached)
// -> GD_EDIT_WORKER is called with it before the facts are read: there is no Quartz, so a hold the SO save never released
// would keep the GD Processing until something kicks the worker (its EXPIRE path cancels it and unlocks, claim-gated)
const submitHeld = function submitHeld(guard, rows) {
  const r = list(rows)[0] || {};
  return digits(r.job_id) && num(r.expired) === 1 ? { needKick: "YES", jobId: s(r.job_id) } : { needKick: "NO", jobId: "0" };
};
