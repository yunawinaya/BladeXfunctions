// LOT_V2_SUBMIT - Post: DRAFT (no job: the document write and its answer) or the queue rows (CONTRACT sections 3, 7). Edit:
// the LOT's lock (gd_publish_step SMLT|<lot> / LOCK|<n>, result_ref = the idempotency key; unique: a concurrent twin fails its
// run); the SAVE_LOT job QUEUED but due only in 2 minutes (no worker takes it before the LOT is Processing under it; due.js
// makes it due after the read-back); Add: the job only (LOCK|1 follows the insert). A stored Draft whose number an earlier
// SAVE_LOT job issued is written without the number props (no second number is burned).
const submitPost = function submitPost(guard, entry, keys, gate) {
  const empty = { lockRows: [], jobRows: [], needLock: "NO", isAdd: "NO", numberProps: "NO", request: "", idemStore: "", partCount: 0 };
  if (s(gate.route) !== "GO") return answer("STOP", s(gate.code) || "400", s(gate.message) || "the gate did not answer", Object.assign(empty, { errorCode: s(gate.errorCode) }));
  const add = guard.pageStatus === "Add";
  const act = entry.action;
  if (act === "DRAFT") return answer("DRAFT", "200", "", Object.assign(empty, { isAdd: add ? "YES" : "NO", idemStore: guard.key + "#" + guard.nonce }));
  if (!digits(keys.organizationId)) return answer("STOP", "400", "the Location Transfer has no organization", Object.assign(empty, { errorCode: "LOT_INVALID_DATA" }));
  const editing = act === "COMPLETE" || act === "EDIT";
  const names = editing ? list(gate.partNames).map(s) : [];
  const request = { v: 1, action: act, prevStatus: entry.prevStatus, saveAs: guard.saveAs, pageStatus: add ? "Add" : "Edit", lotId: add ? "" : guard.lotId,
    lotNo: add ? "" : entry.lotNo, issuedNo: "", lineFingerprint: s(gate.lineFingerprint), incomingFingerprint: editing ? s(gate.incomingFingerprint) : "",
    edited: editing ? num(gate.edited) : 0, organizationId: keys.organizationId, plantId: keys.plantId, lineCount: num(gate.lineCount), rowCount: num(gate.rowCount),
    movementCount: num(gate.movementCount), uid: guard.uid, source: guard.source, nonce: guard.nonce, parts: editing ? { LINES: names } : {} };
  if (!lotPrevStatusOk(request.prevStatus)) return answer("STOP", "400", "the status to restore is unknown", Object.assign(empty, { errorCode: "LOT_INVALID_DATA" }));
  if (editing && !names.length) return answer("STOP", "400", "the lines to write were not prepared", Object.assign(empty, { errorCode: "LOT_INVALID_DATA" }));
  return answer("QUEUE", "200", "queued", {
    request: JSON.stringify(request),
    isAdd: add ? "YES" : "NO",
    numberProps: add || entry.issuedReuse !== "YES" ? "YES" : "NO",
    idemStore: "",
    partCount: names.length,
    lockRows: add ? [] : [{ job_id: "SMLT|" + guard.lotId, organization_id: keys.organizationId, step_name: "LOCK|" + entry.lockN, step_status: "LOCK", attempt_count: 0,
      started_at: entry.dbNow, result_ref: guard.key }],
    needLock: add ? "NO" : "YES",
    jobRows: [{ organization_id: keys.organizationId, plant_id: keys.plantId, command: "SAVE_LOT", idempotency_key: guard.key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: lotDbAddSeconds(entry.dbNow, 120),
      request_payload: JSON.stringify(request), causation_id: add ? "" : guard.lotId, correlation_id: add ? "" : "LOT|" + guard.lotId, line_count: num(gate.lineCount),
      queued_at: entry.dbNow }],
  });
};
const res = submitPost([{{node:code_node_LSguard.data}}][0], [{{node:code_node_LSentry.data}}][0], [{{node:code_node_LSkeys.data}}][0],
  { route: [{{node:code_node_LSgate.data.route}}][0], code: [{{node:code_node_LSgate.data.code}}][0], message: [{{node:code_node_LSgate.data.message}}][0],
    errorCode: [{{node:code_node_LSgate.data.errorCode}}][0], lineCount: [{{node:code_node_LSgate.data.lineCount}}][0], rowCount: [{{node:code_node_LSgate.data.rowCount}}][0],
    movementCount: [{{node:code_node_LSgate.data.movementCount}}][0], lineFingerprint: [{{node:code_node_LSgate.data.lineFingerprint}}][0],
    incomingFingerprint: [{{node:code_node_LSgate.data.incomingFingerprint}}][0], edited: [{{node:code_node_LSgate.data.edited}}][0],
    partNames: [{{node:code_node_LSgate.data.partNames}}][0] });
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message, add: res.isAdd, number: res.numberProps, parts: res.partCount }));
return res;
