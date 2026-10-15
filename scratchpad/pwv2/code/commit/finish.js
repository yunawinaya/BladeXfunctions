// PUTAWAY_BULK_COMMIT - FINISH: the job COMPLETED
const commitFinish = function commitFinish(entry) {
  const message = "Putaway " + s(entry.toNo) + " completed";
  return { jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), finished_at: entry.dbNow })], result_message: message };
};
const res = commitFinish([{{node:code_node_PCentry.data}}][0]);
console.log("commit finish", JSON.stringify({ message: res.result_message }));
return res;
