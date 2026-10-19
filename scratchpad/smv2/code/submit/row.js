// LOT_V2_SUBMIT - Row: the job just inserted (its id links the LOT: lot_v2_job_id; it owns the S|<nonce>|LINES|<nnn> parts of a
// COMPLETE / EDIT) and which document write runs
const submitRow = function submitRow(post, entry, organizationId, jobAdded, names, chunks) {
  const job = list(jobAdded)[0] || {};
  const jobId = lotIdStr(job.id);
  const ok = digits(jobId);
  const add = s(post.isAdd) === "YES";
  const act = s(entry.action);
  const full = act === "DIRECT" || act === "STAGE";
  const n = list(names);
  const c = list(chunks);
  const parts = ok && n.length && n.length === c.length
    ? n.map((name, i) => ({ job_id: jobId, organization_id: organizationId, step_name: s(name), step_status: "PAYLOAD", attempt_count: 0, result_ref: String(c[i]) })) : [];
  return { ok: ok ? "YES" : "NO", jobId: ok ? jobId : "0", partRows: parts, needParts: parts.length ? "YES" : "NO",
    writeAdd: ok && add && full ? "YES" : "NO", writeNumber: ok && !add && full && s(post.numberProps) === "YES" ? "YES" : "NO",
    writeNoNumber: ok && !add && full && s(post.numberProps) !== "YES" ? "YES" : "NO", writeStatus: ok && !add && !full ? "YES" : "NO" };
};
const res = submitRow([{{node:code_node_LSpost.data}}][0], [{{node:code_node_LSentry.data}}][0], [{{node:code_node_LSkeys.data.organizationId}}][0], [{{node:add_node_LSjob.data}}][0],
  [{{node:code_node_LSgate.data.partNames}}][0], [{{node:code_node_LSgate.data.partChunks}}][0]);
console.log("submit row", JSON.stringify({ ok: res.ok, job: res.jobId, parts: res.partRows.length, add: res.writeAdd, number: res.writeNumber, noNumber: res.writeNoNumber,
  status: res.writeStatus }));
return res;
