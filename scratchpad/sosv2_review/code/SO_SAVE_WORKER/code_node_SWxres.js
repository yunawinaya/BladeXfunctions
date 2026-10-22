// SO Save V2 - shared helpers (included at the top of every code node by scripts/build-so-save-v2.mjs)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
const soParse = (t) => {
  if (t && typeof t === "object") return t;
  try {
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
};
// "YYYY-MM-DD HH:MM:SS" (the DB clock, MYT on dev) + seconds
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// a request's fingerprint (not security): two FNV-1a lanes over the text, 16 hex
const soHash = function soHash(text) {
  const t = String(text);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2 * (i & 7)) >>> 0;
  }
  const h = (n) => ("0000000" + n.toString(16)).slice(-8);
  return h(a) + h(b);
};
// a SO's lines with their bundle children, as one list (children carry no `children` of their own here)
const soFlatLines = (rows) => list(rows).flatMap((r) => [r].concat(list(r.children)));
// the SAVE_SO job statuses that hold a sales order
const SO_JOB_OPEN = ["QUEUED", "PREPARING", "CASCADE_PREPARING", "AWAITING_CONFIRMATION", "READY_TO_COMMIT", "COMMITTING_SO", "RELEASING", "AFTER", "REQUIRES_REVIEW"];

// ---- SO_SAVE_WORKER
// SO_SAVE_WORKER - drives one SAVE_SO job one stage per call (docs/lowcode/so-save-v2/PLAN.md, "SO_SAVE_WORKER design"):
// the claim (a unique claim row, row_version + 1, a lease), then SO_SAVE_PREPARE, one GD of the cascade through GD Edit V2,
// or SO_SAVE_COMMIT; the job row is the truth afterwards. Client-started: the form calls it while it follows the job.

const SO_WORK_LEASE_S = 300;
const SO_WORK_MAX_ATTEMPTS = 5;
const SO_WORK_PRE = ["QUEUED", "PREPARING", "CASCADE_PREPARING"];
const SO_WORK_COMMIT = ["READY_TO_COMMIT", "COMMITTING_SO", "RELEASING", "AFTER"];
const SO_WORK_END = ["COMPLETED", "FAILED", "CANCELLED", "REQUIRES_REVIEW", "AWAITING_CONFIRMATION"];
// GD Edit V2's own fallback: its inventory engine refused data the classic GD save handles (SO_CASCADE code_cd_gde_fallback)
const SO_WORK_GD_FALLBACK = ["GDE_INVENTORY_UNSUPPORTED_COSTING", "GDE_INVENTORY_DUPLICATE_BALANCE", "GDE_INVENTORY_UNSUPPORTED_PRICE"];

const soWorkGuard = function soWorkGuard(inp) {
  const out = { route: "", code: "", message: "", reason: "", tenantId: "0", jobIdSql: "0", nonce: "" };
  out.nonce = s(inp.uuid).replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
  const reject = (why) => Object.assign(out, answer("REJECT", "400", why));
  if (!digits(inp.tenantId)) return reject("no session tenant");
  out.tenantId = s(inp.tenantId);
  if (!digits(inp.jobId)) return reject("job_id: digits");
  out.jobIdSql = s(inp.jobId);
  if (!out.nonce) return reject("no run nonce");
  return Object.assign(out, answer("GO", "", ""));
};

// the fields every node that may end the job carries (the job row, the unlock, the holds to cancel)
const soWorkTail = function soWorkTail(pick) {
  const p = pick || {};
  return { route: "", code: "", message: "", reason: "", needJob: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], needCancel: "NO", cancelHolds: [], cancelOp: "CANCEL_HELD",
    cascadeRef: s(p.cascadeRef) };
};
const soWorkEnd = function soWorkEnd(pick, out, status, code, message, details) {
  const pre = status === "FAILED";
  return Object.assign(out, { route: pre ? "FAIL" : "REVIEW", code: pre ? "500" : "409", message: message, reason: code, needJob: "YES",
    jobRows: [{ id: pick.jobId, job_status: status, progress_percent: 100, progress_message: (pre ? "Not saved: " : "Needs review: ") + message, prepared_payload: pick.preparedPayload,
      error_code: code, error_message: message, error_details: details ? JSON.stringify(details) : "", confirmation_token: "", finished_at: pick.dbNow }],
    needUnlock: pre && pick.soId !== "0" ? "YES" : "NO", unlockRows: pre && pick.soId !== "0" ? [{ id: pick.soId, is_processing: 0 }] : [],
    needCancel: pre && pick.holds.length ? "YES" : "NO", cancelHolds: pre ? pick.holds : [] });
};

