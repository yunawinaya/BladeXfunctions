// IA_REVERT_V2_SUBMIT shared helpers (tpl/grrv + tpl/sav2 submit _common.js with the revert's names)
const s = iaS;
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
const digits = iaDigits;
const num = (v) => Number(v || 0);
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
const parseJson = (t) => (t && typeof t === "object" ? t : iaParseJ(t));
// the queued read-back: IA Processing under this job, its latest lock this key, the job QUEUED and linked
const rvQueuedOk = (guard, owner, job) => digits(job.job_id) && s(owner.item_assembly_status) === "Processing" && s(owner.ia_v2_job_id) === s(job.job_id) && s(owner.lock_ref) === guard.key
  && s(job.job_status) === "QUEUED" && s(job.command) === "REVERT_IA" && s(job.correlation_id) === "IA|" + guard.iaId;
