// GD_EDIT_SUBMIT - Entry: STATUS answers from the job holding the GD's latest lock (an edit or a completion: the form's one
// call); SUBMIT goes on for a Created or Draft GD with nothing open on it: not Processing, no open edit / completion /
// Packing job (REQUIRES_REVIEW counts), no unfinished GD V2 create, its Picking not held by a device or Picking V2
const PICK_LOCK_STALE_SEC = 900;
const submitEntry = function submitEntry(guard, factRows) {
  const f = list(factRows)[0] || {};
  const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
  const lockJob = parse(f.lock_job);
  const open = list(parse(f.open_jobs)).filter((r) => s(r.id));
  const picks = list(parse(f.pickings));
  const openPicks = list(parse(f.open_pickings)).filter((r) => s(r.id));
  const n = num(f.line_count);
  const base = Object.assign({ tenantId: guard.tenantId, gdId: guard.gdId, gdNo: s(f.delivery_no), organizationId: s(f.organization_id), plantId: s(f.plant_id), lineCount: n,
    dbNow: s(f.db_now), lockN: 1, storedStatus: s(f.gd_status), reason: "", command: "", jobId: "", jobStatus: "", progressPercent: 0, progressMessage: "", errorCode: "", errorMessage: "", cascadeRef: "" }, guard.idLists || {});
  const job = (j) => (j ? { command: s(j.command), jobId: s(j.id), jobStatus: s(j.job_status), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message), errorCode: s(j.error_code), errorMessage: s(j.error_message), notes: j.notes && typeof j.notes === "object" ? j.notes : parse(j.notes) || {}, cascadeRef: s(j.cascade_ref) } : {});
  if (guard.operation === "STATUS") return Object.assign(base, job(lockJob), answer("STATUS", "200", lockJob ? s(lockJob.progress_message) : "no job"));
  if (!s(f.gd_id)) return Object.assign(base, answer("STOP", "400", "Goods Delivery not found"));
  // a Picking force complete edits under its own open job: that job and its Picking's lock are not "busy" for it
  const fcJob = guard.source === "PICKING_FC" ? openPicks.filter((r) => s(r.id) === s(guard.causationJobId))[0] : null;
  if (guard.source === "PICKING_FC" && !fcJob) return Object.assign(base, answer("STOP", "409", "The force complete (job " + s(guard.causationJobId) + ") that asked for this edit is no longer open."));
  const status = s(f.gd_status);
  if (status === "Processing") return Object.assign(base, job(lockJob), answer("BUSY", "409", "This delivery is being processed - please wait for it to finish."));
  const blocking = open[0];
  if (blocking) {
    const what = { EDIT_GD: "Its edit", COMPLETE_GD: "Its completion", COMPLETE_PACKING: "Its Packing", CREATE_GD_FROM_FORM: "Its creation" }[s(blocking.command)] || "Its job";
    return Object.assign(base, job(blocking), answer("BUSY", "409", s(blocking.job_status) === "REQUIRES_REVIEW" ? what + " stopped half-way and is under review: please contact support." : what + " is being saved - please wait for it to finish."));
  }
  // a stored Draft is a new delivery: it waits while a GD Created V2 save of one of its SOs has not put its quantities on the SO yet
  const soJob = s(f.so_job).split("|");
  if (status === "Draft" && soJob[0]) {
    const so = soJob.slice(2).join("|") || "this sales order";
    return Object.assign(base, answer("BUSY", "409", soJob[0] === "REQUIRES_REVIEW"
      ? "A background save of a delivery for " + so + " stopped half-way and is under review (job " + soJob[1] + "): please contact support before delivering it again."
      : "A delivery for " + so + " is still being saved in the background (job " + soJob[1] + ", " + soJob[0] + "). Wait for it to finish - it then appears in the Goods Delivery list - before saving another delivery for it."));
  }
  const held = picks.filter((p) => num(p.is_processing) === 1 && num(p.lock_age_sec) <= PICK_LOCK_STALE_SEC && !(fcJob && s(p.id) === s(fcJob.picking_id)))[0];
  if (held) return Object.assign(base, answer("BUSY", "409", "Picking " + s(held.to_id) + " is being processed on a device right now. Try again in a moment."));
  if (openPicks.filter((r) => !fcJob || s(r.id) !== s(fcJob.id)).length) return Object.assign(base, answer("BUSY", "409", "Its Picking is being confirmed in the background - please wait for it to finish."));
  if (status !== "Created" && status !== "Draft") return Object.assign(base, answer("STOP", "400", "Goods Delivery is " + (status || "without a status") + ": only a Created or Draft delivery can be saved as Created"));
  if (!digits(f.organization_id)) return Object.assign(base, answer("STOP", "400", "Goods Delivery has no organization"));
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  // a device lock older than PICKING_LOOP's takeover is not a device's any more: the gate reads it released, post.js takes it over
  const staleLocks = picks.filter((p) => num(p.is_processing) === 1 && num(p.lock_age_sec) > PICK_LOCK_STALE_SEC).map((p) => s(p.id)).filter(digits);
  return Object.assign(base, answer("GO", "", ""), { lockN: m ? Number(m[1]) + 1 : 1, staleLocks: staleLocks });
};
