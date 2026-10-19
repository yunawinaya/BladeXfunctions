// SA_V2_SUBMIT - Entry (CONTRACT §2 order): this key's job -> its STATUS; operation STATUS -> the key's job, else the SA's latest
// COMPLETE_SA job, else the job its sa_v2_job_id names (any source), else (no sa_id) the SC's latest COMPLETE_SA job, else NONE
// (terminal); a FORM Add / Clone goes on (DIRECT) unless the Stock Count it names is busy; else the STORED document decides: missing
// -> STOP, BUSY (Processing, an open job, a lock still in flight; the SA's Stock Count under review: SA_SC_BUSY),
// STALE (the payload's status differs, a final status), then the action (FORM Draft -> COMPLETE; REVIEW -> REVIEW; another SA
// status -> OTHER, which the keys node answers NOT_ELIGIBLE / SA_TOO_BIG by its entry count)
const SA_BUSY_TEXT = "This Stock Adjustment is being processed in the background - please wait for it to finish.";
const SA_SC_BUSY_TEXT = "A Stock Adjustment from this Stock Count is being processed in the background - please wait for it to finish.";
const SA_REVIEW_TEXT = "Its last save stopped half-way and is under review: please contact support.";
// the latest lock row of a document belongs to another submit still in flight: younger than 120 s and its job missing or open
const saLockInFlight = (lock, key) => Boolean(lock) && s(lock.ref) !== key && num(lock.young) === 1 && (!s(lock.job) || OPEN_JOB.indexOf(s(lock.job)) >= 0);
const saNextLock = (lock) => {
  const m = s(lock && lock.step).match(/^LOCK\|([0-9]+)$/);
  return m ? Number(m[1]) + 1 : 1;
};
const submitEntry = function submitEntry(guard, factRows, formStatus, formScStatus, formReviewStatus) {
  const f = list(factRows)[0] || {};
  const keyJob = parseJson(f.key_job);
  const review = guard.source === "REVIEW";
  const stored = s(f.stock_adjustment_status);
  const base = { action: "", prevStatus: "", tenantId: guard.tenantId, saId: guard.saId, saNo: s(f.adjustment_no), scId: guard.scId, storedStatus: stored, lineCount: 0,
    organizationId: s(f.organization_id), plantId: s(f.plant_id), noType: s(f.no_type), stockCountId: s(f.stock_count_id), dbNow: s(f.db_now), lockN: 1,
    issuedReuse: num(f.issued_reuse) > 0 ? "YES" : "NO", reason: "", errorCode: "", jobId: "", jobStatus: "", jobAction: "", progressPercent: 0, progressMessage: "",
    jobErrorCode: "", errorMessage: "" };
  const job = (j) => {
    if (!j) return {};
    const m = s(j.correlation_id).match(/^SA\|([0-9]{1,20})$/);
    return { jobId: s(j.id), jobStatus: s(j.job_status), jobAction: s(j.action), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message),
      jobErrorCode: s(j.error_code), errorMessage: s(j.error_message), saId: m ? m[1] : guard.saId, saNo: s(j.sa_no) || base.saNo,
      scId: digits(j.sc_id) ? s(j.sc_id) : guard.scId, lineCount: num(j.line_count) };
  };
  const status = (j) => Object.assign(base, job(j), answer("STATUS", "200", s(j.progress_message) || s(j.job_status)));
  if (keyJob && s(keyJob.id)) return status(keyJob);
  if (guard.operation === "STATUS") {
    // key -> the SA's latest COMPLETE_SA job -> the job its sa_v2_job_id names (any source); a review STATUS without an SA id:
    // the SC's latest job
    const last = parseJson(f.last_job) || parseJson(f.link_job) || (guard.saId === "0" ? parseJson(f.sc_last_job) : null);
    if (last && s(last.id)) return status(last);
    return Object.assign(base, { jobStatus: "NONE" }, answer("STATUS", "200", "no background save"));
  }
  const busy = (j, text, code) => {
    const rr = j && s(j.job_status) === "REQUIRES_REVIEW";
    return Object.assign(base, job(j), answer("BUSY", "409", rr ? SA_REVIEW_TEXT : text, { errorCode: rr ? "SA_UNDER_REVIEW" : code }));
  };
  // FORM: the Stock Count this SA names has ANOTHER Processing SA, an open REVIEW job, or a review lock in flight -> SA_SC_BUSY (a
  // completion must not race a background review of the same count; the answer keeps this SA's id)
  const scBusy = () => {
    const keep = { saId: base.saId, saNo: base.saNo };
    const sc = (j) => Object.assign(base, job(j), keep, answer("BUSY", "409", SA_SC_BUSY_TEXT, { errorCode: "SA_SC_BUSY" }));
    const proc = parseJson(f.fsc_processing_sa);
    if (proc && s(proc.id)) return sc({ id: s(proc.job), job_status: "" });
    const open = list(parseJson(f.fsc_open_jobs)).filter((r) => s(r.id));
    if (open.length) return sc(open[0]);
    if (saLockInFlight(parseJson(f.fsc_lock), guard.key)) return sc(null);
    return null;
  };
  if (review) {
    Object.assign(base, { saId: "0", saNo: "", storedStatus: "", organizationId: guard.organizationId, plantId: "", noType: "", stockCountId: guard.scId });
    if (!s(f.sc_id)) return Object.assign(base, answer("STOP", "400", "Stock Count not found - it may have been deleted.", { errorCode: "SA_SC_NOT_FOUND" }));
    const open = list(parseJson(f.sc_open_jobs)).filter((r) => s(r.id));
    if (open.length) return busy(open[0], SA_SC_BUSY_TEXT, "SA_SC_BUSY");
    const proc = parseJson(f.sc_processing_sa);
    if (proc && s(proc.id)) return busy({ id: s(proc.job), job_status: "" }, SA_SC_BUSY_TEXT, "SA_SC_BUSY");
    const lock = parseJson(f.sc_lock);
    if (saLockInFlight(lock, guard.key)) return busy(null, SA_SC_BUSY_TEXT, "SA_SC_BUSY");
    if (s(formScStatus) !== s(f.stock_count_status) || s(formReviewStatus) !== s(f.sc_review_status)) {
      return Object.assign(base, answer("STALE", "409", "This Stock Count was changed by someone else (it is now " + (s(f.stock_count_status) || "without a status") + " / "
        + (s(f.sc_review_status) || "not reviewed") + "). Please close it and open it again.", { errorCode: "SA_SC_STALE" }));
    }
    return Object.assign(base, { action: "REVIEW", prevStatus: "Cancelled", lockN: saNextLock(lock) }, answer("GO", "", ""));
  }
  if (guard.pageStatus === "Add") {
    Object.assign(base, { saNo: "", storedStatus: "", organizationId: "", plantId: "", noType: "", stockCountId: "", issuedReuse: "NO" });
    return scBusy() || Object.assign(base, { action: "DIRECT", prevStatus: "Draft" }, answer("GO", "", ""));
  }
  if (!s(f.sa_id)) return Object.assign(base, answer("STOP", "400", "Stock Adjustment not found - it may have been deleted.", { errorCode: "SA_NOT_FOUND" }));
  const open = list(parseJson(f.open_jobs)).filter((r) => s(r.id));
  if (open.length) return busy(open[0], SA_BUSY_TEXT, "SA_BUSY");
  if (stored === "Processing") return busy(parseJson(f.link_job) || null, SA_BUSY_TEXT, "SA_BUSY");
  const lock = parseJson(f.sa_lock);
  if (saLockInFlight(lock, guard.key)) return busy(null, SA_BUSY_TEXT, "SA_BUSY");
  const scb = scBusy();
  if (scb) return scb;
  if (s(formStatus) !== stored) {
    return Object.assign(base, answer("STALE", "409", "This Stock Adjustment was changed by someone else (it is now " + (stored || "without a status")
      + "). Please close it and open it again.", { errorCode: "SA_STALE" }));
  }
  if (SA_FINAL.indexOf(stored) >= 0) return Object.assign(base, answer("STALE", "409", "This Stock Adjustment is already " + stored + ".", { errorCode: "SA_ALREADY_FINAL" }));
  base.lockN = saNextLock(lock);
  if (stored === "Draft") return Object.assign(base, { action: "COMPLETE", prevStatus: "Draft" }, answer("GO", "", ""));
  return Object.assign(base, { action: "OTHER", reason: "its status " + (stored || "(none)") + " is not one the background save takes" }, answer("GO", "", ""));
};
const res = submitEntry([{{node:code_node_SSguard.data}}][0], [{{node:sql_node_SSfacts.data}}][0], [{{workflowparams:form.stock_adjustment_status}}][0],
  [{{workflowparams:form.stock_count_status}}][0], [{{workflowparams:form.review_status}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, action: res.action, stored: res.storedStatus, lock: res.lockN, job: res.jobId, reason: res.reason }));
return res;
