// IA_REVERT_V2_PREPARE - Ready: the engine's PLAN answer -> READY_TO_COMMIT, or FAILED + back to Completed (RV6)
const prepareReady = function prepareReady(entry, plan, engine) {
  const s = iaS;
  const e = entry || {};
  const p = plan || {};
  const g = engine || {};
  const endNow = () => (Number(e.jsAt) > 0 ? iaDbAddSeconds(e.dbNow, Math.max(0, Math.floor((Date.now() - Number(e.jsAt)) / 1000))) : "") || s(e.dbNow);
  const base = { route: "FAIL", needParts: "NO", needReady: "NO", readyRows: [], needJobUpd: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], result_code: "", result_message: "",
    job_status: "" };
  if (s(e.route) === "NOOP") return Object.assign(base, { route: "NOOP", result_code: s(e.result_code), result_message: s(e.result_message) });
  const row = (status, code, message, details, progress) => ({ id: s(e.jobId), job_status: status, progress_percent: 0, progress_message: progress.slice(0, 250),
    row_version: (Number(e.rowVersion) || 0) + 1, error_code: code, error_message: message, error_details: s(details) || JSON.stringify({ step: "IA_REVERT_V2_PREPARE" }),
    lease_owner: null, lease_expires_at: null, finished_at: endNow() || null });
  const review = (why) => Object.assign(base, { needJobUpd: "YES", jobRows: [row("REQUIRES_REVIEW", "IA_RV_PREV_STATUS_UNKNOWN", IA_TEXT.prevUnknown,
    JSON.stringify({ step: "IA_REVERT_V2_PREPARE", why: why, prevStatus: s(e.prevStatus) }), IA_TEXT.prevUnknown)], result_code: "IA_RV_PREV_STATUS_UNKNOWN", result_message: why,
    job_status: "REQUIRES_REVIEW" });
  const fail = (code, message, details, unlock) => {
    if (unlock && !iaRvPrevStatusOk(e.prevStatus)) return review(message + " (the status to restore is unknown: no unlock)");
    return Object.assign(base, { needJobUpd: "YES", jobRows: [row("FAILED", code, message, details, "Not reverted: " + message)], needUnlock: unlock ? "YES" : "NO",
      unlockRows: unlock ? [{ id: s(e.iaId), item_assembly_status: s(e.prevStatus) }] : [], result_code: code, result_message: message, job_status: "FAILED" });
  };
  if (s(e.route) === "REVIEW") return review(s(e.result_message) || "the job's prevStatus is " + (s(e.prevStatus) || "missing"));
  if (s(e.route) !== "GO") return fail(s(e.result_code) || "IA_RV_INVALID_REQUEST", s(e.result_message) || "the job's request could not be read", "", false);
  const unlock = Number(p.unlockOk) === 1 && iaDigits(e.iaId);
  if (s(p.route) !== "READY") return fail(s(p.code) || "IA_RV_PLAN_FAILED", s(p.message) || "The revert could not be prepared.", p.details, unlock);
  const labels = p.labels && typeof p.labels === "object" ? p.labels : {};
  const keys = iaList(p.keys);
  if (s(p.needPlan) === "YES") {
    const code = s(g.code);
    const answer = { code: code, result_code: s(g.result_code), message: s(g.message) || s(g.msg) };
    if (code === "200") {
      const results = iaJsonList(g.results);
      const off = results.filter((r) => s(r && r.code) !== "200");
      if (off.length) {
        const r = off[0];
        const text = iaMapEngineMessage(s(r.message) + " (movement " + s(r.movement_key) + ")", labels, keys) + ": nothing was moved.";
        return fail("IA_RV_PLAN_SKIPPED", text, JSON.stringify({ step: "IA_REVERT_V2_PREPARE", engine: answer, results: off.slice(0, 20) }), unlock);
      }
      if (results.length !== Number(p.movementCount)) {
        return fail("IA_RV_PLAN_FAILED", "The revert could not be prepared: the inventory plan answered " + results.length + " of " + Number(p.movementCount) + " movements.",
          JSON.stringify({ step: "IA_REVERT_V2_PREPARE", engine: answer }), unlock);
      }
    } else if (code === "400" && answer.result_code) {
      return fail("IA_RV_INVENTORY_" + answer.result_code, iaMapEngineMessage(answer.message, labels, keys) || answer.message, JSON.stringify({ step: "IA_REVERT_V2_PREPARE", engine: answer }), unlock);
    } else {
      return fail("IA_RV_PLAN_FAILED", "The revert could not be prepared: INVENTORY_BULK_APPLY answered " + (code || "nothing") + (answer.result_code ? " " + answer.result_code : "")
        + (answer.message ? ": " + answer.message.slice(0, 300) : ""), JSON.stringify({ step: "IA_REVERT_V2_PREPARE", engine: answer }), unlock);
    }
  }
  return Object.assign(base, {
    route: "OK", needParts: "YES", needReady: "YES",
    readyRows: [{ id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to revert: " + s(p.message)).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null, prepared_payload: s(p.payload), line_count: Number(p.lineCount) || 0 }],
    result_message: s(p.message), job_status: "READY_TO_COMMIT",
  });
};
const res = prepareReady([{{node:code_node_IVPentry.data}}][0], __PLAN__, __ENGINE__);
console.log("prepare ready", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
