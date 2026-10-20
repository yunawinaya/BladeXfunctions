// GD_CANCEL_SUBMIT - Entry: STATUS answers from the GD's latest CANCEL_GD job; SUBMIT goes on only for a Created GD with no
// open job on it (an edit, a completion, a Packing, another cancel - REQUIRES_REVIEW counts: stock may be half-moved - or a
// GD Created V2 whose Picking is still being made), no open Picking V2 confirm of its Pickings, no Picking held on a device
// and no Packing of it open on a phone
const cancelEntry = function cancelEntry(guard, factRows) {
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
  if (guard.operation === "STATUS") return Object.assign(base, job(last), answer("STATUS", "200", last ? s(last.progress_message) : "no cancel job"));
  if (!s(f.gd_id)) return Object.assign(base, answer("STOP", "400", "Goods Delivery not found"));
  const status = s(f.gd_status);
  if (status === "Cancelled") return Object.assign(base, answer("STOP", "400", "Goods Delivery " + s(f.delivery_no) + " is already cancelled"));
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
    const what = { COMPLETE_PACKING: "Its Packing", EDIT_GD: "Its edit", COMPLETE_GD: "Its completion", CANCEL_GD: "Its cancel", CREATE_GD_FROM_FORM: "Its creation" }[cmd] || "A background job";
    const busy = { COMPLETE_PACKING: "Its Packing is being completed", EDIT_GD: "Its edit is being saved", COMPLETE_GD: "It is being completed", CANCEL_GD: "It is already being cancelled",
      CREATE_GD_FROM_FORM: "Its Picking is still being created" }[cmd] || "A background job holds it";
    return Object.assign(base, job(blocking), answer("BUSY", "409", s(blocking.job_status) === "REQUIRES_REVIEW" ? what + " stopped half-way and is under review: please contact support." : busy + " - please wait for it to finish."));
  }
  const held = list(parse(f.picking_locks)).filter(fcBusy).map((r) => s(r.picking_no) || s(r.picking_id));
  if (held.length) return Object.assign(base, answer("BUSY", "409", "Picking " + held.join(", ") + " is being processed on a device right now. Try again in a moment."));
  const leased = list(parse(f.packing_leases)).map((r) => s(r.packing_no) + (s(r.lock_user) ? " (open on mobile by " + s(r.lock_user) + ")" : ""));
  if (leased.length) return Object.assign(base, answer("BUSY", "409", "Packing " + leased.join(", ") + " is open right now. Try again once it is closed."));
  if (status === "Processing") return Object.assign(base, answer("BUSY", "409", "This delivery is being processed - please wait for it to finish."));
  if (status !== "Created") return Object.assign(base, answer("STOP", "400", "Goods Delivery is " + (status || "without a status") + ": only a Created delivery can be cancelled"));
  if (!digits(f.organization_id)) return Object.assign(base, answer("STOP", "400", "Goods Delivery has no organization"));
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  return Object.assign(base, answer("GO", "", ""), { lockN: m ? Number(m[1]) + 1 : 1 });
};
const res = cancelEntry([{{node:code_node_XSguard.data}}][0], [{{node:sql_node_XSfacts.data}}][0]);
console.log("cancel entry", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, lock: res.lockN }));
return res;
