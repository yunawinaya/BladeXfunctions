// SA_V2_COMMIT - FINISH: the job COMPLETED (A4's status write was the unlock)
const commitFinish = function commitFinish(entry) {
  const message = "Stock Adjustment " + s(entry.saNo) + " completed" + (entry.source === "REVIEW" ? " (Stock Count review)" : "");
  const out = { jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), finished_at: endNow(entry) })], result_message: message,
    job_status: "COMPLETED" };
  return out;
};
const res = commitFinish([{{node:code_node_SACentry.data}}][0]);
console.log("commit finish", JSON.stringify({ message: res.result_message }));
return res;