// Pick: what this call does with the job (facts: the job, its claim row at this row version, the DB clock).
const soWorkPick = function soWorkPick(guard, factRows) {
  const f = list(factRows)[0] || {};
  const pp = soParse(f.prepared_payload) || {};
  const st = s(f.job_status);
  const now = s(f.db_now);
  const out = Object.assign(soWorkTail({ cascadeRef: "SOV2|" + s(f.job_id) }), { route: "ANSWER", code: "200", dbNow: now, jobId: s(f.job_id), jobStatus: st, action: "",
    soId: (s(f.correlation_id).match(/^SO\|([0-9]+)$/) || [])[1] || "0", preparedPayload: s(f.prepared_payload), stage: s(pp.stage), newRv: 0, claimRows: [], claimJob: [],
    holds: list(pp.holds).filter((h) => digits(h.job_id) && digits(h.gd_id)), lease: "WRK|" + guard.nonce });
  if (!out.jobId) return Object.assign(out, { code: "404", message: "Save job not found" });
  if (SO_WORK_END.indexOf(st) >= 0) return Object.assign(out, { message: s(f.progress_message) });
  if (s(f.cancel_requested) === "1") return soWorkEnd(out, out, SO_WORK_COMMIT.indexOf(st) >= 0 ? "REQUIRES_REVIEW" : "FAILED", "SOV2_CANCEL_REQUESTED", "the save was cancelled");
  const leaseLive = !!s(f.lease_owner) && s(f.lease_expires_at) > now;
  if (leaseLive) return Object.assign(out, { route: "WAIT", message: "Being saved" });
  if (s(f.next_attempt_at) && s(f.next_attempt_at) > now) return Object.assign(out, { route: "WAIT", message: "Not due yet" });
  // a run that claimed and died: its lease ran out (or its claim row is there with no lease): one attempt
  const rv = num(f.row_version);
  const dead = !!s(f.lease_owner) || num(f.claim_taken) > 0;
  const attempts = num(f.attempt_count) + (dead ? 1 : 0);
  if (attempts >= SO_WORK_MAX_ATTEMPTS) {
    return soWorkEnd(out, out, SO_WORK_COMMIT.indexOf(st) >= 0 ? "REQUIRES_REVIEW" : "FAILED", "SOV2_RETRIES", "the background save stopped " + attempts + " times");
  }
  const base = num(f.claim_taken) > 0 ? rv + 1 : rv;
  out.newRv = base + 1;
  // the status the stage runs under: a fresh or re-queued job prepares; one re-queued at a delivery's question holds again
  let status = st;
  if (st === "QUEUED") status = s(pp.stage) === "HOLD" ? "CASCADE_PREPARING" : "PREPARING";
  out.action = SO_WORK_COMMIT.indexOf(status) >= 0 ? "COMMIT" : status === "CASCADE_PREPARING" ? "HOLD" : "PREPARE";
  out.claimRows = [{ job_id: "SOW|" + out.jobId, organization_id: digits(f.organization_id) ? s(f.organization_id) : "0", step_name: "W0_CLAIM_" + base, step_status: "CLAIM", attempt_count: attempts,
    started_at: now, result_ref: out.lease }];
  out.claimJob = [{ id: out.jobId, row_version: out.newRv, job_status: status, lease_owner: out.lease, lease_expires_at: dbAddSeconds(now, SO_WORK_LEASE_S), attempt_count: attempts,
    next_attempt_at: null }];
  out.jobStatus = status;
  return Object.assign(out, { route: "CLAIM", message: "" });
};

