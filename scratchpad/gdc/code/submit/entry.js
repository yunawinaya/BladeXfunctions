// GD_COMPLETE_SUBMIT - Entry: STATUS answers from the GD's latest COMPLETE_GD job; SUBMIT goes on only for a Created GD with
// no open completion, Packing V2, GD Edit V2 or Picking V2 job (REQUIRES_REVIEW counts as open: stock may be half-moved) and no
// GD Created V2 job still making its Picking (completed first, that job would never finish)
const submitEntry = function submitEntry(guard, factRows) {
  const f = list(factRows)[0] || {};
  const parse = (t) => {
    try {
      return t ? JSON.parse(t) : null;
    } catch (e) {
      return null;
    }
  };
  const last = parse(f.last_job);
  const open = list(parse(f.open_jobs)).filter((r) => s(r.id));
  const n = num(f.line_count);
  const base = { tenantId: guard.tenantId, gdId: guard.gdId, gdNo: s(f.delivery_no), organizationId: s(f.organization_id), plantId: s(f.plant_id), lineCount: n,
    dbNow: s(f.db_now), lockN: 1, reason: "", jobId: "", jobStatus: "", progressPercent: 0, progressMessage: "", errorCode: "", errorMessage: "" };
  const job = (j) => (j ? { jobId: s(j.id), jobStatus: s(j.job_status), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message), errorCode: s(j.error_code), errorMessage: s(j.error_message) } : {});
  if (guard.operation === "STATUS") return Object.assign(base, job(last), answer("STATUS", "200", last ? s(last.progress_message) : "no completion job"));
  if (!s(f.gd_id)) return Object.assign(base, answer("STOP", "400", "Goods Delivery not found"));
  const picking = list(parse(f.picking_jobs)).filter((r) => s(r.id));
  if (picking.length) {
    const review = picking.some((r) => s(r.job_status) === "REQUIRES_REVIEW");
    return Object.assign(base, answer("BUSY", "409", review
      ? "A Picking confirmation of this delivery stopped half-way and is under review: please contact support."
      : "Its Picking is being confirmed in the background - please wait for it to finish."));
  }
  const blocking = open[0];
  if (blocking) {
    const cmd = s(blocking.command);
    const what = cmd === "COMPLETE_PACKING" ? "Its Packing" : cmd === "EDIT_GD" ? "Its edit" : cmd === "CREATE_GD_FROM_FORM" ? "Its creation" : "Its completion";
    const message = s(blocking.job_status) === "REQUIRES_REVIEW"
      ? what + " stopped half-way and is under review: please contact support."
      : (cmd === "COMPLETE_PACKING" ? "Its Packing is being completed" : cmd === "EDIT_GD" ? "Its edit is being saved" : cmd === "CREATE_GD_FROM_FORM" ? "Its Picking is still being created"
        : "This delivery is already being completed") + " - please wait for it to finish.";
    return Object.assign(base, job(blocking), answer("BUSY", "409", message));
  }
  const status = s(f.gd_status);
  if (status === "Processing") return Object.assign(base, answer("BUSY", "409", "This delivery is being processed - please wait for it to finish."));
  if (status === "Draft") return Object.assign(base, notEligible("a Draft is completed by the classic save", n));
  if (status !== "Created") return Object.assign(base, answer("STOP", "400", "Goods Delivery is " + (status || "without a status") + ": only a Created delivery can be completed"));
  if (!digits(f.organization_id)) return Object.assign(base, answer("STOP", "400", "Goods Delivery has no organization"));
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  return Object.assign(base, answer("GO", "", ""), { lockN: m ? Number(m[1]) + 1 : 1 });
};
const res = submitEntry([{{node:code_node_GSguard.data}}][0], [{{node:sql_node_GSfacts.data}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, lock: res.lockN }));
return res;
