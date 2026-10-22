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


// ---- SO_SAVE_SUBMIT
// SO_SAVE_SUBMIT - the synchronous part of the SO Save V2: classic SO_SAVE's checks (lifted, same order, same texts), the
// BUSY / eligibility facts, then the queue rows. The lifted classic nodes (run_<name>, see scripts/build-so-save-v2.mjs):
//   run_soX4 code_node_X4j8BSXd, run_soDraftNo code_node_hVnUCBf3, run_soReqIssue code_node_imQ7epYD,
//   run_soReqDraft code_node_0Qhz2xtF, run_crfCheck CHECK_REQUIRED_FIELD, run_soQtyMap code_node_7fbO0wKC,
//   run_vqCheck VALIDATE_QUANTITY, run_soFilter code_node_rPqQy5CD, run_soCount code_node_DXjOWBWI,
//   run_so405 code_node_01WBgiHb, run_soPrice code_node_NSa659R4, run_clIsBlock code_node_vqKDnsnD.

const SO_PART_LINES = 250; // top-level lines (with their children) per stored request part
const SO_APPROVAL_SLOT = "slot_node_ehX7sDpE"; // classic SO_SAVE's approval slot: CHECK_APPROVAL looks its config up by it

// The answer fields every result carries (declared once, so no token ever reads an absent field).
const soSubmitBase = function soSubmitBase() {
  return { route: "", code: "", message: "", reason: "", operation: "", tenantId: "0", uid: "", nonce: "", soId: "0", soNo: "", jobIdSql: "0",
    isEdit: "NO", isIssue: "NO", saveAs: "", pageStatus: "", previousStatus: "", organizationId: "0", plantId: "0", payloadHash: "", lineCount: 0,
    partRows: [], partCount: 0, needCl: "NO", clCustomer: "", clTotal: "0", clDocType: "Sales Orders", approvalDocType: "SO", approvalSlot: SO_APPROVAL_SLOT,
    approvalData: {}, priceMessage: "", minResult: "passed", maxResult: "passed", token: "", answers: {} };
};

