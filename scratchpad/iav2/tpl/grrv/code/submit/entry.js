// GR_REVERT_SUBMIT - Entry: STATUS answers from the job of this key, else the receipt's latest REVERT_GR job; a SUBMIT whose
// key already has a job answers that job; else it goes on for a Completed / Received receipt with no open job of any kind
// (a completion or a revert; REQUIRES_REVIEW counts as open: stock may be half-moved)
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
  const grNo = s(f.gr_no);
  const base = { tenantId: guard.tenantId, grId: guard.grId, grNo: grNo, grNoSql: grNo.replace(/\\/g, "\\\\").replace(/'/g, "''"), grStatus: s(f.gr_status),
    organizationId: "0", plantId: "0", lineCount: num(f.line_count), dbNow: s(f.db_now), lockN: 1, reason: "", jobId: "", jobStatus: "", progressPercent: 0,
    progressMessage: "", errorCode: "", errorMessage: "" };
  const job = (j) => (j ? { jobId: s(j.id), jobStatus: s(j.job_status), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message), errorCode: s(j.error_code),
    errorMessage: s(j.error_message) } : {});
  if (keyJob) return Object.assign(base, job(keyJob), answer("STATUS", "200", s(keyJob.progress_message) || s(keyJob.job_status)));
  if (guard.operation === "STATUS") return Object.assign(base, job(last), answer("STATUS", "200", last ? s(last.progress_message) : "no revert job"));
  if (!s(f.gr_id)) return Object.assign(base, answer("STOP", "400", "Goods Receiving record not found for this organization."));
  const blocking = open[0];
  if (blocking) {
    const message = s(blocking.job_status) === "REQUIRES_REVIEW" ? "This Goods Receiving stopped half-way in the background and is under review: please contact support."
      : "This Goods Receiving is being processed - please wait for it to finish.";
    return Object.assign(base, job(blocking), answer("BUSY", "409", message));
  }
  const status = s(f.gr_status);
  if (status !== "Completed" && status !== "Received") return Object.assign(base, answer("STOP", "400", "Only Completed or Received Goods Receiving can be reverted (this one is " + (status || "blank") + ")."));
  // fail closed: only digits ever reach the SQL text after this node
  if (!digits(f.organization_id) || !digits(f.plant_id)) return Object.assign(base, answer("STOP", "400", "The Goods Receiving has no valid organization or plant."));
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  return Object.assign(base, answer("GO", "", ""), { organizationId: s(f.organization_id), plantId: s(f.plant_id), lockN: m ? Number(m[1]) + 1 : 1 });
};
const res = submitEntry([{{node:code_node_VSguard.data}}][0], [{{node:sql_node_VSfacts.data}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, message: res.message, lock: res.lockN, job: res.jobId, lines: res.lineCount }));
return res;
