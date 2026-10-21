// GD_REVERT_SUBMIT - Entry: STATUS answers from the GD's latest REVERT_GD job; SUBMIT goes on only for a Completed GD with no
// open job on it (REQUIRES_REVIEW counts: stock may be half-moved), no open Picking V2 confirm of its Pickings, no Picking held on
// a device, no Packing of it open on a phone, not invoiced and with its completion snapshot (the classic refusals). What the
// background revert does not take - a Picking Plan delivery, serial numbers, stock from a handling unit - is NOT_ELIGIBLE: the
// caller runs the classic revert (its 500-line cap applies).
const revertEntry = function revertEntry(guard, factRows) {
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
  if (guard.operation === "STATUS") return Object.assign(base, job(last), answer("STATUS", "200", last ? s(last.progress_message) : "no revert job"));
  if (!s(f.gd_id)) return Object.assign(base, answer("STOP", "400", "Goods Delivery not found"));
  const status = s(f.gd_status);
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
    const what = { COMPLETE_PACKING: "Its Packing", EDIT_GD: "Its edit", COMPLETE_GD: "Its completion", CANCEL_GD: "Its cancel", REVERT_GD: "Its revert", CREATE_GD_FROM_FORM: "Its creation" }[cmd] || "A background job";
    const busy = { COMPLETE_PACKING: "Its Packing is being completed", EDIT_GD: "Its edit is being saved", COMPLETE_GD: "It is being completed", CANCEL_GD: "It is being cancelled",
      REVERT_GD: "It is already being reverted", CREATE_GD_FROM_FORM: "Its Picking is still being created" }[cmd] || "A background job holds it";
    return Object.assign(base, job(blocking), answer("BUSY", "409", s(blocking.job_status) === "REQUIRES_REVIEW" ? what + " stopped half-way and is under review: please contact support." : busy + " - please wait for it to finish."));
  }
  const held = list(parse(f.picking_locks)).filter(fcBusy).map((r) => s(r.picking_no) || s(r.picking_id));
  if (held.length) return Object.assign(base, answer("BUSY", "409", "Picking " + held.join(", ") + " is being processed on a device right now. Try again in a moment."));
  const leased = list(parse(f.packing_leases)).map((r) => s(r.packing_no) + (s(r.lock_user) ? " (open on mobile by " + s(r.lock_user) + ")" : ""));
  if (leased.length) return Object.assign(base, answer("BUSY", "409", "Packing " + leased.join(", ") + " is open right now. Try again once it is closed."));
  if (status === "Processing") return Object.assign(base, answer("BUSY", "409", "This delivery is being processed - please wait for it to finish."));
  // GD_REVERT_COMPLETED's refusals, in its order; the invoice rule is the list's (RevertCompletedWorkflow.js)
  if (status !== "Completed") return Object.assign(base, answer("STOP", "400", "Only Completed Goods Deliveries can be reverted"));
  const si = s(f.si_status);
  if (si !== "" && si.toLowerCase() !== "cancelled") return Object.assign(base, answer("STOP", "400", "Already invoiced (" + si + "). Please cancel the sales invoice first."));
  if (num(f.snapshots) < 1) return Object.assign(base, answer("STOP", "400", "No active snapshot found for this Goods Delivery; revert not possible (snapshot may have expired, been consumed by a previous revert, or this GD was completed before snapshots were enabled)."));
  if (!digits(f.organization_id)) return Object.assign(base, answer("STOP", "400", "Goods Delivery has no organization"));
  if (num(f.is_select_picking) === 1) return Object.assign(base, notEligible("a delivery made from a Picking Plan is reverted by the classic revert", n));
  if (num(f.serial_items) > 0) return Object.assign(base, notEligible("serial-numbered items are reverted by the classic revert", n));
  if (num(f.hu_lines) > 0) return Object.assign(base, notEligible("stock delivered from a handling unit is reverted by the classic revert", n));
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  return Object.assign(base, answer("GO", "", ""), { lockN: m ? Number(m[1]) + 1 : 1 });
};
const res = revertEntry([{{node:code_node_RSguard.data}}][0], [{{node:sql_node_RSfacts.data}}][0]);
console.log("revert entry", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, lock: res.lockN }));
return res;