// Guard: the operation and its input; for SUBMIT, classic's checks up to 405 (they read the payload, and this is the
// only node that does). inp: { operation, allData, jobId, soId, token, answers, tenantId, uid, uuid }.
const soSubmitGuard = function soSubmitGuard(inp) {
  const out = soSubmitBase();
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  out.operation = op;
  out.uid = digits(inp.uid) ? s(inp.uid) : "";
  out.nonce = s(inp.uuid).replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
  const reject = (why) => Object.assign(out, answer("REJECT", "400", why));
  if (["SUBMIT", "STATUS", "CONFIRM"].indexOf(op) < 0) return reject("operation must be SUBMIT, STATUS or CONFIRM");
  if (!digits(inp.tenantId)) return reject("no session tenant");
  out.tenantId = s(inp.tenantId);
  if (op === "STATUS") {
    if (!digits(inp.jobId) && !digits(inp.soId)) return reject("STATUS needs job_id or so_id (digits)");
    out.jobIdSql = digits(inp.jobId) ? s(inp.jobId) : "0";
    out.soId = digits(inp.soId) ? s(inp.soId) : "0";
    return Object.assign(out, answer("FACTS", "", ""));
  }
  if (op === "CONFIRM") {
    const a = inp.answers && typeof inp.answers === "object" ? inp.answers : soParse(inp.answers) || {};
    const decision = s(a.decision).toUpperCase();
    if (!digits(inp.jobId)) return reject("CONFIRM needs job_id (digits)");
    if (!s(inp.token)) return reject("CONFIRM needs confirmation_token");
    if (["PROCEED", "CANCEL"].indexOf(decision) < 0) return reject("answers.decision must be PROCEED or CANCEL");
    const yn = (v) => (s(v) === "Yes" || s(v) === "No" ? s(v) : "");
    out.jobIdSql = s(inp.jobId);
    out.token = s(inp.token);
    out.answers = { decision: decision, raiseGdQty: yn(a.raiseGdQty), confirmPickReversal: yn(a.confirmPickReversal) };
    return Object.assign(out, answer("FACTS", "", ""));
  }

  // SUBMIT
  const allData = inp.allData && typeof inp.allData === "object" ? inp.allData : null;
  if (!allData || Array.isArray(allData)) return reject("allData: the sales order form");
  const P = { allData: allData };
  const isDraft = allData.so_status == "Draft"; // classic if_BA0MN7OZ
  out.isEdit = s(allData.page_status) === "Edit" ? "YES" : "NO";
  out.isIssue = isDraft ? "NO" : "YES";
  out.saveAs = isDraft ? "Draft" : "Issued";
  out.pageStatus = s(allData.page_status);
  out.previousStatus = s(allData.previous_status);
  out.soNo = s(allData.so_no);
  out.organizationId = digits(allData.organization_id) ? s(allData.organization_id) : "0";
  out.plantId = digits(allData.plant_name) ? s(allData.plant_name) : "0";
  if (out.isEdit === "YES") {
    if (!digits(allData.id)) return reject("allData.id: digits (an edit)");
    out.soId = s(allData.id);
  }
  const lines = list(allData.table_so);
  out.lineCount = soFlatLines(lines).length;
  out.payloadHash = soHash(JSON.stringify(allData));

  if (isDraft) {
    const e = run_soDraftNo({}, P);
    const req = run_soReqDraft({ code_node_hVnUCBf3: e }, P);
    const crf = run_crfCheck({}, { entry: req.data, required_fields: req.required_fields });
    if (s(crf.status) !== "Passed") return Object.assign(out, answer("ANSWER", "400", crf.message, { reason: "required fields" }));
  } else {
    const e = run_soX4({}, P);
    const req = run_soReqIssue({ code_node_X4j8BSXd: e }, P);
    const crf = run_crfCheck({}, { entry: req.data, required_fields: req.required_fields });
    if (s(crf.status) !== "Passed") return Object.assign(out, answer("ANSWER", "400", crf.message, { reason: "required fields" }));
    const qm = run_soQtyMap({ code_node_X4j8BSXd: e }, P);
    const vq = run_vqCheck({}, { lineItem: qm.lineItem, itemFields: qm.itemFields, quantityFields: qm.quantityFields });
    if (s(vq.status) !== "Passed") return Object.assign(out, answer("ANSWER", "401", vq.message, { reason: "quantities" }));
    const f = run_soFilter({ code_node_X4j8BSXd: e }, P);
    const cnt = run_soCount({ code_node_rPqQy5CD: f }, P);
    if (Number(cnt.length) === 0) return Object.assign(out, answer("ANSWER", "401", "Line Item cannot be empty", { reason: "no lines" }));
    const t = f.table || {};
    // classic if_C6bxfvdn: auto_si == 1 && so_total <= 0 && create_si == 'No'
    if (Number(t.auto_si) === 1 && Number(t.so_total) <= 0 && s(t.create_si) === "No") {
      return Object.assign(out, answer("ANSWER", "405", run_so405({}, P).message, { reason: "zero total" }));
    }
    // classic if_6MfJ2Oif after the save (auto SI / AR): not in V2 until SI_SAVE / AR_SAVE are measured at 2,000 lines
    // (decision D) -> classic
    if (s(t.so_status) === "Issued" && Number(t.auto_si) === 1 && (Number(t.so_total) > 0 || s(t.create_si) === "Yes")) {
      return Object.assign(out, answer("NOT_ELIGIBLE", "300", "SOV2_AUTO_SI", { reason: "this save creates the invoice" }));
    }
    // classic if_n8E7J6nA: need_cl == 'required' && so_status == 'Issued'
    out.needCl = s(t.need_cl) === "required" && s(t.so_status) === "Issued" ? "YES" : "NO";
    out.clCustomer = s(t.customer_name);
    out.clTotal = s(t.so_total) || "0";
    // classic code_node_NSa659R4, run before the credit check's answer is known: its min / max results and message do
    // not depend on it, and soSubmitCredit sets cl_result exactly as its first lines do
    const pr = run_soPrice({ code_node_rPqQy5CD: f }, P);
    const sd = pr.soData || {};
    const header = {};
    for (const k of Object.keys(sd)) if (k !== "table_so") header[k] = sd[k];
    out.approvalData = header; // CHECK_APPROVAL reads header fields only (cl_result, min / max results, so_no, sqt_id)
    out.priceMessage = s(pr.message);
    out.minResult = s(sd.min_price_result) || "passed";
    out.maxResult = s(sd.max_price_result) || "passed";
  }

  // the request as stored: the header part, then the lines in slices of top-level lines (children travel with their parent)
  const head = {};
  for (const k of Object.keys(allData)) if (k !== "table_so") head[k] = allData[k];
  const parts = [JSON.stringify(head)];
  for (let i = 0; i < lines.length; i += SO_PART_LINES) parts.push(JSON.stringify(lines.slice(i, i + SO_PART_LINES)));
  if (!out.nonce) return reject("no run nonce");
  out.partCount = parts.length;
  out.partRows = parts.map((text, i) => ({ job_id: "SOR|" + out.nonce, organization_id: out.organizationId, step_name: "R|" + ("00" + i).slice(-3), step_status: "PART",
    attempt_count: 0, result_ref: text }));
  return Object.assign(out, answer("FACTS", "", ""));
};

