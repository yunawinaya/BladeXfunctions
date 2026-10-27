// IA_V2_PREPARE - Ready: the plan + both PLAN answers -> READY_TO_COMMIT, FAILED (+ the unlock) or REQUIRES_REVIEW
const endNow = (entry) => (Number(entry.jsAt) > 0 ? iaDbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const iaPlanVerdict = function iaPlanVerdict(side, g, count, labels, keys) {
  const s = iaS;
  const e = g || {};
  const code = s(e.code);
  const details = { side: side, engine: { code: code, result_code: s(e.result_code) } };
  const no = (c, message, more) => ({ ok: false, code: c, message: message, details: Object.assign(details, more || {}) });
  if (code === "200") {
    const results = iaJsonList(e.results);
    const bad = results.filter((r) => s(r && r.code) !== "200")[0];
    if (bad) {
      const text = (s(bad.message) || "result " + s(bad.code)) + " (movement " + s(bad.movement_key) + ")";
      return no("IA_PLAN_SKIPPED", iaMapEngineMessage(text, labels, keys) + ": nothing was moved.", { movement_key: s(bad.movement_key), result: s(bad.code) });
    }
    if (results.length !== count) return no("IA_PLAN_FAILED", "The completion could not be prepared: the stock check answered " + results.length + " results for " + count + " movements.");
    return null;
  }
  if (code === "400" && s(e.result_code)) {
    return no("IA_INVENTORY_" + s(e.result_code), iaMapEngineMessage(s(e.message), labels, keys) || s(e.result_code), { movement_key: iaMovementKeyOf(s(e.message), keys) });
  }
  return no("IA_PLAN_FAILED", "The completion could not be prepared: the stock check answered " + (code || "nothing") + (s(e.message) ? " (" + s(e.message).slice(0, 200) + ")" : "") + ".");
};
const prepareReady = function prepareReady(entry, plan, planI, planR) {
  const s = iaS;
  const e = entry || {};
  const p = plan || {};
  const base = { route: "FAIL", needParts: "NO", needReady: "NO", readyRows: [], needJobUpd: "NO", jobRows: [], needLink: "NO", linkRows: [], needUnlock: "NO", unlockRows: [],
    result_code: "", result_message: "", job_status: "" };
  if (s(e.route) === "NOOP") return Object.assign(base, { route: "NOOP", result_code: s(e.result_code), result_message: s(e.result_message) });
  const end = (status, code, message, unlock, details, link) => {
    const rows = iaPrevStatusOk(e.prevStatus) ? unlock.filter((u) => iaDigits(u.id)).map((u) => ({ id: s(u.id), item_assembly_status: s(e.prevStatus) })) : [];
    const review = status === "REQUIRES_REVIEW" || (unlock.length > 0 && !rows.length);
    const st = review ? "REQUIRES_REVIEW" : "FAILED";
    const c = review && status !== "REQUIRES_REVIEW" ? "IA_PREV_STATUS_UNKNOWN" : code;
    const msg = review && status !== "REQUIRES_REVIEW" ? IA_TEXT.prevUnknown : message;
    const row = { id: s(e.jobId), job_status: st, progress_percent: 0, progress_message: ((st === "FAILED" ? "Not completed: " : "") + msg).slice(0, 250),
      attempt_count: Number(e.attempts) || 0, next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: (Number(e.rowVersion) || 0) + 1, error_code: c,
      error_message: msg, error_details: JSON.stringify(Object.assign({ step: "IA_V2_PREPARE", action: s(e.action) }, details || {})), finished_at: endNow(e) || null };
    const linked = link && s(link.correlation_id) ? [Object.assign(row, { correlation_id: s(link.correlation_id), causation_id: s(link.causation_id), request_payload: s(link.request_payload) })] : [];
    return Object.assign(base, {
      needJobUpd: linked.length ? "NO" : "YES", jobRows: linked.length ? [] : [row], needLink: linked.length ? "YES" : "NO", linkRows: linked,
      needUnlock: !review && rows.length ? "YES" : "NO", unlockRows: !review ? rows : [], result_code: c, result_message: msg, job_status: st,
    });
  };
  if (s(e.route) === "REVIEW") return end("REQUIRES_REVIEW", s(e.result_code), s(e.result_message), []);
  if (s(e.route) === "FAIL") return end("FAILED", s(e.result_code) || "IA_INVALID_REQUEST", s(e.result_message), iaList(e.unlockRows), null, e.link);
  const mineIa = String(p.unlockOk) === "1" ? [{ id: s(e.iaId) }] : [];
  if (s(p.route) !== "PLAN") return end("FAILED", s(p.code) || "IA_PLAN_FAILED", s(p.message) || "The completion could not be prepared.", mineIa);
  const labels = p.labels && typeof p.labels === "object" ? p.labels : {};
  const keysI = Object.keys(labels).filter((k) => /^M[0-9]+$/.test(k));
  // the receipts: R1, or one per output split row (R1..Rn)
  const keysR = Object.keys(labels).filter((k) => /^R[0-9]+$/.test(k));
  const v = iaPlanVerdict("I", planI, Number(p.movementCount) || 0, labels, keysI) || iaPlanVerdict("R", planR, keysR.length || 1, labels, keysR.length ? keysR : ["R1"]);
  if (v) return end("FAILED", v.code, v.message, mineIa, v.details);
  return Object.assign(base, {
    route: "OK", needParts: "YES", needReady: "YES",
    readyRows: [{ id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to complete: " + s(p.message)).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null, prepared_payload: s(p.payload), line_count: Number(p.pickCount) || 0 }],
    result_message: s(p.message), job_status: "READY_TO_COMMIT",
  });
};
const p = { route: [{{node:code_node_IPplan.data.route}}][0], code: [{{node:code_node_IPplan.data.code}}][0], message: [{{node:code_node_IPplan.data.message}}][0],
  payload: [{{node:code_node_IPplan.data.payload}}][0], pickCount: [{{node:code_node_IPplan.data.pickCount}}][0], movementCount: [{{node:code_node_IPplan.data.movementCount}}][0],
  unlockOk: [{{node:code_node_IPplan.data.unlockOk}}][0], labels: [{{node:code_node_IPplan.data.labels}}][0] };
const planI = { code: [{{node:workflow_node_IPplanI.data.code}}][0], result_code: [{{node:workflow_node_IPplanI.data.result_code}}][0],
  message: [{{node:workflow_node_IPplanI.data.message}}][0], results: [{{node:workflow_node_IPplanI.data.results}}][0] };
const planR = { code: [{{node:workflow_node_IPplanR.data.code}}][0], result_code: [{{node:workflow_node_IPplanR.data.result_code}}][0],
  message: [{{node:workflow_node_IPplanR.data.message}}][0], results: [{{node:workflow_node_IPplanR.data.results}}][0] };
const res = prepareReady([{{node:code_node_IPentry.data}}][0], p, planI, planR);
console.log("prepare ready", JSON.stringify({ route: res.route, status: res.job_status, result: res.result_code, message: res.result_message }));
return res;
