// SA_V2_COMMIT - A2 input: the ENGINE part (operation key SAC|<job>, the job's organization, the movements); no movement -> no
// call (the engine refuses an empty list; SUBMIT already refuses a Stock Adjustment without one)
const commitA2In = function commitA2In(entry, engRows) {
  const eng = saJoinChunks(engRows, entry.partPrefix + "ENGINE|");
  const ok = !!eng && typeof eng === "object" && s(eng.operation_key) === "SAC|" + entry.jobId && s(eng.organization_id) === entry.organizationId && Array.isArray(eng.movements);
  const out = ok ? { ok: "YES", needCall: eng.movements.length ? "YES" : "NO", operationKey: s(eng.operation_key), movements: eng.movements, keys: eng.movements.map((x) => s(x && x.movement_key)), count: eng.movements.length, why: "" }
    : { ok: "NO", needCall: "NO", operationKey: "", movements: [], keys: [], count: 0, why: "the ENGINE part of the prepared payload is missing or is not this job's" };
  return out;
};
const res = commitA2In([{{node:code_node_SACentry.data}}][0], [{{node:sql_node_SACa2part.data}}][0]);
console.log("commit A2 input", JSON.stringify({ ok: res.ok, call: res.needCall, movements: res.count, why: res.why }));
return res;
