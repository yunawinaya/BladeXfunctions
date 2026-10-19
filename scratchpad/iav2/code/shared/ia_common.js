// IA V2 shared helpers (CONTRACT.md section 6): every name ia / IA_-prefixed so it concatenates with a step's own helpers
const iaS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const iaQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// a decimal column as the fixed-scale STRING the multipleOf check accepts
const iaQtyStr = (v) => Math.max(0, iaQ8(v)).toFixed(8);
const iaDigits = (v) => /^[0-9]{1,20}$/.test(iaS(v));
const iaIdStr = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "";
  const t = iaS(v);
  return /^[0-9]{1,20}$/.test(t) ? t : "";
};
// 16+ digit integer tokens stay strings (never a float's fraction digits)
const iaParseJ = (t) => {
  if (t === undefined || t === null) return null;
  if (typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
const iaList = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
const iaJsonList = (v) => {
  if (Array.isArray(v)) return v;
  const t = iaS(v);
  if (!t) return [];
  const p = iaParseJ(t);
  return Array.isArray(p) ? p : [];
};
const iaRows = (rows) => iaList(rows).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? iaParseJ(r.j) : r)).filter((r) => r && typeof r === "object");
const iaIdsSql = (vals) => ["0"].concat((Array.isArray(vals) ? vals : Object.keys(vals || {})).map(iaIdStr).filter((x) => x)).filter((x, i, a) => a.indexOf(x) === i).join(",");
// code_issue_pick: pick.category || 'Unrestricted'
const iaCategory = (c) => iaS(c) || "Unrestricted";
// code_issue_line's filter: sm_quantity > 0, array order; unparseable = none
const iaPicks = (line) => iaJsonList(line && line.temp_qty_data).filter((p) => p && typeof p === "object" && (parseFloat(p.sm_quantity) || 0) > 0);
const iaPickCount = (lines) => iaList(lines).reduce((n, l) => n + iaPicks(l).length, 0);
const iaLineHasHu = (line) => iaJsonList(line && line.temp_qty_data).some((p) => p && typeof p === "object" && iaS(p.handling_unit_id) !== "")
  || iaJsonList(line && line.temp_hu_data).length > 0;
