// IDA_V2_COMMIT - D2 input: the ENGINE_I part (operation key IDC|<job>|I, the job's organization, one SUBTRACT per source pick; at least
// one - SUBMIT and PREPARE refuse an IDA without a source pick)
const commitD2In = function commitD2In(entry, engRows) {
  const eng = idaJoinChunks(engRows, entry.partPrefix + "ENGINE_I|");
  const ok = !!eng && typeof eng === "object" && s(eng.operation_key) === idaOpKey(entry.jobId, "I") && s(eng.organization_id) === entry.organizationId && Array.isArray(eng.movements)
    && eng.movements.length > 0;
  const out = ok ? { ok: "YES", operationKey: s(eng.operation_key), movements: eng.movements, keys: eng.movements.map((x) => s(x && x.movement_key)), count: eng.movements.length, why: "" }
    : { ok: "NO", operationKey: "", movements: [], keys: [], count: 0, why: "the ENGINE_I part of the prepared payload is missing, empty or not this job's" };
  return out;
};
const res = commitD2In([{{node:code_node_DCentry.data}}][0], [{{node:sql_node_DCd2part.data}}][0]);
console.log("commit D2 input", JSON.stringify({ ok: res.ok, movements: res.count, why: res.why }));
return res;
