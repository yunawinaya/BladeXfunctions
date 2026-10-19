// IA_V2_SUBMIT - helpers of every SUBMIT node (code/shared/ia_common.js is included before this file; copy of tpl/sav2 submit/_common.js)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
const parseJson = (t) => (t && typeof t === "object" ? t : iaParseJ(t));
const obj = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x);
// NOT_ELIGIBLE goes to the classic save, which refuses a completion of more than IA_CLASSIC_MAX_PICKS picks: above that a STOP
const notEligible = (reason, picks) => (num(picks) > IA_CLASSIC_MAX_PICKS
  ? answer("STOP", "400", IA_TEXT.tooBig(num(picks), reason, IA_CLASSIC_MAX_PICKS), { reason: reason, errorCode: "IA_TOO_BIG" })
  : answer("NOT_ELIGIBLE", "300", reason, { reason: reason, errorCode: "IA_NOT_ELIGIBLE" }));
// stock_control set and not 0 = a stock line; 0 = a non-stock line (labour / overhead); unset = neither (the engine skips NULL as 0)
const iaStockSet = (it) => obj(it) && it.stock_control !== null && it.stock_control !== undefined && s(it.stock_control) !== "";
const iaStockItem = (it) => iaStockSet(it) && Number(it.stock_control) !== 0;
const iaNonStockItem = (it) => iaStockSet(it) && Number(it.stock_control) === 0;
// the record as the classic takes it; a Clone (an Add) loses the source ids the desktop Clone keeps
const iaRecord = function iaRecord(guard, form) {
  const doc = JSON.parse(JSON.stringify(form));
  for (const k of ["ia_v2_job_id", "ia_idem_key"]) delete doc[k];
  doc.stock_movement = (Array.isArray(doc.stock_movement) ? doc.stock_movement : []).filter(obj);
  if (guard.pageStatus === "Add") {
    delete doc.id;
    for (const l of doc.stock_movement) delete l.id;
  } else doc.id = guard.iaId;
  return doc;
};
// the read-back of a queued completion: the IA Processing under this job, its latest IAC| lock this key, the job QUEUED and linked
const iaQueuedOk = (guard, b) => digits(b.job_id) && s(b.item_assembly_status) === "Processing" && s(b.ia_v2_job_id) === s(b.job_id) && s(b.lock_ref) === guard.key
  && s(b.job_status) === "QUEUED" && /^IA\|[0-9]{1,20}$/.test(s(b.correlation_id));
