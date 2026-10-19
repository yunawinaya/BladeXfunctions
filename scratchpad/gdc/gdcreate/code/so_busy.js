// GD_ASYNC_SUBMIT - Same sales order guard (decision): a new save (CREATE) or a confirmation (CONFIRM) is refused while
// another unfinished save delivers one of its sales orders. PREPARE counts an in-flight save only once its COMMIT has
// written the hidden (Processing) delivery, so two saves of one order checked before that would both pass and double it.
const soGuardBusy = function soGuardBusy(guard, decide, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.job_id));
  const busy = (s(decide.route) === "CREATE" || s(decide.route) === "CONFIRM") && list.length > 0;
  const r = list[0] || {};
  const review = s(r.job_status) === "REQUIRES_REVIEW";
  const so = s(r.source_so_no) || "the same sales order";
  const message = !busy
    ? ""
    : review
      ? "A background save of a delivery for " + so + " stopped half-way and is under review (job " + s(r.job_id) + "): please contact support before delivering it again."
      : "A delivery for " + so + " is still being saved in the background (job " + s(r.job_id) + ", " + s(r.job_status) + "). Wait for it to finish - it then appears in the list - before delivering this sales order again.";
  return {
    route: busy ? "BUSY" : "GO",
    result_code: busy ? (review ? "GD_SO_SAVE_REVIEW" : "GD_SO_SAVE_RUNNING") : "",
    result_message: message,
    job_id: "",
    job_status: "",
    created: "NO",
    idempotency_key: s(guard.idempotencyKey),
    payload_hash: s(guard.payloadHash),
    gd_id: "",
    gd_no: "",
    progress_message: "",
    line_errors: "[]",
    evidence: JSON.stringify({ v: 1, workflow: "GD_ASYNC_SUBMIT", path: busy ? "SO_BUSY" : "SO_FREE", busy_job: s(r.job_id), busy_status: s(r.job_status), route: s(decide.route) }),
  };
};
const res = soGuardBusy([{{node:code_node_EluyWNR5.data}}][0] || {}, [{{node:code_node_iJTFTwP3.data}}][0] || {}, [{{node:sql_node_GSsoBusy.data}}][0]);
console.log("submit same-SO decision", JSON.stringify({ route: res.route, result: res.result_code }));
return res;