// Own: the claim as written (row version and lease), else another run took it.
const soWorkOwn = function soWorkOwn(pick, ownRows) {
  const o = list(ownRows)[0] || {};
  const mine = num(o.row_version) === pick.newRv && s(o.lease_owner) === pick.lease;
  return { route: mine ? "GO" : "LOST", message: mine ? "" : "another run took this job", newRv: String(pick.newRv) };
};

// Hold, node 1: the next GD of the cascade (G parts in order): SUBMIT it to GD Edit V2, or (submitted on an earlier call)
// run GD_EDIT_WORKER on its job.
const soWorkHold1 = function soWorkHold1(pick, factRows, gRows) {
  const f = list(factRows)[0] || {};
  const pp = soParse(f.prepared_payload) || {};
  const rp = soParse(f.request_payload) || {};
  const pending = pp.pending && digits(pp.pending.gd_id) ? pp.pending : null;
  const g = soParse((list(gRows)[0] || {}).result_ref) || {};
  const answers = rp.answers || {};
  return { route: pending && digits(pending.job_id) ? "WORKER" : "SUBMIT", gdId: s(pending ? pending.gd_id : g.gd_id), gdNo: s(pending ? pending.gd_no : g.gd_no), gdeJobId: s(pending ? pending.job_id : ""),
    note: s(pending ? pending.note : ""),
    form: pending ? {} : g.allData || {}, operation: "SUBMIT", source: "CASCADE", cascadeRef: pick.cascadeRef,
    // classic SO_CASCADE code_cd_gde_args' answers
    answers: { needCL: "auto", continueZero: "Yes", confirmPickReversal: s(answers.confirmPickReversal) }, part: s((list(gRows)[0] || {}).step_name) };
};
// the G part this call reads: the first GD not yet held
const soWorkGPart = function soWorkGPart(pick) {
  const pp = soParse(pick.preparedPayload) || {};
  const ref = /^SOG\|[0-9A-Za-z]{1,24}$/.test(s(pp.gRef)) ? s(pp.gRef) : "";
  return { gRef: ref, gPart: "G|" + ("00" + (list(pp.holds).length + 1)).slice(-3) };
};

