// LOT_V2_COMMIT - FINISH: the job COMPLETED (L4's header write was the unlock)
const commitFinish = function commitFinish(entry) {
  const message = "Location Transfer " + s(entry.lotNo) + " saved (" + s(entry.action) + ")";
  return { jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), finished_at: entry.dbNow })], result_message: message };
};
const res = commitFinish([{{node:code_node_LCentry.data}}][0]);
console.log("commit finish", JSON.stringify({ message: res.result_message }));
return res;
