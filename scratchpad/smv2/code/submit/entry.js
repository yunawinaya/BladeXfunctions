// LOT_V2_SUBMIT - Entry (CONTRACT section 2 order): this key's job -> its STATUS; operation STATUS -> the key's job, else the
// LOT's latest SAVE_LOT job, else the job its lot_v2_job_id names, else NONE (terminal); Add / Clone goes on (a Draft Add whose
// key already saved a LOT answers that LOT); else the STORED LOT decides: missing -> STOP, an open job or Processing -> BUSY,
// the form's status differs -> STALE, Completed / Cancelled -> STALE, then the action table (a CANCEL of <= min_lines stored lines:
// NOT_ELIGIBLE)
const submitEntry = function submitEntry(guard, factRows, formStatus, minLinesIn) {
  const f = list(factRows)[0] || {};
  const minLines = /^[0-9]{1,9}$/.test(s(minLinesIn)) ? Number(s(minLinesIn)) : 0;
  const keyJob = parseJson(f.key_job);
  const keyLot = parseJson(f.key_lot);
  const last = parseJson(f.last_job) || parseJson(f.link_job);
  const open = list(parseJson(f.open_jobs)).filter((r) => s(r.id));
  const stored = s(f.stock_movement_status);
  const base = { action: "", prevStatus: "", tenantId: guard.tenantId, lotId: guard.lotId, lotNo: s(f.stock_movement_no), storedStatus: stored, organizationId: s(f.organization_id),
    plantId: s(f.plant_id), noType: s(f.no_type), movementType: s(f.movement_type), issueDate: s(f.issue_date), isProductionOrder: num(f.is_production_order),
    lineCount: num(f.line_count), dbNow: s(f.db_now), lockN: 1, issuedReuse: num(f.issued_reuse) > 0 ? "YES" : "NO", reason: "", errorCode: "", jobId: "", jobStatus: "",
    jobAction: "", progressPercent: 0, progressMessage: "", jobErrorCode: "", errorMessage: "",
    purpose: s(f.transfer_purpose) === IATR_PURPOSE ? "YES" : "NO", sourceIaId: s(f.source_ia_id), sourceIaFp: s(f.source_ia_fp) };
  const job = (j) => {
    if (!j) return {};
    const m = s(j.correlation_id).match(/^LOT\|([0-9]{1,20})$/);
    return { jobId: s(j.id), jobStatus: s(j.job_status), jobAction: s(j.action), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message),
      jobErrorCode: s(j.error_code), errorMessage: s(j.error_message), lotId: m ? m[1] : guard.lotId, lotNo: s(j.lot_no) || base.lotNo };
  };
  if (keyJob && s(keyJob.id)) return Object.assign(base, job(keyJob), answer("STATUS", "200", s(keyJob.progress_message) || s(keyJob.job_status)));
  if (guard.operation === "STATUS") {
    if (last && s(last.id)) return Object.assign(base, job(last), answer("STATUS", "200", s(last.progress_message) || s(last.job_status)));
    return Object.assign(base, { jobStatus: "NONE" }, answer("STATUS", "200", "no background save"));
  }
  const saveAs = guard.saveAs;
  const pick = (action, prevStatus) => (BUILT_ACTIONS.indexOf(action) < 0
    ? Object.assign(base, { action: action, prevStatus: prevStatus }, notEligible("the background save does not take " + action + " yet", base.lineCount, saveAs))
    : Object.assign(base, { action: action, prevStatus: prevStatus }, answer("GO", "", "")));
  if (guard.pageStatus === "Add") {
    Object.assign(base, { lotNo: "", storedStatus: "", lineCount: 0, isProductionOrder: 0 });
    if (saveAs === "Draft" && keyLot && digits(keyLot.id)) {
      return Object.assign(base, { action: "DRAFT", lotId: s(keyLot.id), lotNo: s(keyLot.no) }, answer("SAVED", "200", "Location Transfer saved successfully"));
    }
    return pick(saveAs === "Draft" ? "DRAFT" : saveAs === "In Progress" ? "STAGE" : "DIRECT", "Draft");
  }
  if (!s(f.lot_id)) return Object.assign(base, answer("STOP", "400", "Location Transfer not found - it may have been deleted.", { errorCode: "LOT_NOT_FOUND" }));
  const blocking = open[0];
  if (blocking) {
    const review = s(blocking.job_status) === "REQUIRES_REVIEW";
    return Object.assign(base, job(blocking), answer("BUSY", "409", review ? "Its last save stopped half-way and is under review: please contact support."
      : "This Location Transfer is being processed in the background - please wait for it to finish.", { errorCode: review ? "LOT_UNDER_REVIEW" : "LOT_BUSY" }));
  }
  if (stored === "Processing") {
    return Object.assign(base, job(parseJson(f.link_job)), answer("BUSY", "409", "This Location Transfer is being processed in the background - please wait for it to finish.", { errorCode: "LOT_BUSY" }));
  }
  if (s(formStatus) !== stored) {
    return Object.assign(base, answer("STALE", "409", "This Location Transfer was changed by someone else (it is now " + (stored || "without a status") + "). Please close it and open it again.",
      { errorCode: "LOT_STALE" }));
  }
  if (stored === "Completed" || stored === "Cancelled") return Object.assign(base, answer("STALE", "409", "This Location Transfer is already " + stored + ".", { errorCode: "LOT_ALREADY_FINAL" }));
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  base.lockN = m ? Number(m[1]) + 1 : 1;
  // IA transfer request (scratchpad/iatr): a request's stock moves run only here, its picks are saved by the classic, every other
  // move of it is refused (the shared iatrTransition, as the classic's guard decides)
  const rq = iatrTransition({ stored: stored, storedPurpose: s(f.transfer_purpose), saveAs: saveAs, hasStored: true, payloadPurpose: "", payloadStatus: "" });
  if (rq.decision === "REFUSE") return Object.assign(base, answer("STOP", "400", rq.message, { errorCode: "LOT_REQUEST_MOVE" }));
  if (rq.decision === "SAVE") return Object.assign(base, notEligible("a transfer request's picks are saved by the classic save", base.lineCount, saveAs));
  if (rq.decision === "DISPATCH") return pick("STAGE", "Requested");
  if (stored === "Draft") {
    if (saveAs === "Cancelled") return Object.assign(base, answer("STOP", "400", "Only an In Progress Location Transfer can be cancelled.", { errorCode: "LOT_NOT_CANCELLABLE" }));
    return pick(saveAs === "Draft" ? "DRAFT" : saveAs === "In Progress" ? "STAGE" : "DIRECT", "Draft");
  }
  if (stored === "In Progress") {
    if (saveAs === "Draft") return Object.assign(base, answer("STOP", "400", "An In Progress transfer can't be saved back to Draft.", { errorCode: "LOT_IP_TO_DRAFT" }));
    // the caller's small cancels stay classic (within the classic's 500 lines), except a bundle LOT's: the classic cancel drops
    // its stored children (no parent_fm_key) and strands their In Transit stock
    if (saveAs === "Cancelled" && minLines > 0 && base.lineCount <= minLines && base.lineCount <= MAX_OLD_PATH_LINES && num(f.bundle_children) === 0 && base.purpose !== "YES") {
      return Object.assign(base, { action: "CANCEL", prevStatus: "In Progress" }, answer("NOT_ELIGIBLE", "300", "classic", { reason: "classic", errorCode: "LOT_NOT_ELIGIBLE" }));
    }
    return pick(saveAs === "In Progress" ? "EDIT" : saveAs === "Completed" ? "COMPLETE" : "CANCEL", "In Progress");
  }
  return Object.assign(base, notEligible("its status " + (stored || "(none)") + " is not one the background save takes", base.lineCount, saveAs));
};
const res = submitEntry([{{node:code_node_LSguard.data}}][0], [{{node:sql_node_LSfacts.data}}][0], [{{workflowparams:form.stock_movement_status}}][0],
  [{{workflowparams:min_lines}}][0]);
console.log("submit entry", JSON.stringify({ route: res.route, code: res.code, action: res.action, stored: res.storedStatus, lines: res.lineCount, lock: res.lockN, job: res.jobId,
  reason: res.reason }));
return res;
