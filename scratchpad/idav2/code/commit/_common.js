// IDA_V2_COMMIT - helpers every step node includes after code/shared/ida_common.js: tpl/iav2 commit/_common.js with the IDA's unlock
// (Draft only, while the job owns the IDA), this job's Batch rows ("ours") soft-deleted in slices on a clean failure, GD's lockWait,
// grv2's stepWait (not counted) and the multi-row "ours" map of D1 / D3 / every phase-A exit (CONTRACT.md section 9)
const MAX_RETRIES = 3;
const SLICE = 250;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
// distinct values in order / a membership map (object lookups: these lists reach 5,000 ids)
const uniq = (vals) => {
  const seen = {};
  const out = [];
  for (const v of vals) if (!seen[v]) { seen[v] = true; out.push(v); }
  return out;
};
const setOf = (vals) => {
  const o = {};
  for (const v of vals) o[v] = true;
  return o;
};
// the DB clock now: the entry's db_now (read at the START of this pass) + the JS time since the entry ran
const endNow = (entry) => (Number(entry.jsAt) > 0 ? idaDbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const MSG = {
  invalid: "The Item Disassembly could not be completed: its prepared data is missing. Nothing was moved, please try again.",
  planFailed: "The completion could not be prepared: the receipt check did not answer. Nothing was moved, please try again.",
};
const P75 = "Source issued; receiving the recovered components";
const P80 = "Components received; finishing";
// the receipts op 2 skipped with "401" (stock_control 0 after both PLANs): tolerated as the classic ADD does; named in D3's ref and the job
const skipNoteOf = function skipNoteOf(keys, count) {
  const k = list(keys).map(s).filter((x) => x);
  const n = Math.max(num(count), k.length);
  if (!n) return "";
  return " (" + n + " receipt" + (n === 1 ? "" : "s") + " skipped, stock control 0: " + k.slice(0, 20).join(", ") + (n > 20 ? ", ..." : "") + ")";
};
// this pass's note, else an earlier pass's (the entry's), as " (...)"
const noteText = (a, b) => (s(a) ? " " + s(a) : s(b) ? " " + s(b) : "");
const slicesOf = function slicesOf(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push({ n: out.length + 1, rows: rows.slice(i, i + size) });
  return out;
};
const doneRow = function doneRow(entry, step, ref) {
  const row = { job_id: entry.jobId, organization_id: entry.organizationId, step_name: step, step_status: "DONE", attempt_count: 1, started_at: entry.dbNow,
    finished_at: endNow(entry), inventory_operation_id: "", result_ref: s(ref).slice(0, 2000), error_code: null, error_message: null };
  return row;
};
// the job row this pass writes; the progress defaults to this pass's (phase A 70, phase B 75 before D3 is DONE, 85 after)
const jobRow = function jobRow(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_IDA", progress_percent: num(entry.progress) || 70, progress_message: s(entry.progressMessage) || "Completing the Item Disassembly",
    attempt_count: num(entry.attempts), next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: num(entry.rowVersion) + 2, error_code: null, error_message: null,
    error_details: null, finished_at: null }, patch);
};
const END_EMPTY = { stepRows: [], needStep: "NO", unlockRows: [], needUnlock: "NO", batchDelSlices: [], needBatchDel: "NO", needOursRead: "NO" };
// REQUIRES_REVIEW: the Item Disassembly stays Processing, nothing else is written
const reviewEnd = function reviewEnd(entry, step, code, why, extra) {
  const msg = step + ": " + why + "; the Item Disassembly stays Processing for review";
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the completion stopped half-way",
    error_code: code, error_message: IDA_TEXT.review, error_details: JSON.stringify(Object.assign({ step: step, why: s(why).slice(0, 4000) }, extra || {})), finished_at: endNow(entry) })],
  needJobUpd: "YES", result_code: code, result_message: msg, job_status: "REQUIRES_REVIEW" });
};
// a step that did not complete: retry with backoff (2 s x 2^n, max 30 s), REQUIRES_REVIEW after MAX_RETRIES or at once when `review`
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = num(entry.attempts);
  if (review || n >= MAX_RETRIES) return reviewEnd(entry, step, "IDA_RECONCILIATION_MISMATCH", why + (review ? "" : " (after " + n + " retries)"));
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: idaDbAddSeconds(endNow(entry), Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)),
    error_code: "IDA_STEP_RETRY", error_message: (step + ": " + why).slice(0, 1000), error_details: JSON.stringify({ step: step, why: s(why).slice(0, 4000), attempt: n + 1 }) })], needJobUpd: "YES",
  result_code: "IDA_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_IDA" });
};
// a wait that is not a failure (op 2 locked out by another operation): due again in `seconds`, attempt_count unchanged
const stepWait = function stepWait(entry, step, why, seconds, extra) {
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { next_attempt_at: idaDbAddSeconds(endNow(entry), seconds), error_code: "IDA_WAIT", error_message: (step + ": " + why).slice(0, 1000),
    error_details: JSON.stringify(Object.assign({ step: step, why: s(why).slice(0, 4000) }, extra || {})) })], needJobUpd: "YES", result_code: "IDA_WAIT", result_message: step + ": " + why + " - waiting " + seconds + " s",
  job_status: "COMMITTING_IDA" });
};
// op 1 answered 409 with no intent row: nothing was written - wait for the other operation (15 s x 2^n, at most 5 min), counted
const lockWait = function lockWait(entry, why) {
  const n = num(entry.attempts);
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: idaDbAddSeconds(endNow(entry), Math.min(300, 15 * Math.pow(2, n))), error_code: "IDA_LOCK_WAIT",
    error_message: ("D2_ISSUE: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "D2_ISSUE", why: s(why).slice(0, 2000), attempt: n + 1 }) })], needJobUpd: "YES", result_code: "IDA_LOCK_WAIT",
  result_message: "D2_ISSUE: the stock of the item being disassembled is locked by another operation - wait " + (n + 1) + " of " + IDA_LOCK_WAIT_TRIES, job_status: "COMMITTING_IDA" });
};
// before op 1 moved stock (phase A): FAILED, the IDA back to Draft while this job owns it, this job's own Batch rows (`ours` ids)
// soft-deleted in slices of 250 (the exit writes unlock -> Batch rows -> job). An owned IDA whose prevStatus is not Draft ->
// REQUIRES_REVIEW IDA_PREV_STATUS_UNKNOWN, nothing else written. Either engine operation already has rows -> REQUIRES_REVIEW
// IDA_RECONCILIATION_MISMATCH (error_details.wouldFail = the code), no unlock, no soft-delete (IA ruling 10 R2, extended to op 2)
const failNoWrite = function failNoWrite(entry, code, message, why, ours) {
  if (entry.opWrote === "YES") {
    const side = entry.op1Wrote === "YES" ? "I" : "R";
    return reviewEnd(entry, side === "I" ? "D2_ISSUE" : "D3_RECEIPT", "IDA_RECONCILIATION_MISMATCH", "op " + (side === "I" ? "1" : "2") + " (" + idaOpKey(entry.jobId, side) + ") already has engine rows, so " + code
      + " (" + s(why || message) + ") cannot be written as a clean failure: no unlock, no Batch row removed", { wouldFail: code });
  }
  const owned = entry.unlockOk === "YES";
  const detail = JSON.stringify({ step: "IDA_V2_COMMIT", why: s(why || message).slice(0, 4000) });
  if (owned && !idaPrevStatusOk(entry.prevStatus)) {
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: IDA_TEXT.prevUnknown, error_code: "IDA_PREV_STATUS_UNKNOWN",
      error_message: IDA_TEXT.prevUnknown, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "IDA_PREV_STATUS_UNKNOWN",
    result_message: s(why || message) + " (prevStatus '" + s(entry.prevStatus) + "' unknown: no unlock)", job_status: "REQUIRES_REVIEW" });
  }
  const unlock = owned ? [{ id: entry.idaId, item_disassembly_status: s(entry.prevStatus) }] : [];
  const del = uniq(list(ours).map(s).filter(digits)).map((x) => ({ id: x, is_deleted: 1 }));
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not completed: " + message).slice(0, 250), error_code: code,
    error_message: message, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", batchDelSlices: slicesOf(del, SLICE),
  needBatchDel: del.length ? "YES" : "NO", result_code: code, result_message: s(why || message), job_status: "FAILED" });
};
const stepOk = function stepOk(entry, step, ref, message) {
  return Object.assign({ route: "OK" }, END_EMPTY, { stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", result_code: "", result_message: message || step + " done",
    job_status: "COMMITTING_IDA" });
};
// an engine answer's text: the platform's error envelope carries it in msg, not message
const engineWhy = function engineWhy(what, ans) {
  const code = s(ans.code);
  return what + " answered " + (code || "nothing") + (s(ans.result_code) ? " " + s(ans.result_code) : "") + (s(ans.message) ? ": " + s(ans.message) : "");
};
// ------------------------------------------------------------------ the BATCH part and "ours"
// a planned row's number: TYPED = its stored text (untrimmed, as the classic ADD writes it); AUTO = the D1 intent's (or draft's)
const plannedNumber = (row, numbers) => (s(row.kind) === "AUTO" ? s((numbers || {})[s(row.key)]) : row.batch_number === undefined || row.batch_number === null ? "" : String(row.batch_number));
const identityOf = (number, material, plant) => idaBatchKey(number) + "|" + s(material) + "|" + s(plant);
const byIdOrder = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
// "ours" (CONTRACT.md section 9): the rows with id > job and this IDA's number whose identity (idaBatchKey(number), material, plant) is a
// planned row's with insert true; the k planned rows of one identity own its k lowest matching ids, in row order. byKey = row key -> id,
// all = every matching id, extra = matches past k (inserted twice), missing = planned keys without one (never inserted / not read back)
const oursMap = function oursMap(planRows, numbers, rows, jobId, idaNo) {
  const groups = {};
  for (const r of list(planRows)) {
    if (r.insert === false) continue;
    const n = plannedNumber(r, numbers);
    if (s(n) === "") continue;
    const k = identityOf(n, r.material_id, r.plant_id);
    (groups[k] = groups[k] || []).push(s(r.key));
  }
  const hits = {};
  for (const o of idaRows(rows)) {
    const k = identityOf(o.batch_number, o.material_id, o.plant_id);
    if (!groups[k] || !idaIdAfter(o.id, jobId) || s(o.transaction_no) !== s(idaNo)) continue;
    if ((hits[k] = hits[k] || []).indexOf(s(o.id)) < 0) hits[k].push(s(o.id));
  }
  const out = { byKey: {}, all: [], extra: [], missing: [] };
  for (const k of Object.keys(groups)) {
    const ids = (hits[k] || []).slice().sort(byIdOrder);
    ids.forEach((id, i) => {
      out.all.push(id);
      if (i < groups[k].length) out.byKey[groups[k][i]] = id;
      else out.extra.push(id);
    });
    for (let i = ids.length; i < groups[k].length; i++) out.missing.push(groups[k][i]);
  }
  out.all.sort(byIdOrder);
  return out;
};
// the planned number a holder row holds (its idaBatchKey), else its own text: a utf8mb4_general_ci match JS keys do not see
const heldNumber = function heldNumber(planRows, numbers, holder) {
  const k = idaBatchKey(holder.batch_number);
  for (const r of list(planRows)) {
    const n = plannedNumber(r, numbers);
    if (s(n) !== "" && idaBatchKey(n) === k) return { number: n, row: r };
  }
  return { number: s(holder.batch_number), row: null };
};