// Entry: STATUS / CONFIRM answers from the job; SUBMIT goes on only for a sales order nothing else holds.
const soSubmitEntry = function soSubmitEntry(guard, factRows) {
  const f = list(factRows)[0] || {};
  const job = soParse(f.the_job);
  const same = soParse(f.same_job);
  const open = list(soParse(f.open_jobs)).filter((r) => s(r.id));
  const base = { dbNow: s(f.db_now), lockN: 1, soNo: s(f.so_no) || guard.soNo, jobId: "", jobStatus: "", progressPercent: 0, progressMessage: "", errorCode: "", errorMessage: "",
    result: "", token: "", requestPayload: "", rowVersion: 0, jobSoId: "0", lockRef: "", idemKey: "", reason: "" };
  const fromJob = (j) => (j ? { jobId: s(j.id), jobStatus: s(j.job_status), progressPercent: num(j.progress_percent), progressMessage: s(j.progress_message), errorCode: s(j.error_code),
    errorMessage: s(j.error_message), result: s(j.job_status) === "COMPLETED" || s(j.job_status) === "AWAITING_CONFIRMATION" ? s(j.error_details) : "",
    token: s(j.job_status) === "AWAITING_CONFIRMATION" ? s(j.confirmation_token) : "", requestPayload: s(j.request_payload), rowVersion: num(j.row_version),
    jobSoId: (s(j.correlation_id).match(/^SO\|([0-9]+)$/) || [])[1] || "0", lockRef: s(j.lock_ref), idemKey: s(j.idempotency_key) } : {});
  if (guard.operation === "STATUS") return Object.assign(base, fromJob(job), answer("STATUS", job ? "200" : "404", job ? s(job.progress_message) : "no save job"));
  if (guard.operation === "CONFIRM") {
    if (!job) return Object.assign(base, answer("STOP", "404", "Save job not found"));
    if (s(job.job_status) !== "AWAITING_CONFIRMATION" || s(job.confirmation_token) !== guard.token) {
      return Object.assign(base, fromJob(job), answer("STOP", "409", "This save is no longer waiting for an answer."));
    }
    return Object.assign(base, fromJob(job), answer("CONFIRM", "", ""));
  }
  // SUBMIT
  if (same) return Object.assign(base, fromJob(same), answer("EXISTING", "200", "Already queued"));
  if (guard.isEdit === "YES") {
    if (!s(f.so_id)) return Object.assign(base, answer("STOP", "400", "Sales Order not found"));
    const review = open.some((r) => s(r.job_status) === "REQUIRES_REVIEW");
    if (review) return Object.assign(base, fromJob(open[0]), answer("BUSY", "409", "An earlier save of this sales order stopped half-way and is under review: please contact support."));
    if (num(f.is_processing) === 1 || open.length) return Object.assign(base, fromJob(open[0]), answer("BUSY", "409", "This sales order is being saved - please wait for it to finish."));
    if (num(f.gd_processing) > 0 || num(f.gd_create_jobs) > 0) {
      return Object.assign(base, answer("BUSY", "409", "A delivery of this sales order is being saved in the background - please wait for it to finish."));
    }
    // decision B: the cascade re-saves a live Picking Plan with its classic save, which has no V2
    if (num(f.live_pp) > 0) return Object.assign(base, answer("NOT_ELIGIBLE", "300", "SOV2_PICKING_PLAN", { reason: "a Picking Plan of this sales order is open" }));
    // classic search_node_TmnClGAM / UmwyM0pM + code_node_VNpnjpDI (Issue, Edit)
    if (guard.isIssue === "YES") {
      const nos = [s(f.draft_gd_nos), s(f.draft_si_nos)].filter((x) => x);
      if (nos.length) {
        return Object.assign(base, answer("ANSWER", "404", "The sales order has existing GD/SI records in draft status. Proceeding will delete these record: " + nos.join(", "), { reason: "drafts" }));
      }
    }
  }
  const m = s(f.last_lock).match(/^LOCK\|([0-9]+)$/);
  return Object.assign(base, answer("GO", "", ""), { lockN: m ? Number(m[1]) + 1 : 1 });
};

