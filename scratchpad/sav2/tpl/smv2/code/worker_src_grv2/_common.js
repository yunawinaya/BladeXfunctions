const PKC = {
  retry: { max_retries: 3, base_delay_ms: 2000, max_delay_ms: 30000 },
  worker_budget_seconds: 20,
  states: ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GR"],
  hard: ["GRC_INVALID_REQUEST", "GRC_INVALID_DATA", "GRC_GR_NOT_FOUND", "GRC_NOT_LOCKED", "GRC_NOT_ELIGIBLE", "GRC_400", "GRC_401", "GRC_LINES_CHANGED", "GRC_STALE", "GRC_PO_CHANGED", "GRC_ENGINE_REFUSED", "JOB_ILLEGAL_TRANSITION"],
};
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
