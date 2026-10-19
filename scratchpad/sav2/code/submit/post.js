// SA_V2_SUBMIT - Post: the queue rows (CONTRACT §3, §4, §7). COMPLETE: the SA's lock (SAC|<sa> / LOCK|<n+1>) first; REVIEW: the
// Stock Count's twin guard (SCR|<sc> / LOCK|<n+1>) first - unique tenant / job / step, a concurrent twin fails its run; the
// COMPLETE_SA job QUEUED but due only in 2 minutes (no worker takes it before the SA is Processing under it; due.js makes it due
// after the read-back); DIRECT / REVIEW take the new SA's LOCK|1 after its insert. A stored Draft whose number an earlier
// COMPLETE_SA job issued is written without the number props (no second number is burned).
const submitPost = function submitPost(guard, entry, gate) {
  const empty = { lockRows: [], jobRows: [], needLock: "NO", numberProps: "NO", request: "", partCount: 0, linesBack: "NO", lineCount: num(gate.lineCount) };
  if (s(gate.route) !== "GO") return answer("STOP", s(gate.code) || "400", s(gate.message) || "the gate did not answer", Object.assign(empty, { errorCode: s(gate.errorCode) }));
  const act = entry.action;
  const review = act === "REVIEW";
  if (!digits(gate.organizationId)) return answer("STOP", "400", "The Stock Adjustment has no organization.", Object.assign(empty, { errorCode: "SA_INVALID_DATA" }));
  const names = list(gate.partNames).map(s);
  const partKey = act === "COMPLETE" ? "DOC" : review ? "SC" : "";
  const parts = {};
  if (partKey) parts[partKey] = names;
  const request = { v: 1, source: guard.source, action: act, prevStatus: entry.prevStatus, saveAs: "Completed", pageStatus: review ? "Add" : guard.pageStatus,
    saId: act === "COMPLETE" ? guard.saId : "", saNo: act === "COMPLETE" ? s(entry.saNo) : "", issuedNo: "", scId: review ? guard.scId : s(gate.stockCountId),
    lineFingerprint: s(gate.lineFingerprint), incomingFingerprint: s(gate.incomingFingerprint), edited: act === "COMPLETE" ? num(gate.edited) : 0,
    scFingerprint: review ? s(gate.scFingerprint) : "", organizationId: s(gate.organizationId), plantId: s(gate.plantId), lineCount: num(gate.lineCount),
    entryCount: num(gate.entryCount), movementCount: num(gate.movementCount), uid: guard.uid, source_form: review ? "SC" : "SA", nonce: guard.nonce, parts: parts };
  // the review's chain inputs besides its SC record (S|..|SC): PREPARE re-runs the same chain on fresh reads
  if (review) Object.assign(request, { createAdjustment: guard.createAdjustment, nickname: guard.nickname, adjustmentDate: guard.adjustmentDate });
  if (!saPrevStatusOk(request.prevStatus)) return answer("STOP", "400", "the status to restore is unknown", Object.assign(empty, { errorCode: "SA_INVALID_DATA" }));
  if (partKey && !names.length) return answer("STOP", "400", "the parts to write were not prepared", Object.assign(empty, { errorCode: "SA_INVALID_DATA" }));
  const lock = (job) => ({ job_id: job, organization_id: request.organizationId, step_name: "LOCK|" + num(entry.lockN), step_status: "LOCK", attempt_count: 0,
    started_at: entry.dbNow, result_ref: guard.key });
  const lockRows = act === "COMPLETE" ? [lock("SAC|" + guard.saId)] : review ? [lock("SCR|" + guard.scId)] : [];
  const text = JSON.stringify(request);
  return answer("QUEUE", "200", "queued", {
    request: text,
    numberProps: act === "COMPLETE" && entry.issuedReuse === "YES" ? "NO" : "YES",
    partCount: names.length,
    lineCount: request.lineCount,
    lockRows: lockRows,
    needLock: lockRows.length ? "YES" : "NO",
    // DIRECT: the new SA's lines are read back for its lineFingerprint
    linesBack: act === "DIRECT" ? "YES" : "NO",
    jobRows: [{ organization_id: request.organizationId, plant_id: request.plantId, command: "COMPLETE_SA", idempotency_key: guard.key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: saDbAddSeconds(entry.dbNow, 120), request_payload: text,
      causation_id: act === "COMPLETE" ? guard.saId : "", correlation_id: act === "COMPLETE" ? "SA|" + guard.saId : "", line_count: request.lineCount, queued_at: entry.dbNow }],
  });
};
const res = submitPost([{{node:code_node_SSguard.data}}][0], [{{node:code_node_SSentry.data}}][0],
  { route: [{{node:code_node_SSgate.data.route}}][0], code: [{{node:code_node_SSgate.data.code}}][0], message: [{{node:code_node_SSgate.data.message}}][0],
    errorCode: [{{node:code_node_SSgate.data.errorCode}}][0], lineCount: [{{node:code_node_SSgate.data.lineCount}}][0], entryCount: [{{node:code_node_SSgate.data.entryCount}}][0],
    movementCount: [{{node:code_node_SSgate.data.movementCount}}][0], lineFingerprint: [{{node:code_node_SSgate.data.lineFingerprint}}][0],
    incomingFingerprint: [{{node:code_node_SSgate.data.incomingFingerprint}}][0], edited: [{{node:code_node_SSgate.data.edited}}][0],
    scFingerprint: [{{node:code_node_SSgate.data.scFingerprint}}][0], stockCountId: [{{node:code_node_SSgate.data.stockCountId}}][0],
    partNames: [{{node:code_node_SSgate.data.partNames}}][0], plantId: [{{node:code_node_SSgate.data.plantId}}][0],
    organizationId: [{{node:code_node_SSgate.data.organizationId}}][0] });
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message, number: res.numberProps, parts: res.partCount, lock: res.needLock }));
return res;