// After CREDIT_LIMIT_CHECK (Issue, need_cl required): block -> 402; override -> cl_result 'override' (NSa659R4's first lines).
const soSubmitCredit = function soSubmitCredit(guard, cl) {
  const data = Object.assign({}, guard.approvalData);
  const out = { route: "GO", code: "", message: "", reason: "", approvalData: data, override: "NO", clMessage: "" };
  if (guard.needCl !== "YES") return out;
  const c = cl || {};
  if (s(c.result) !== "failed") return out;
  // the lifted node reads classic's node id for the credit check's answer
  const isBlock = run_clIsBlock({ workflow_node_1IYhCFaV: c }, {}).isBlock;
  if (isBlock === "block") return Object.assign(out, answer("ANSWER", "402", s(c.message), { reason: "credit limit block" }));
  data.cl_result = "override";
  return Object.assign(out, { override: "YES", clMessage: s(c.message) });
};

// After CHECK_APPROVAL (Issue): needApproval Yes -> classic (decision A); No -> 403, then min / max 402 (classic's order).
const soSubmitDecide = function soSubmitDecide(guard, credit, approval) {
  const out = { route: "GO", code: "", message: "", reason: "" };
  if (guard.isIssue !== "YES") return out;
  const na = s((approval || {}).needApproval);
  if (na === "Yes") return Object.assign(out, answer("NOT_ELIGIBLE", "300", "SOV2_APPROVAL", { reason: "this sales order needs approval" }));
  if (na !== "No") return out; // classic if_Qbx5ornM: the price / override answers only when CHECK_APPROVAL said No
  if (s(credit.override) === "YES") return Object.assign(out, answer("ANSWER", "403", s(credit.clMessage), { reason: "credit limit override" }));
  if (guard.minResult === "failed") return Object.assign(out, answer("ANSWER", "402", guard.priceMessage, { reason: "min price" }));
  if (guard.maxResult === "failed") return Object.assign(out, answer("ANSWER", "402", guard.priceMessage, { reason: "max price" }));
  return out;
};

// Post: the queue rows. Edit: the lock (SOS|<so> / LOCK|<n>, unique: a concurrent twin fails its run) and the SO flag.
// The job is QUEUED but not due for 120 s, so no worker takes it before the read-back confirms the lock.
const soSubmitPost = function soSubmitPost(guard, entry) {
  const edit = guard.isEdit === "YES";
  const key = edit ? "SOS-" + guard.soId + "-" + entry.lockN : "SOA-" + guard.nonce;
  const request = { v: 1, nonce: guard.nonce, parts: guard.partCount, save_as: guard.saveAs, page_status: guard.pageStatus, so_id: guard.soId, so_no: entry.soNo,
    previous_status: guard.previousStatus, answers: {} };
  return {
    route: "QUEUE", idemKey: key, needLock: edit ? "YES" : "NO", needSo: edit ? "YES" : "NO",
    lockRows: edit ? [{ job_id: "SOS|" + guard.soId, organization_id: guard.organizationId, step_name: "LOCK|" + entry.lockN, step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow, result_ref: key }] : [],
    jobRows: [{ organization_id: guard.organizationId, plant_id: guard.plantId, command: "SAVE_SO", idempotency_key: key, payload_hash: guard.payloadHash, job_status: "QUEUED",
      progress_percent: 0, progress_message: "Queued for saving", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: dbAddSeconds(entry.dbNow, 120),
      request_payload: JSON.stringify(request), causation_id: "SO_FORM", correlation_id: edit ? "SO|" + guard.soId : "SOA|" + guard.nonce,
      source_so_ids: JSON.stringify(edit ? [guard.soId] : []), source_so_no: entry.soNo, line_count: guard.lineCount, queued_at: entry.dbNow }],
    soRows: edit ? [{ id: guard.soId, is_processing: 1 }] : [],
  };
};

// Due: the read-back. Ours (QUEUED; an edit: the SO flagged under our lock) and no GD job slipped in -> due now. A GD job that
// slipped in between the facts and the flag wins: this job CANCELLED, the flag back to 0.
const soSubmitDue = function soSubmitDue(guard, entry, post, back) {
  const b = list(back)[0] || {};
  const edit = guard.isEdit === "YES";
  const mine = !!s(b.job_id) && s(b.job_status) === "QUEUED" && (!edit || (num(b.is_processing) === 1 && s(b.lock_ref) === post.idemKey));
  const out = { route: mine ? "DUE" : "LOST", jobId: s(b.job_id), dueRows: [], needDue: "NO", undoRows: [], needUndo: "NO", unlockRows: [], needUnlock: "NO" };
  if (mine && edit && num(b.racers) > 0) {
    return Object.assign(out, { route: "RACE", needUndo: "YES", needUnlock: "YES", unlockRows: [{ id: guard.soId, is_processing: 0 }],
      undoRows: [{ id: s(b.job_id), job_status: "CANCELLED", progress_message: "Not saved: a delivery of this sales order started first", error_code: "SOV2_BUSY",
        error_message: "a delivery save of the sales order started just before this save", finished_at: entry.dbNow }] });
  }
  if (mine) Object.assign(out, { needDue: "YES", dueRows: [{ id: s(b.job_id), next_attempt_at: entry.dbNow }] });
  return out;
};

