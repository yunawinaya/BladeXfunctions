// IA_V2_COMMIT - FINISH: the job COMPLETED (I4's status write was the unlock)
const commitFinish = function commitFinish(entry) {
  const message = "Item Assembly " + s(entry.iaNo) + " completed";
  const out = { jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), finished_at: endNow(entry) })], result_message: message,
    job_status: "COMPLETED" };
  return out;
};
const res = commitFinish([{{node:code_node_IACentry.data}}][0]);
console.log("commit finish", JSON.stringify({ message: res.result_message }));
return res;
