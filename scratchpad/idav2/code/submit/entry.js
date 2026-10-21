// IDA_V2_SUBMIT - Entry (CONTRACT section 2 order): the key's job, STATUS, Add / Clone, not found, BUSY, STALE, the action table
const idaNextLock = (lock) => {
  const m = s(lock && lock.step).match(/^LOCK\|([0-9]+)$/);
  return m ? Number(m[1]) + 1 : 1;
};
// the latest lock row belongs to another submit still in flight: younger than 120 s and its job missing or open (SA's B2 rule)
const idaLockInFlight = (lock, key) => obj(lock) && s(lock.ref) !== key && num(lock.young) === 1 && (!s(lock.job) || IDA_OPEN_JOB.indexOf(s(lock.job)) >= 0);
const submitEntry = function submitEntry(guard, factRows, formStatus) {
  const f = list(factRows)[0] || {};
  const keyJob = parseJson(f.key_job);
  const stored = s(f.item_disassembly_status);
  const base = { action: "", prevStatus: "", tenantId: guard.tenantId, idaId: guard.idaId, idaNo: s(f.stock_movement_no), storedStatus: stored,
    organizationId: s(f.organization_id), plantId: s(f.plant_id), noType: s(f.no_type), dbNow: s(f.db_now), lockN: 1, issuedByJob: num(f.issued_by_job),
    completedUnder: num(f.completed_under), reason: "", errorCode: "", jobId: "", jobStatus: "", jobAction: "", progressPercent: 0, progressMessage: "", jobErrorCode: "",
    errorMessage: "", lineCount: 0 };
  const job = (j) => {
    if (!obj(j)) return {};
    const m = s(j.correlation_id).match(/^IDA\|([0-9]{1,20})$/);
    return { jobId: s(j.id), jobStatus: s(j.job_status), jobAction: s(j.action), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message),
      jobErrorCode: s(j.error_code), errorMessage: s(j.error_message), idaId: m ? m[1] : guard.idaId, idaNo: s(j.ida_no) || base.idaNo, lineCount: num(j.line_count) };
  };
  const status = (j) => Object.assign(base, job(j), answer("STATUS", "200", s(j.progress_message) || s(j.job_status)));
  const draft = () => Object.assign(base, answer("NOT_ELIGIBLE", "300", "draft", { reason: "draft", errorCode: "IDA_NOT_ELIGIBLE" }));
  if (obj(keyJob) && s(keyJob.id)) return status(keyJob);
  if (guard.operation === "STATUS") {
    const last = parseJson(f.last_job) || parseJson(f.link_job);
    if (obj(last) && s(last.id)) return status(last);
    return Object.assign(base, { jobStatus: "NONE" }, answer("STATUS", "200", IDA_TEXT.noJob));
  }
  if (guard.pageStatus === "Add") {
    Object.assign(base, { idaNo: "", storedStatus: "", organizationId: guard.organizationId, plantId: "", noType: "", issuedByJob: 0, completedUnder: 0 });
    if (guard.saveAs === "Draft") return draft();
    return Object.assign(base, { action: "DIRECT", prevStatus: "Draft" }, answer("GO", "", ""));
  }
  if (!s(f.ida_id)) return Object.assign(base, answer("STOP", "400", IDA_TEXT.notFound, { errorCode: "IDA_NOT_FOUND" }));
  const busy = (j) => {
    const rr = obj(j) && s(j.job_status) === "REQUIRES_REVIEW";
    return Object.assign(base, job(j), answer("BUSY", "409", rr ? IDA_TEXT.underReview : IDA_TEXT.busy, { errorCode: rr ? "IDA_UNDER_REVIEW" : "IDA_BUSY" }));
  };
  const open = list(parseJson(f.open_jobs)).filter((r) => obj(r) && s(r.id));
  if (open.length) return busy(open[0]);
  if (stored === "Processing") return busy(parseJson(f.link_job));
  const lock = parseJson(f.ida_lock);
  if (idaLockInFlight(lock, guard.key)) return busy(null);
  if (s(formStatus) !== stored) return Object.assign(base, answer("STALE", "409", IDA_TEXT.stale(stored), { errorCode: "IDA_STALE" }));
  if (IDA_FINAL.indexOf(stored) >= 0) return Object.assign(base, answer("STALE", "409", IDA_TEXT.alreadyFinal(stored), { errorCode: "IDA_ALREADY_FINAL" }));
  base.lockN = idaNextLock(lock);
  if (guard.saveAs === "Draft") return draft();
  if (stored === "Draft") return Object.assign(base, { action: "DIRECT", prevStatus: "Draft" }, answer("GO", "", ""));
  const why = "status " + (stored || "(none)");
  return Object.assign(base, answer("NOT_ELIGIBLE", "300", why, { reason: why, errorCode: "IDA_NOT_ELIGIBLE" }));
};
const res = submitEntry([{{node:code_node_DSguard.data}}][0], [{{node:sql_node_DSfacts.data}}][0], [{{workflowparams:form.item_disassembly_status}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, action: res.action, stored: res.storedStatus, lock: res.lockN, job: res.jobId, reason: res.reason }));
return res;
