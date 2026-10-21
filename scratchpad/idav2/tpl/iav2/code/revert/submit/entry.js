// IA_REVERT_V2_SUBMIT - Entry (CONTRACT.md RV4 order): STATUS, NOT_FOUND, BUSY, STALE, else GO with the next lock
const rvLockInFlight = (lock, key) => Boolean(lock) && s(lock.ref) !== key && num(lock.young) === 1 && (!s(lock.job) || IA_OPEN_JOB.indexOf(s(lock.job)) >= 0);
const rvNextLock = (lock) => {
  const m = s(lock && lock.step).match(/^LOCK\|([0-9]+)$/);
  return m ? Number(m[1]) + 1 : 1;
};
const submitEntry = function submitEntry(guard, factRows) {
  const f = list(factRows)[0] || {};
  const keyJob = parseJson(f.key_job);
  const stored = s(f.item_assembly_status);
  const base = { action: "REVERT", tenantId: guard.tenantId, iaId: guard.iaId, iaNo: s(f.stock_movement_no), storedStatus: stored, organizationId: s(f.organization_id),
    plantId: s(f.plant_id), dbNow: s(f.db_now), lockN: 1, reason: "", errorCode: "", jobId: "", jobStatus: "", jobAction: "", progressPercent: 0, progressMessage: "", jobErrorCode: "",
    errorMessage: "", lineCount: 0 };
  const job = (j) => (j ? { jobId: s(j.id), jobStatus: s(j.job_status), jobAction: s(j.action), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message),
    jobErrorCode: s(j.error_code), errorMessage: s(j.error_message), iaNo: s(j.ia_no) || base.iaNo, lineCount: num(j.line_count) } : {});
  const status = (j) => Object.assign(base, job(j), answer("STATUS", "200", s(j.progress_message) || s(j.job_status)));
  if (keyJob && s(keyJob.id)) return status(keyJob);
  if (guard.operation === "STATUS") {
    const last = parseJson(f.last_job) || parseJson(f.link_job);
    if (last && s(last.id)) return status(last);
    return Object.assign(base, { jobStatus: "NONE" }, answer("STATUS", "200", IA_TEXT.rvNoJob));
  }
  if (!s(f.ia_id)) return Object.assign(base, answer("STOP", "400", "Item Assembly not found - it may have been deleted.", { errorCode: "IA_RV_NOT_FOUND" }));
  const busy = (j) => {
    const rr = j && s(j.job_status) === "REQUIRES_REVIEW";
    return Object.assign(base, job(j), answer("BUSY", "409", rr ? (s(j.command) === "REVERT_IA" ? IA_TEXT.rvUnderReview : IA_TEXT.underReview) : IA_TEXT.busy, { errorCode: rr ? "IA_RV_UNDER_REVIEW" : "IA_RV_BUSY" }));
  };
  const open = list(parseJson(f.open_jobs)).filter((r) => s(r.id));
  if (open.length) return busy(open[0]);
  if (stored === "Processing") return busy(parseJson(f.link_job) || null);
  const lock = parseJson(f.ia_lock);
  if (rvLockInFlight(lock, guard.key)) return busy(null);
  if (guard.formStatus !== stored) return Object.assign(base, answer("STALE", "409", IA_TEXT.stale(stored), { errorCode: "IA_RV_STALE" }));
  base.lockN = rvNextLock(lock);
  return Object.assign(base, answer("GO", "", ""));
};
const res = submitEntry([{{node:code_node_IVSguard.data}}][0], [{{node:sql_node_IVSfacts.data}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, stored: res.storedStatus, lock: res.lockN, job: res.jobId, message: res.message }));
return res;
