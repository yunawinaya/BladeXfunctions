// GR_REVERT_COMMIT - FINISH: the job COMPLETED; purchase-order locks this job still holds are freed (R4 frees them; this
// catches a run that stopped between the two)
const commitFinish = function commitFinish(entry, lockRows) {
  // the lock rows read now: an earlier step of this run may have freed them already
  const free = freeRowsOf(Object.assign({}, entry, { poLocks: poLockState(lockRows) }));
  const message = "Goods Receiving " + s(entry.grNo) + " reverted to Created";
  return {
    freeRows: free, needFree: free.length ? "YES" : "NO",
    jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), finished_at: endNow(entry) })],
    result_message: message,
  };
};
const res = commitFinish([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCfinlock.data}}][0]);
console.log("commit finish", JSON.stringify({ free: res.freeRows.length, message: res.result_message }));
return res;
