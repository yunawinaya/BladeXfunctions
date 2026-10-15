// GR_REVERT_COMMIT - R1 input: the ENGINE part (operation key GRV|<job>, the SUBTRACT movements); no movements -> no call
const commitR1In = function commitR1In(e, engRows) {
  const eng = joinChunks(engRows, e.partPrefix + "ENGINE|");
  const no = (why) => ({ ok: "NO", why: why, call: "NO", operationKey: "", movements: [] });
  if (!eng || s(eng.operation_key) !== "GRV|" + e.jobId || !Array.isArray(eng.movements)) return no("the inventory part of the prepared payload is missing");
  const bad = eng.movements.filter((m) => !m || !/^[A-Za-z0-9._-]{1,40}$/.test(s(m.movement_key)) || s(m.direction) !== "SUBTRACT" || s(m.transaction_type) !== "GRN-R");
  if (bad.length) return no(bad.length + " movement(s) are not GRN-R subtractions with a valid key");
  return { ok: "YES", why: "", call: eng.movements.length ? "YES" : "NO", operationKey: s(eng.operation_key), movements: eng.movements };
};
const res = commitR1In([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr1part.data}}][0]);
console.log("commit R1 input", JSON.stringify({ ok: res.ok, call: res.call, movements: res.movements.length, why: res.why }));
return res;
