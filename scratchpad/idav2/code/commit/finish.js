// IDA_V2_COMMIT - FINISH: the job COMPLETED (D4's status write was the unlock); op 2's tolerated skips stay named on the job
const commitFinish = function commitFinish(entry, note) {
  const message = "Item Disassembly " + s(entry.idaNo) + " completed" + noteText(note, entry.skipNote);
  const out = { jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), finished_at: endNow(entry) })], result_message: message,
    job_status: "COMPLETED" };
  return out;
};
const res = commitFinish([{{node:code_node_DCentry.data}}][0], [{{node:code_node_DCd3.data.skipNote}}][0]);
console.log("commit finish", JSON.stringify({ message: res.result_message }));
return res;
