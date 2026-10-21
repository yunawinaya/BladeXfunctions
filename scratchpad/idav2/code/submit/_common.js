// IDA_V2_SUBMIT - helpers of every SUBMIT node (code/shared/ida_common.js is included before this file; copy of tpl/iav2 submit/_common.js)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
const parseJson = (t) => (t && typeof t === "object" ? t : idaParseJ(t));
const obj = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x);
// NOT_ELIGIBLE goes to the classic save, which refuses a completion of more than IDA_CLASSIC_MAX_MOVES moves: above that a STOP
const notEligible = (reason, moves) => (num(moves) > IDA_CLASSIC_MAX_MOVES
  ? answer("STOP", "400", IDA_TEXT.tooBig(num(moves), reason, IDA_CLASSIC_MAX_MOVES), { reason: reason, errorCode: "IDA_TOO_BIG" })
  : answer("NOT_ELIGIBLE", "300", reason, { reason: reason, errorCode: "IDA_NOT_ELIGIBLE" }));
// stock_control set and not 0 = a stock item; 0 = non-stock; unset = neither (the engine reads NULL as 0)
const idaStockSet = (it) => obj(it) && it.stock_control !== null && it.stock_control !== undefined && s(it.stock_control) !== "";
const idaStockItem = (it) => idaStockSet(it) && Number(it.stock_control) !== 0;
const idaNonStockItem = (it) => idaStockSet(it) && Number(it.stock_control) === 0;
// the record as the classic takes it; a Clone (an Add) loses the source ids the copy may carry
const idaRecord = function idaRecord(guard, form) {
  const doc = JSON.parse(JSON.stringify(form));
  for (const k of ["ida_v2_job_id", "ida_idem_key"]) delete doc[k];
  doc.stock_movement = (Array.isArray(doc.stock_movement) ? doc.stock_movement : []).filter(obj);
  if (guard.pageStatus === "Add") {
    delete doc.id;
    for (const l of doc.stock_movement) delete l.id;
  } else doc.id = guard.idaId;
  return doc;
};
// the back rows of this run: an Add reads them after its link, a stored Draft with the document read-back (the other node never runs)
const idaBackRows = (isAdd, added, stored) => list(s(isAdd) === "YES" ? added : stored);
// the read-back of a queued completion: the IDA Processing under this job, its latest IDC| lock this key, the job QUEUED and linked
const idaQueuedOk = (guard, b) => digits(b.job_id) && s(b.item_disassembly_status) === "Processing" && s(b.ida_v2_job_id) === s(b.job_id) && s(b.lock_ref) === guard.key
  && s(b.job_status) === "QUEUED" && /^IDA\|[0-9]{1,20}$/.test(s(b.correlation_id));
