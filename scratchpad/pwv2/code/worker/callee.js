// PUTAWAY_ASYNC_WORKER - The __WHAT__ response, normalized (evidence only: the job row read right after is the truth)
const calleeEcho = function calleeEcho(raw, fields) {
  const s = (v) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  const r0 = raw && typeof raw === "object" ? raw : {};
  const r = r0.result_code === undefined && r0.job_status === undefined && r0.data && typeof r0.data === "object" ? r0.data : r0;
  const out = { called: "YES" };
  for (const f of fields) out[f] = s(r[f]);
  return out;
};
const res = calleeEcho([{{node:__NODE__.data}}][0] || {}, ["job_id", "job_status", "result_code", "result_message", "__EXTRA__"]);
console.log("__WHAT__ response", JSON.stringify(res));
return res;
