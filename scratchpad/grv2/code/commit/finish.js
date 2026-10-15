// GR_COMPLETE_COMMIT - FINISH: the job COMPLETED; purchase-order locks this job still holds are freed (C3 frees them; this
// catches a run that stopped between the two)
const commitFinish = function commitFinish(entry, lockRows) {
  // the lock rows read now: an earlier step of this run may have freed them already
  const free = freeRowsOf(Object.assign({}, entry, { poLocks: poLockState(lockRows) }));
  const message = "Goods Receiving " + s(entry.grNo) + " completed";
  return {
    freeRows: free, needFree: free.length ? "YES" : "NO",
    jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), finished_at: entry.dbNow })],
    result_message: message,
  };
};
const res = commitFinish([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCfinlock.data}}][0]);
console.log("commit finish", JSON.stringify({ free: res.freeRows.length, message: res.result_message }));
return res;
