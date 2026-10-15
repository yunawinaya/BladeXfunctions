// GR_COMPLETE_SUBMIT - Entry: STATUS answers from the job of this key, else the receipt's latest COMPLETE_GR job. A SUBMIT
// whose key already has a job answers that job (a retried click never queues twice). Else: Add goes on; Edit goes on only
// for a Draft or Created receipt with no open completion job (REQUIRES_REVIEW counts as open: stock may be half-moved)
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
  const n = num(f.line_count);
  const base = { tenantId: guard.tenantId, grId: guard.grId, grNo: s(f.gr_no), grStatus: s(f.gr_status), organizationId: s(f.organization_id), plantId: s(f.plant_id),
    lineCount: n, dbNow: s(f.db_now), lockN: 1, reason: "", jobId: "", jobStatus: "", progressPercent: 0, progressMessage: "", errorCode: "", errorMessage: "" };
  const job = (j) => {
    if (!j) return {};
    const m = s(j.correlation_id).match(/^GR\|([0-9]{1,20})$/);
    return { jobId: s(j.id), jobStatus: s(j.job_status), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message), errorCode: s(j.error_code),
      errorMessage: s(j.error_message), grId: m ? m[1] : guard.grId };
  };
  if (keyJob) return Object.assign(base, job(keyJob), answer("STATUS", "200", s(keyJob.progress_message) || s(keyJob.job_status)));
  if (guard.operation === "STATUS") return Object.assign(base, job(last), answer("STATUS", "200", last ? s(last.progress_message) : "no completion job"));
  if (guard.pageStatus === "Add") return Object.assign(base, answer("GO", "", ""), { grStatus: "", lockN: 1 });
  if (!s(f.gr_id)) return Object.assign(base, answer("STOP", "400", "Goods Receiving not found - it may have been deleted."));
  const blocking = open[0];
  if (blocking) {
    const message = s(blocking.job_status) === "REQUIRES_REVIEW"
      ? "Its completion stopped half-way and is under review: please contact support."
      : "This Goods Receiving is already being completed - please wait for it to finish.";
    return Object.assign(base, job(blocking), answer("BUSY", "409", message));
  }
  const status = s(f.gr_status);
  if (status === "Processing") return Object.assign(base, answer("BUSY", "409", "This Goods Receiving is being processed in the background - please wait for it to finish."));
  if (["Draft", "Created"].indexOf(status) < 0) return Object.assign(base, answer("STOP", "400", "Goods Receiving is " + (status || "without a status") + ": only a Draft or Created receipt can be completed"));
  if (!s(f.organization_id)) return Object.assign(base, answer("STOP", "400", "Goods Receiving has no organization"));
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  return Object.assign(base, answer("GO", "", ""), { lockN: m ? Number(m[1]) + 1 : 1 });
};
const res = submitEntry([{{node:code_node_RSguard.data}}][0], [{{node:sql_node_RSfacts.data}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, message: res.message, status: res.grStatus, lines: res.lineCount, lock: res.lockN, job: res.jobId }));
return res;
