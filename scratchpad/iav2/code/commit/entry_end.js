// IA_V2_COMMIT - Entry end (FAILED / REQUIRES_REVIEW at the entry): the entry's job / unlock / Batch rows, plus, when an
// earlier I1 inserted its Batch row without recording I1 DONE, that row (found by the intent's identity, id > job)
const commitEntryEnd = function commitEntryEnd(entry, oursRows) {
  const del = list(entry.batchDelRows).map((r) => s(r.id)).filter(digits);
  if (s(entry.needOursRead) === "YES" && entry.intent && typeof entry.intent === "object") {
    for (const id of oursOf(oursRows, identityOf(entry.intent), entry.jobId)) if (del.indexOf(id) < 0) del.push(id);
  }
  const rows = s(entry.job_status) === "FAILED" ? del.map((id) => ({ id: id, is_deleted: 1 })) : [];
  return { route: s(entry.route), jobRows: list(entry.jobRows), needJobUpd: s(entry.needJobUpd), unlockRows: list(entry.unlockRows), needUnlock: s(entry.needUnlock), batchDelRows: rows,
    needBatchDel: rows.length ? "YES" : "NO", result_code: s(entry.result_code), result_message: s(entry.result_message), job_status: s(entry.job_status) };
};
const res = commitEntryEnd([{{node:code_node_IACentry.data}}][0], [{{node:sql_node_IACefours.data}}][0]);
console.log("commit entry end", JSON.stringify({ route: res.route, job: res.job_status, unlock: res.needUnlock, batches: res.batchDelRows.length, result: res.result_code }));
return res;
