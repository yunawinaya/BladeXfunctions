// IA_V2_SUBMIT - Row: the job just inserted (its id links the IA: ia_v2_job_id) and which document write runs
const submitRow = function submitRow(post, jobAdded) {
  const job = list(jobAdded)[0] || {};
  const jobId = iaIdStr(job.id);
  const ok = digits(jobId);
  const add = s(post.isAdd) === "YES";
  const yes = (b) => (b ? "YES" : "NO");
  return { ok: yes(ok), jobId: ok ? jobId : "0", writeAdd: yes(ok && add), writeNumber: yes(ok && !add && s(post.numberProps) === "YES"),
    writeNoNumber: yes(ok && !add && s(post.numberProps) !== "YES") };
};
const res = submitRow([{{node:code_node_ISpost.data}}][0], [{{node:add_node_ISjob.data}}][0]);
console.log("submit row", JSON.stringify(res));
return res;
