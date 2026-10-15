// GR_COMPLETE_SUBMIT - shared helpers
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// the classic Save as Completed refuses more than this (Phase 0 guard)
const MAX_OLD_PATH_LINES = 500;
// what one background completion takes (INVENTORY_BULK_APPLY: at most 5,000 movements)
const MAX_V2_LINES = 2500;
const OPEN_JOB = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GR", "REQUIRES_REVIEW"];
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
// what the background completion does not handle goes to the classic save, unless the receipt is too big for it
const notEligible = (reason, lineCount) =>
  lineCount > MAX_OLD_PATH_LINES
    ? answer("STOP", "400", "This Goods Receiving has " + lineCount + " lines and cannot be completed in the background (" + reason + "); the classic completion handles at most "
      + MAX_OLD_PATH_LINES + " lines.", { reason: reason })
    : answer("NOT_ELIGIBLE", "300", reason, { reason: reason });
const flatRows = (rows) => (Array.isArray(rows) ? rows : []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const parseJ = function parseJ(t) {
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
};
