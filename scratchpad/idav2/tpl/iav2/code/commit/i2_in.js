// IA_V2_COMMIT - I2 input: the ENGINE_I part (operation key IAC|<job>|I, the job's organization, one SUBTRACT per stock pick);
// no movement -> no call (SUBMIT and PREPARE refuse an IA without a stock pick: defensive)
const commitI2In = function commitI2In(entry, engRows) {
  const eng = iaJoinChunks(engRows, entry.partPrefix + "ENGINE_I|");
  const ok = !!eng && typeof eng === "object" && s(eng.operation_key) === iaOpKey(entry.jobId, "I") && s(eng.organization_id) === entry.organizationId && Array.isArray(eng.movements);
  const out = ok ? { ok: "YES", needCall: eng.movements.length ? "YES" : "NO", operationKey: s(eng.operation_key), movements: eng.movements, keys: eng.movements.map((x) => s(x && x.movement_key)),
    count: eng.movements.length, why: "" }
    : { ok: "NO", needCall: "NO", operationKey: "", movements: [], keys: [], count: 0, why: "the ENGINE_I part of the prepared payload is missing or is not this job's" };
  return out;
};
const res = commitI2In([{{node:code_node_IACentry.data}}][0], [{{node:sql_node_IACi2part.data}}][0]);
console.log("commit I2 input", JSON.stringify({ ok: res.ok, call: res.needCall, movements: res.count, why: res.why }));
return res;
