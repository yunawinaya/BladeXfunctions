// IDA_V2_COMMIT - a phase-A exit that may own Batch rows (the entry, D0, D2): the decision's job / unlock rows, plus - when the job
// FAILED and a D1 intent exists - this job's Batch rows ("ours": BATCH part + D1 intent + BATCH_OURS) soft-deleted in slices of 250.
// An unreadable part or intent removes nothing (the runbook's case)
const commitOursEnd = function commitOursEnd(entry, src, partRows, intentRows, oursRows) {
  const x = src || {};
  const out = { route: s(x.route), jobRows: list(x.jobRows), needJobUpd: s(x.needJobUpd), unlockRows: list(x.unlockRows), needUnlock: s(x.needUnlock), batchDelSlices: list(x.batchDelSlices),
    needBatchDel: s(x.needBatchDel), intentDelSlices: list(x.intentDelSlices), needIntentDel: s(x.needIntentDel) || "NO", result_code: s(x.result_code), result_message: s(x.result_message),
    job_status: s(x.job_status) };
  if (s(x.needOursRead) !== "YES" || s(x.job_status) !== "FAILED") return out;
  const part = idaJoinChunks(partRows, s(entry.partPrefix) + "BATCH|");
  const intent = idaJoinChunks(intentRows, "D1|I|");
  // no intent: this job wrote no Batch row (the intent precedes every write)
  if (intent === null) return out;
  if (!part || typeof part !== "object" || !Array.isArray(part.rows) || !intent || typeof intent !== "object") {
    return Object.assign(out, { result_message: out.result_message + " (the BATCH part or the D1 intent is unreadable: no Batch row removed)" });
  }
  const held = [];
  for (const sl of out.batchDelSlices) for (const r of list(sl.rows)) if (digits(r.id)) held.push(s(r.id));
  const ids = uniq(held.concat(oursMap(part.rows, intent.numbers || {}, oursRows, entry.jobId, entry.idaNo).all));
  return Object.assign(out, { batchDelSlices: slicesOf(ids.map((id) => ({ id: id, is_deleted: 1 })), SLICE), needBatchDel: ids.length ? "YES" : "NO" });
};
const res = commitOursEnd([{{node:code_node_DCentry.data}}][0], [{{node:__SRC__.data}}][0], [{{node:__PART__.data}}][0], [{{node:__INTENT__.data}}][0], [{{node:__OURS__.data}}][0]);
console.log("commit exit", JSON.stringify({ route: res.route, job: res.job_status, unlock: res.needUnlock, batches: res.batchDelSlices.length, result: res.result_code }));
return res;
