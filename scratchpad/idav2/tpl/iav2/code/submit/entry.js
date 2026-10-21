// IA_V2_SUBMIT - Entry (CONTRACT section 2 order): the key's job, STATUS, Add / Clone, not found, BUSY, STALE, the action table
const iaNextLock = (lock) => {
  const m = s(lock && lock.step).match(/^LOCK\|([0-9]+)$/);
  return m ? Number(m[1]) + 1 : 1;
};
// the latest lock row belongs to another submit still in flight: younger than 120 s and its job missing or open (SA's B2 rule)
const iaLockInFlight = (lock, key) => obj(lock) && s(lock.ref) !== key && num(lock.young) === 1 && (!s(lock.job) || IA_OPEN_JOB.indexOf(s(lock.job)) >= 0);
const submitEntry = function submitEntry(guard, factRows, formStatus) {
  const f = list(factRows)[0] || {};
  const keyJob = parseJson(f.key_job);
  const stored = s(f.item_assembly_status);
  const base = { action: "", prevStatus: "", tenantId: guard.tenantId, iaId: guard.iaId, iaNo: s(f.stock_movement_no), storedStatus: stored,
    organizationId: s(f.organization_id), plantId: s(f.plant_id), noType: s(f.no_type), dbNow: s(f.db_now), lockN: 1, issuedByJob: num(f.issued_by_job),
    completedUnder: num(f.completed_under), batchCfg: s(f.batch_cfg), reason: "", errorCode: "", jobId: "", jobStatus: "", jobAction: "", progressPercent: 0,
    progressMessage: "", jobErrorCode: "", errorMessage: "", lineCount: 0 };
  const job = (j) => {
    if (!obj(j)) return {};
    const m = s(j.correlation_id).match(/^IA\|([0-9]{1,20})$/);
    return { jobId: s(j.id), jobStatus: s(j.job_status), jobAction: s(j.action), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message),
      jobErrorCode: s(j.error_code), errorMessage: s(j.error_message), iaId: m ? m[1] : guard.iaId, iaNo: s(j.ia_no) || base.iaNo, lineCount: num(j.line_count) };
  };
  const status = (j) => Object.assign(base, job(j), answer("STATUS", "200", s(j.progress_message) || s(j.job_status)));
  const draft = () => Object.assign(base, answer("NOT_ELIGIBLE", "300", "draft", { reason: "draft", errorCode: "IA_NOT_ELIGIBLE" }));
  if (obj(keyJob) && s(keyJob.id)) return status(keyJob);
  if (guard.operation === "STATUS") {
    const last = parseJson(f.last_job) || parseJson(f.link_job);
    if (obj(last) && s(last.id)) return status(last);
    return Object.assign(base, { jobStatus: "NONE" }, answer("STATUS", "200", "no background save"));
  }
  if (guard.pageStatus === "Add") {
    Object.assign(base, { iaNo: "", storedStatus: "", organizationId: guard.organizationId, plantId: "", noType: "", issuedByJob: 0, completedUnder: 0 });
    if (guard.saveAs === "Draft") return draft();
    return Object.assign(base, { action: "DIRECT", prevStatus: "Draft" }, answer("GO", "", ""));
  }
  if (!s(f.ia_id)) return Object.assign(base, answer("STOP", "400", "Item Assembly not found - it may have been deleted.", { errorCode: "IA_NOT_FOUND" }));
  const busy = (j) => {
    const rr = obj(j) && s(j.job_status) === "REQUIRES_REVIEW";
    const text = rr ? (s(j.command) === "REVERT_IA" ? IA_TEXT.rvUnderReview : IA_TEXT.underReview) : IA_TEXT.busy;
    return Object.assign(base, job(j), answer("BUSY", "409", text, { errorCode: rr ? "IA_UNDER_REVIEW" : "IA_BUSY" }));
  };
  const open = list(parseJson(f.open_jobs)).filter((r) => obj(r) && s(r.id));
  if (open.length) return busy(open[0]);
  if (stored === "Processing") return busy(parseJson(f.link_job));
  const lock = parseJson(f.ia_lock);
  if (iaLockInFlight(lock, guard.key)) return busy(null);
  if (s(formStatus) !== stored) return Object.assign(base, answer("STALE", "409", IA_TEXT.stale(stored), { errorCode: "IA_STALE" }));
  if (IA_FINAL.indexOf(stored) >= 0) return Object.assign(base, answer("STALE", "409", IA_TEXT.alreadyFinal(stored), { errorCode: "IA_ALREADY_FINAL" }));
  base.lockN = iaNextLock(lock);
  if (guard.saveAs === "Draft") return draft();
  if (stored === "Draft") return Object.assign(base, { action: "DIRECT", prevStatus: "Draft" }, answer("GO", "", ""));
  const why = "status " + (stored || "(none)");
  return Object.assign(base, answer("NOT_ELIGIBLE", "300", why, { reason: why, errorCode: "IA_NOT_ELIGIBLE" }));
};
const res = submitEntry([{{node:code_node_ISguard.data}}][0], [{{node:sql_node_ISfacts.data}}][0], [{{workflowparams:form.item_assembly_status}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, action: res.action, stored: res.storedStatus, lock: res.lockN, job: res.jobId, reason: res.reason }));
return res;
