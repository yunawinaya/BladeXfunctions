const PKC = {
  retry: { max_retries: 3, base_delay_ms: 2000, max_delay_ms: 30000 },
  worker_budget_seconds: 20,
  states: ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD"],
  hard: ["GDR_INVALID_REQUEST", "GDR_INVALID_DATA", "GDR_GD_NOT_FOUND", "GDR_NOT_LOCKED", "GDR_NOT_ELIGIBLE", "GDR_NOT_YET_SUPPORTED", "GDR_400", "GDR_401", "GDR_412", "GDR_UNEXPECTED_PATCH", "GDR_RES_BLANK", "GDR_LINES_CHANGED", "GDR_STALE", "GDR_BUSY", "GDR_TOO_LARGE", "GDR_RES_CONFLICT", "GDR_NOT_COMPLETED", "GDR_NO_SNAPSHOT", "GDR_CONFLICT", "JOB_ILLEGAL_TRANSITION"],
};
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
