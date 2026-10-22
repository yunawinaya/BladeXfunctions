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

// ---- SO_SAVE_RUN
// SO_SAVE_RUN - several SO_SAVE_WORKER runs in one call (docs/lowcode/so-save-v2/PLAN.md, "SO_SAVE_RUN"): the form's
// follow loop, server-side, so a small save ends in one or two calls from the form instead of one per stage. Each stage
// is still a whole worker run with its own claim, lease and release (the worker's resume guarantees are unchanged); this
// workflow only decides whether to start the next one.

const SO_RUN_MAX_CALLS = 6;
// no new worker run is started after this long (the call answers well inside the gateway's timeout; the form calls again)
const SO_RUN_BUDGET_MS = 8000;

const soRunStart = function soRunStart(inp) {
  return { jobId: digits(inp.jobId) ? s(inp.jobId) : "0", t0: String(num(inp.now)) };
};

// After worker run i: start run i + 1 only while the job moves on (MORE), under the call limit and the time budget.
// WAIT (another run's lease, not due), DONE, STOP and REJECT go back to the form as they are.
const soRunNext = function soRunNext(start, res, i, now) {
  const r = res || {};
  const go = s(r.route) === "MORE" && i < SO_RUN_MAX_CALLS && num(now) - num(start.t0) < SO_RUN_BUDGET_MS;
  return { go: go ? "YES" : "NO", calls: String(i) };
};

// The answer: the last worker run's answer (the runs after it did not start).
const soRunResult = function soRunResult(runs) {
  const done = list(runs).filter((r) => r && s(r.route));
  const last = done.length ? done[done.length - 1] : { route: "MORE", code: "500", message: "no worker run answered" };
  const out = {};
  for (const k of ["route", "code", "message", "job_id", "job_status", "progress_percent", "progress_message", "error_code", "error_message", "result", "confirmation_token", "evidence"]) {
    out[k] = s(last[k]);
  }
  out.calls = String(done.length);
  return out;
};

// ---- this node
const res = soRunNext([{{node:code_node_SRstart.data}}][0], [{{node:wf_SR3.data}}][0], 3, Date.now());
console.log("so run next", 3, res.go);
return res;