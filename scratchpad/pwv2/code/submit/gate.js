// PUTAWAY_ASYNC_SUBMIT - Gate: pwGates (the plan core): Completed / Cancelled, the classic lock (900 s, LockDecide's text),
// the receipt Processing, the request contract, what the background completion does not take (-> the classic save, or STOP
// above its 500-row guard), then PUTAWAY_LOOP's and PUTAWAY's gates (lifted) against the STORED pending quantities
const submitGate = function submitGate(guard, entry, S) {
  const out = pwGates({ request: guard.request, S: S, tenantId: guard.tenantId, confirmedBy: guard.confirmedBy });
  const route = s(out.route);
  if (route === "GO") return answer("GO", "", "", { rowCount: num(out.rowCount), lineCount: num(out.lineCount) });
  if (route === "NOT_ELIGIBLE") {
    const n = num(out.rowCount) || (guard.request.lines || []).length;
    return n > MAX_OLD_PATH_ROWS
      ? answer("STOP", "400", "This confirmation has " + n + " rows and cannot be completed in the background (" + s(out.message) + "); the classic confirmation handles at most " + MAX_OLD_PATH_ROWS + " rows.", { rowCount: n, lineCount: num(out.lineCount) })
      : answer("NOT_ELIGIBLE", "300", s(out.message), { reason: s(out.message), rowCount: n, lineCount: num(out.lineCount) });
  }
  return answer("STOP", s(out.code) || "400", s(out.message), { rowCount: num(out.rowCount), lineCount: num(out.lineCount) });
};