// Confirm: the answer to a 413 / 414 question. PROCEED -> the job QUEUED again with the answers (PREPARE runs again);
// CANCEL -> the job CANCELLED and the SO unlocked (nothing was written: questions come before any hold or write).
// Both rows carry every column the update writes (a row missing a mapped column is unproven on the engine).
const soSubmitConfirm = function soSubmitConfirm(guard, entry) {
  const rp = soParse(entry.requestPayload) || {};
  const a = guard.answers || {};
  const out = { route: "CONFIRMED", code: "200", message: "", jobRows: [], needJob: "YES", unlockRows: [], needUnlock: "NO", jobStatus: "" };
  const row = (o) => Object.assign({ id: entry.jobId, confirmation_token: "", request_payload: entry.requestPayload, error_code: "", error_message: "", row_version: entry.rowVersion + 1,
    next_attempt_at: entry.dbNow, finished_at: null }, o);
  if (a.decision === "CANCEL") {
    const unlock = entry.jobSoId !== "0" && entry.lockRef === entry.idemKey;
    return Object.assign(out, { message: "Save cancelled", jobStatus: "CANCELLED", needUnlock: unlock ? "YES" : "NO", unlockRows: unlock ? [{ id: entry.jobSoId, is_processing: 0 }] : [],
      jobRows: [row({ job_status: "CANCELLED", progress_message: "Not saved: cancelled at the question", error_code: "SOV2_CANCELLED", error_message: "the user cancelled at the question",
        finished_at: entry.dbNow })] });
  }
  const answers = Object.assign({}, rp.answers || {});
  if (a.raiseGdQty) answers.raiseGdQty = a.raiseGdQty;
  if (a.confirmPickReversal) answers.confirmPickReversal = a.confirmPickReversal;
  rp.answers = answers;
  return Object.assign(out, { message: "Answer received - saving", jobStatus: "QUEUED",
    jobRows: [row({ job_status: "QUEUED", request_payload: JSON.stringify(rp), progress_message: "Answer received - saving" })] });
};

// Result: the answer of whichever node ended the run (src), with the job's facts.
const soSubmitResult = function soSubmitResult(guard, entry, src, due) {
  const e = entry || {};
  const r = src || {};
  const out = { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(e.jobId), job_status: s(e.jobStatus || r.jobStatus), so_id: s(guard.soId),
    so_no: s(e.soNo || guard.soNo), line_count: String(num(guard.lineCount)), progress_percent: String(num(e.progressPercent)), progress_message: s(e.progressMessage),
    error_code: s(e.errorCode), error_message: s(e.errorMessage), result: s(e.result), confirmation_token: s(e.token), evidence: "" };
  if (out.route === "EXISTING") Object.assign(out, { route: "QUEUED", code: "200", message: "Already queued" });
  if (due) {
    const d = due || {};
    if (d.route === "DUE") Object.assign(out, { route: "QUEUED", code: "200", message: "Queued for saving", job_id: s(d.jobId), job_status: "QUEUED", progress_percent: "0", progress_message: "Queued for saving" });
    else if (d.route === "RACE") Object.assign(out, { route: "BUSY", code: "409", message: "A delivery of this sales order started saving just now - please wait for it to finish, then save again.", job_id: s(d.jobId), job_status: "CANCELLED" });
    else Object.assign(out, { route: "STOP", code: "500", message: "The save could not be queued: please try again.", job_id: s(d.jobId) });
  }
  out.evidence = JSON.stringify({ v: 1, workflow: "SO_SAVE_SUBMIT", operation: s(guard.operation), route: out.route, code: out.code, reason: out.reason, lines: num(guard.lineCount) });
  return out;
};

// ---- this node
const res = soSubmitEntry([{{node:code_node_SSguard.data}}][0], [{{node:sql_node_SSfacts.data}}][0]);
console.log("so submit entry", JSON.stringify({ route: res.route, code: res.code, message: res.message, lock: res.lockN }));
return res;