const PKC = {
  retry: { max_retries: 3, base_delay_ms: 2000, max_delay_ms: 30000 },
  worker_budget_seconds: 240,
  states: ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD"],
  hard: ["GDC_INVALID_REQUEST", "GDC_INVALID_DATA", "GDC_GD_NOT_FOUND", "GDC_NOT_LOCKED", "GDC_NOT_ELIGIBLE", "GDC_NOT_YET_SUPPORTED", "GDC_400", "GDC_401", "GDC_412", "GDC_UNEXPECTED_PATCH", "GDC_RES_BLANK", "GDC_LINES_CHANGED", "GDC_STALE", "JOB_ILLEGAL_TRANSITION"],
};
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