const iaDbAddSeconds = function iaDbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const iaDbSeconds = function iaDbSeconds(a, b) {
  const t = (x) => {
    const m = String(x || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : NaN;
  };
  return (t(b) - t(a)) / 1000;
};
const IA_PREV_STATUSES = ["Draft"];
const iaPrevStatusOk = (v) => IA_PREV_STATUSES.indexOf(iaS(v)) >= 0;
const IA_V2_MIN_PICKS = 50;
// the user's cap (2026-10-19): classic IA_SAVE Completed picks and classic IA_REVERT live rows
const IA_CLASSIC_MAX_PICKS = 250;
const IA_MAX_PICKS = 5000;
const IA_PARK_PICKS = 1000;
const IA_LOCK_WAIT_TRIES = 8;
const IA_RECEIPT_WAIT_S = 1800;
const IA_RECEIPT_RETRY_S = 10;
const IA_OK_CATEGORIES = ["Unrestricted", "Blocked"];
// one open job per IA, completion or revert (shared IA|<id> correlation and IAC|<id> lock)
const IA_COMMANDS = ["COMPLETE_IA", "REVERT_IA"];
const IA_OPEN_JOB = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA", "COMMITTING_REVERT", "REQUIRES_REVIEW"];
const IA_RUNNING_JOB = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA", "COMMITTING_REVERT"];
const IA_TERMINAL_JOB = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED", "NONE"];
const IA_FINAL = ["Completed", "Fully Posted"];
const IA_KEY_RE = /^[A-Za-z0-9|:_.-]{8,128}$/;
const iaLockJob = (iaId) => "IAC|" + iaS(iaId);
const iaCorrelation = (iaId) => "IA|" + iaS(iaId);
const iaOpKey = (jobId, side) => "IAC|" + iaS(jobId) + "|" + (side === "R" ? "R" : "I");
const IA_RV_PREV_STATUSES = ["Completed"];
const iaRvPrevStatusOk = (v) => IA_RV_PREV_STATUSES.indexOf(iaS(v)) >= 0;
const IA_RV_MIN_ROWS = 50;
const iaRvOpKey = (jobId) => "IAV|" + iaS(jobId);
const iaRvCostOwner = (jobId) => "IAV|" + iaS(jobId) + "|C";
const IA_CHUNK = 400000;
const iaPartRows = function iaPartRows(jobId, organizationId, prefix, value, status) {
  const text = JSON.stringify(value);
  const out = [];
  for (let at = 0, n = 1; at < text.length || n === 1; at += IA_CHUNK, n++) {
    out.push({ job_id: iaS(jobId), organization_id: iaS(organizationId), step_name: prefix + String(n).padStart(3, "0"), step_status: status || "PAYLOAD", attempt_count: 0,
      result_ref: text.slice(at, at + IA_CHUNK) });
  }
  return out;
};
// null = no row, undefined = the joined text does not parse
const iaJoinChunks = function iaJoinChunks(rows, prefix) {
  const mine = iaList(rows).filter((r) => iaS(r.step_name).indexOf(prefix) === 0).sort((a, b) => (iaS(a.step_name) < iaS(b.step_name) ? -1 : 1));
  if (!mine.length) return null;
  const p = iaParseJ(mine.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
  return p === null ? undefined : p;
};
// tpl/smv2 commit/_cmp.js sameVal / sameStored, bound to iaQ8
const iaSameVal = function iaSameVal(a, b) {
  const ea = a === undefined || a === null || a === "";
  const eb = b === undefined || b === null || b === "";
  if (ea || eb) return ea && eb;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  const t = (v) => (/^-?[0-9]+\.[0-9]+$/.test(String(v)) ? String(v).replace(/0+$/, "").replace(/\.$/, "") : String(v));
  const ta = t(a);
  const tb = t(b);
  if (ta === tb) return true;
  const na = typeof a === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(ta);
  const nb = typeof b === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(tb);
  if (na && nb && !/^-?[0-9]{16,}$/.test(ta) && !/^-?[0-9]{16,}$/.test(tb)) return Math.abs(iaQ8(a) - iaQ8(b)) < 1e-8;
  return false;
};
const iaSameStored = function iaSameStored(computed, stored) {
  if (iaSameVal(computed, stored)) return true;
  if (typeof computed === "object" || computed === "" || computed === null || computed === undefined || stored === "" || stored === null || stored === undefined) return false;
  const a = Number(computed);
  const b = Number(stored);
  if (!isFinite(a) || !isFinite(b)) return false;
  for (let d = 0; d < 8; d++) {
    const f = Math.pow(10, d);
    const x = Number((a * f).toFixed(6));
    for (const c of [Math.sign(x) * Math.round(Math.abs(x)), Math.trunc(x), Math.sign(x) * Math.ceil(Math.abs(x))]) if (Math.abs(c / f - b) < 1e-9) return true;
  }
  return false;
};
const IA_TEXT = {
  busy: "This Item Assembly is being processed in the background - please wait for it to finish.",
  underReview: "Its last completion stopped half-way and is under review: please contact support.",
  stale: (status) => "This Item Assembly was changed by someone else (it is now " + (iaS(status) || "without a status") + "). Please close it and open it again.",
  alreadyFinal: (status) => "This Item Assembly is already " + iaS(status) + ".",
  classicFinal: (status) => "This Item Assembly is already " + iaS(status) + " and cannot be saved again.",
  classicTooBig: (n, cap) => "This Item Assembly has " + n + " stock picks; this save can process at most " + cap + " at once. Split it into smaller assemblies, or complete it from the web form if background completion is switched on.",
  tooBig: (n, reason, cap) => "This Item Assembly has " + n + " stock picks and cannot be completed in the background (" + iaS(reason) + "); the classic save handles at most " + cap + " picks.",
  splitRequired: (n) => "This Item Assembly has " + n + " stock picks. At most 5,000 can be issued at once - please split the assembly.",
  queueFailed: "The completion could not be queued: please try again.",
  notLocked: "The Item Assembly is no longer locked by this completion: nothing was moved.",
  linesChanged: "The Item Assembly's lines changed while it was waiting: nothing was moved, please complete it again.",
  lockBusy: "The stock of its components stayed locked by another operation: nothing was moved, please try again later.",
  review: "Under review: the completion stopped half-way. Please contact support.",
  prevUnknown: "Under review: the status to restore is unknown. Please contact support.",
  batchDuplicate: "Duplicate Batch Format found.",
  postLater: "Still completing in the background; post it from the list once it shows Completed.",
  rvConflicts: "Revert blocked: the assembled item has been used or its stock has moved on.",
  rvDone: "Item Assembly reverted to Draft successfully.",
  rvClassicTooBig: (n, cap) => "This Item Assembly has " + n + " stock rows; this revert can process at most " + cap + " at once. Revert it from the Item Assembly list if background revert is switched on, or contact support.",
  rvTooBig: (n, reason, cap) => "This Item Assembly has " + n + " stock movements to take back and cannot be reverted in the background (" + iaS(reason) + "); the classic revert handles at most " + cap + ".",
  rvSplitRequired: (n) => "This Item Assembly has " + n + " stock movements to take back. At most 5,000 can be reverted at once.",
  // the revert's own wording of the completion texts above (CONTRACT ruling 9)
  rvNotLocked: "The Item Assembly is no longer locked by this revert: nothing was reverted.",
  rvReview: "Under review: the revert stopped half-way. Please contact support.",
  rvUnderReview: "Its last revert stopped half-way and is under review: please contact support.",
  rvQueueFailed: "The revert could not be queued: please try again.",
  rvNotReverted: "Temporary failures persisted; not reverted.",
  rvNoJob: "no background revert",
};
if (typeof module !== "undefined") module.exports = { iaS, iaQ8, iaQtyStr, iaDigits, iaIdStr, iaParseJ, iaList, iaJsonList, iaRows, iaIdsSql, iaCategory, iaPicks, iaPickCount, iaLineHasHu, iaDbAddSeconds, iaDbSeconds, IA_PREV_STATUSES, iaPrevStatusOk, IA_V2_MIN_PICKS, IA_CLASSIC_MAX_PICKS, IA_MAX_PICKS, IA_PARK_PICKS, IA_LOCK_WAIT_TRIES, IA_RECEIPT_WAIT_S, IA_RECEIPT_RETRY_S, IA_OK_CATEGORIES, IA_OPEN_JOB, IA_RUNNING_JOB, IA_TERMINAL_JOB, IA_FINAL, IA_KEY_RE, iaLockJob, iaCorrelation, iaOpKey, IA_COMMANDS, IA_RV_PREV_STATUSES, iaRvPrevStatusOk, IA_RV_MIN_ROWS, iaRvOpKey, iaRvCostOwner, IA_CHUNK, iaPartRows, iaJoinChunks, iaSameVal, iaSameStored, IA_TEXT };
