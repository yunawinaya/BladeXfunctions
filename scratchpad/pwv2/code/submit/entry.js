// PUTAWAY_ASYNC_SUBMIT - Entry: STATUS answers from the job of this key, else the putaway's latest COMPLETE_PUTAWAY job; a
// SUBMIT whose key already has a job answers that job; else it goes on for a putaway with no open completion job
// (REQUIRES_REVIEW counts as open: stock may be half-moved)
const submitEntry = function submitEntry(guard, factRows) {
  const f = list(factRows)[0] || {};
  const parse = (t) => {
    try {
      return t ? JSON.parse(t) : null;
    } catch (e) {
      return null;
    }
  };
  const keyJob = parse(f.key_job);
  const last = parse(f.last_job);
  const open = list(parse(f.open_jobs)).filter((r) => s(r.id));
  const base = { tenantId: guard.tenantId, toId: guard.toId, toNo: s(f.to_no), grId: s(f.gr_no), organizationId: s(f.organization_id), plantId: s(f.plant_id),
    dbNow: s(f.db_now), lockN: 1, reason: "", jobId: "", jobStatus: "", progressPercent: 0, progressMessage: "", errorCode: "", errorMessage: "" };
  const job = (j) => (j ? { jobId: s(j.id), jobStatus: s(j.job_status), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message), errorCode: s(j.error_code),
    errorMessage: s(j.error_message) } : {});
  if (keyJob) return Object.assign(base, job(keyJob), answer("STATUS", "200", s(keyJob.progress_message) || s(keyJob.job_status)));
  if (guard.operation === "STATUS") return Object.assign(base, job(last), answer("STATUS", "200", last ? s(last.progress_message) : "no completion job"));
  if (!s(f.to_db_id)) return Object.assign(base, answer("STOP", "400", "Putaway not found - it may have been deleted."));
  const blocking = open[0];
  if (blocking) {
    const message = s(blocking.job_status) === "REQUIRES_REVIEW" ? "Its completion stopped half-way and is under review: please contact support." : "The current putaway is under processing";
    return Object.assign(base, job(blocking), answer("BUSY", "409", message));
  }
  if (!s(f.organization_id)) return Object.assign(base, answer("STOP", "400", "Putaway has no organization"));
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  return Object.assign(base, answer("GO", "", ""), { lockN: m ? Number(m[1]) + 1 : 1 });
};
const res = submitEntry([{{node:code_node_PSguard.data}}][0], [{{node:sql_node_PSfacts.data}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, message: res.message, lock: res.lockN, job: res.jobId }));
return res;
