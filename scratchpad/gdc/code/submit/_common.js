// GD_COMPLETE_SUBMIT - shared helpers
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
// the classic Save as Completed is refused above this size: at 2,000 lines it took dev down
const MAX_OLD_PATH_LINES = 500;
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
// what the background completion does not handle goes to the classic save, unless the delivery is too big for it
const notEligible = (reason, lineCount, unsaved) =>
  lineCount > MAX_OLD_PATH_LINES
    ? answer("STOP", "400", unsaved
        ? "This delivery has " + lineCount + " lines and " + reason.replace(/^it has /, "") + ". Save it as Created first, then complete it."
        : "This delivery has " + lineCount + " lines and cannot be completed in the background (" + reason + "); the classic completion handles at most " + MAX_OLD_PATH_LINES + " lines.",
      { reason: reason })
    : answer("NOT_ELIGIBLE", "300", reason, { reason: reason });
