// SA_V2_SUBMIT - Row: the job just inserted (its id links the SA: sa_v2_job_id; it owns the S|<nonce>|DOC|<nnn> / S|<nonce>|SC|<nnn>
// parts) and which document write runs: DIRECT the whole SA (add), COMPLETE the header (Processing + job, with or without the
// number props), REVIEW the SA header only (add; its lines are written by COMMIT A1)
const submitRow = function submitRow(post, entry, jobAdded, names, chunks) {
  const job = list(jobAdded)[0] || {};
  const jobId = saIdStr(job.id);
  const ok = digits(jobId);
  const act = s(entry.action);
  const n = list(names);
  const c = list(chunks);
  let org = "";
  try {
    org = s((JSON.parse(s(post.request)) || {}).organizationId);
  } catch (e) {
    org = "";
  }
  const parts = ok && n.length && n.length === c.length
    ? n.map((name, i) => ({ job_id: jobId, organization_id: org, step_name: s(name), step_status: "PAYLOAD", attempt_count: 0, result_ref: String(c[i]) })) : [];
  const yes = (b) => (b ? "YES" : "NO");
  return { ok: yes(ok), jobId: ok ? jobId : "0", partRows: parts, partCount: parts.length, needDocParts: yes(act === "COMPLETE" && parts.length > 0), writeAdd: yes(ok && act === "DIRECT"),
    writeNumber: yes(ok && act === "COMPLETE" && s(post.numberProps) === "YES"), writeNoNumber: yes(ok && act === "COMPLETE" && s(post.numberProps) !== "YES"),
    writeReview: yes(ok && act === "REVIEW") };
};
const res = submitRow([{{node:code_node_SSpost.data}}][0], [{{node:code_node_SSentry.data}}][0], [{{node:add_node_SSjob.data}}][0],
  [{{node:code_node_SSgate.data.partNames}}][0], [{{node:code_node_SSgate.data.partChunks}}][0]);
console.log("submit row", JSON.stringify({ ok: res.ok, job: res.jobId, parts: res.partRows.length, add: res.writeAdd, number: res.writeNumber, noNumber: res.writeNoNumber,
  review: res.writeReview }));
return res;