// Hold, node 2: GD Edit V2's answer -> the job: the next GD, READY_TO_COMMIT (all held), a question (413), or an end.
const soWorkHold2 = function soWorkHold2(pick, h1, sub, wrk) {
  const out = soWorkTail(pick);
  const pp = soParse(pick.preparedPayload) || {};
  const total = num(pp.gdParts);
  const name = h1.gdNo || h1.gdId;
  const row = (o) => Object.assign({ id: pick.jobId, job_status: "CASCADE_PREPARING", progress_percent: 30, progress_message: "", prepared_payload: pick.preparedPayload, error_code: "",
    error_message: "", error_details: "", confirmation_token: "", finished_at: null }, o);
  const write = (o, extra) => Object.assign(out, { route: "MORE", needJob: "YES", jobRows: [row(o)] }, extra || {});
  if (h1.route === "SUBMIT") {
    const a = sub || {};
    if (s(a.route) === "QUEUED" && digits(a.job_id)) {
      // the stock to put back after a pick reversal (classic SO_CASCADE's pickingReversalNote) rides with the delivery
      const next = Object.assign({}, pp, { pending: { gd_id: h1.gdId, gd_no: h1.gdNo, job_id: s(a.job_id), note: s(a.picking_reversal_note) } });
      return write({ progress_message: "Checking delivery " + name, prepared_payload: JSON.stringify(next) }, { message: "submitted " + name });
    }
    // GD Edit V2's reason rides along (e.g. "its Picking is shared with other deliveries")
    if (s(a.route) === "NOT_ELIGIBLE") return soWorkEnd(pick, out, "FAILED", "SOV2_NOT_ELIGIBLE", "delivery " + name + " is saved the classic way (" + (s(a.reason) || s(a.message) || "GD Edit V2 does not take it") + ")", { gateCode: "300" });
    if (s(a.code) === "413") {
      // GD asks whether to reverse quantities already picked: the form asks; CONFIRM re-queues and this GD is submitted again
      const q = { gateCode: "413", message: s(a.message), gd_id: h1.gdId };
      return Object.assign(out, { route: "ASK", code: "413", message: s(a.message), needJob: "YES",
        jobRows: [row({ job_status: "AWAITING_CONFIRMATION", progress_message: s(a.message), error_code: "413", error_message: s(a.message), error_details: JSON.stringify(q), confirmation_token: pick.lease.slice(4) })] });
    }
    return soWorkEnd(pick, out, "FAILED", s(a.code) || "406", "Delivery " + name + ": " + (s(a.message) || "it could not be changed"), { gateCode: s(a.code) || "406", message: s(a.message) });
  }
  const w = wrk || {};
  const st = s(w.job_status);
  if (st === "HELD") {
    const holds = list(pp.holds).concat([{ gd_id: h1.gdId, gd_no: h1.gdNo, job_id: h1.gdeJobId, note: s(h1.note) }]);
    const next = Object.assign({}, pp, { holds: holds, pending: null });
    if (holds.length >= total) {
      next.stage = "COMMIT";
      return write({ job_status: "READY_TO_COMMIT", progress_percent: 35, progress_message: "Ready to save", prepared_payload: JSON.stringify(next) }, { message: "all held" });
    }
    return write({ progress_message: "Delivery " + name + " checked (" + holds.length + " of " + total + ")", prepared_payload: JSON.stringify(next) }, { message: "held " + name });
  }
  if (st === "FAILED" && SO_WORK_GD_FALLBACK.indexOf(s(w.result_code)) >= 0) return soWorkEnd(pick, out, "FAILED", "SOV2_NOT_ELIGIBLE", "delivery " + name + " is saved the classic way", { gateCode: "300" });
  if (st === "FAILED" || st === "CANCELLED") return soWorkEnd(pick, out, "FAILED", "406", "Delivery " + name + ": " + (s(w.result_message) || "it could not be checked"), { gateCode: "406", message: s(w.result_message) });
  // not prepared yet: the next call runs its worker again
  return Object.assign(out, { route: "MORE", message: "delivery " + name + " still being checked (" + (st || "no answer") + ")" });
};

// Result: the job as it now is (the truth), as SUBMIT's STATUS answers it.
const soWorkResult = function soWorkResult(guard, pick, src, endRows) {
  const e = list(endRows)[0] || {};
  const r = src || {};
  const st = s(e.job_status) || s((pick || {}).jobStatus);
  // no such job: nothing more to do (the form stops following it)
  const missing = !s((pick || {}).jobId) && s(r.code) === "404";
  const route = s(r.route) === "REJECT" ? "REJECT" : missing ? "STOP" : SO_WORK_END.indexOf(st) >= 0 ? "DONE" : s(r.route) === "WAIT" ? "WAIT" : s(r.route) === "LOST" ? "WAIT" : "MORE";
  return { route: route, code: s(r.code) || "200", message: s(r.message) || s(e.progress_message), job_id: s((pick || {}).jobId || guard.jobIdSql), job_status: st,
    progress_percent: String(num(e.progress_percent)), progress_message: s(e.progress_message), error_code: s(e.error_code), error_message: s(e.error_message),
    result: st === "COMPLETED" || st === "AWAITING_CONFIRMATION" || st === "FAILED" ? s(e.error_details) : "", confirmation_token: st === "AWAITING_CONFIRMATION" ? s(e.confirmation_token) : "",
    evidence: JSON.stringify({ v: 1, workflow: "SO_SAVE_WORKER", action: s((pick || {}).action), route: s(r.route), status: st }) };
};

// ---- this node
const res = soWorkResult([{{node:code_node_SWguard.data}}][0], [{{node:code_node_SWpick.data}}][0], [{{node:code_node_SWpick.data}}][0], [{{node:sql_node_SWxend.data}}][0]);
console.log("so worker result", JSON.stringify({ route: res.route, status: res.job_status, message: res.message }));
return res;