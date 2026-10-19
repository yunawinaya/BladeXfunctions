// LOT_V2_COMMIT - L1 input: the ENGINE part (operation key SMLT|<job>, the job's organization, the movements); no movement
// (e.g. an edit of remarks only) -> no call: the engine refuses an empty list
const commitL1In = function commitL1In(entry, engRows) {
  const eng = lotJoinChunks(engRows, entry.partPrefix + "ENGINE|");
  const ok = !!eng && typeof eng === "object" && s(eng.operation_key) === "SMLT|" + entry.jobId && s(eng.organization_id) === entry.organizationId && Array.isArray(eng.movements);
  if (!ok) return { ok: "NO", needCall: "NO", operationKey: "", movements: [], keys: [], why: "the ENGINE part of the prepared payload is missing or is not this job's" };
  return { ok: "YES", needCall: eng.movements.length ? "YES" : "NO", operationKey: s(eng.operation_key), movements: eng.movements, keys: eng.movements.map((x) => s(x && x.movement_key)), why: "" };
};
const res = commitL1In([{{node:code_node_LCentry.data}}][0], [{{node:sql_node_LCl1part.data}}][0]);
console.log("commit L1 input", JSON.stringify({ ok: res.ok, call: res.needCall, movements: res.movements.length, why: res.why }));
return res;
