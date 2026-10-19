// SA_V2_SUBMIT - shared helpers (with code/shared/sa_common.js included before this file). Copy of tpl/smv2 code/submit/_common.js,
// de-LOT-ed: COMPLETE_SA states, SA| / SAC| / SCR|, entries (balance_index rows with sa_quantity > 0) instead of LOT lines
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const OPEN_JOB = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA", "REQUIRES_REVIEW"];
// NONE: STATUS found no job (the form stops polling)
const TERMINAL_JOB = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED", "NONE"];
// stored statuses a FORM submit can no longer complete (STALE: already final)
const SA_FINAL = ["Completed", "Pending Post", "Fully Posted", "Cancelled"];
// entry categories the background save moves (CONTRACT §7); "" = Unrestricted (code_node_GmKmvMGe's default)
const SA_OK_CATEGORIES = ["", "Unrestricted", "Blocked", "Quality Inspection"];
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
const parseJson = (t) => (t && typeof t === "object" ? t : saParseJ(t));
// an id as a digit string ("" when it is not one); a digit-only SQL list, "0" first (= none)
const saIdOf = (v) => saIdStr(v) || (digits(v) ? s(v) : "");
const saIdsSql = (vals) => ["0"].concat(Object.keys(vals)).join(",");
// NOT_ELIGIBLE goes to the classic save / Review, which refuse more than 500 entries (SA) / approved variance lines (review):
// above that it is a STOP here (SA_TOO_BIG)
const notEligible = (reason, count, review) =>
  count > SA_CLASSIC_MAX_ENTRIES
    ? answer("STOP", "400", review
      ? "This review has " + count + " approved lines with a variance and cannot run in the background (" + reason + "); the classic Review handles at most "
        + SA_CLASSIC_MAX_ENTRIES + " lines at a time."
      : "This Stock Adjustment has " + count + " entries and cannot be completed in the background (" + reason + "); the classic save handles at most "
        + SA_CLASSIC_MAX_ENTRIES + " entries.", { reason: reason, errorCode: "SA_TOO_BIG" })
    : answer("NOT_ELIGIBLE", "300", reason, { reason: reason, errorCode: "SA_NOT_ELIGIBLE" });
const splitRequired = (count, review) => answer("STOP", "400", review
  ? "This review would adjust " + count + " stock entries. At most 5,000 can be adjusted at once - review it in batches."
  : "This Stock Adjustment has " + count + " stock entries. At most 5,000 can be adjusted at once - please split it.",
{ reason: "split", errorCode: "SA_SPLIT_REQUIRED" });
// a line's balance_index entries that move stock: the classic loop's own filter (code_node_qrsgEz2F: sa_quantity > 0); a
// balance_index that does not parse moves nothing (the classic guard counts it as 0)
const saMoving = (line) => saJsonList(line && line.balance_index).filter((e) => e && typeof e === "object" && Number(e.sa_quantity) > 0);
const saEntryCount = (lines) => list(lines).reduce((n, l) => n + saMoving(l).length, 0);
// the read-back of a queued save: the SA Processing under this job, its latest SAC lock this key, the job QUEUED and linked
// (SA|<id>), every S part there
const saQueuedOk = (guard, post, b) => digits(b.job_id) && s(b.stock_adjustment_status) === "Processing" && s(b.sa_v2_job_id) === s(b.job_id)
  && s(b.lock_ref) === guard.key && s(b.job_status) === "QUEUED" && /^SA\|[0-9]{1,20}$/.test(s(b.correlation_id)) && num(b.parts) === num(post.partCount);
