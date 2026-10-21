// IA_REVERT_V2_COMMIT - V1 input: the ENGINE part; no movement -> no call (the engine refuses an empty list)
const commitV1In = function commitV1In(entry, engRows) {
  const eng = iaJoinChunks(engRows, entry.partPrefix + "ENGINE|");
  const ok = !!eng && typeof eng === "object" && s(eng.operation_key) === iaRvOpKey(entry.jobId) && s(eng.organization_id) === entry.organizationId && Array.isArray(eng.movements);
  const out = ok ? { ok: "YES", needCall: eng.movements.length ? "YES" : "NO", operationKey: s(eng.operation_key), movements: eng.movements, keys: eng.movements.map((x) => s(x && x.movement_key)),
    count: eng.movements.length, why: "" }
    : { ok: "NO", needCall: "NO", operationKey: "", movements: [], keys: [], count: 0, why: "the ENGINE part of the prepared payload is missing or is not this job's" };
  return out;
};
const res = commitV1In([{{node:code_node_IVCentry.data}}][0], [{{node:sql_node_IVCv1part.data}}][0]);
console.log("commit V1 input", JSON.stringify({ ok: res.ok, call: res.needCall, movements: res.count, why: res.why }));
return res;
