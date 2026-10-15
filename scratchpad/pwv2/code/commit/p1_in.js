// PUTAWAY_BULK_COMMIT - P1 input: the ENGINE part (operation key PWC|<job>, a SUBTRACT at the source then an ADD at the
// target per confirmed row)
const commitP1In = function commitP1In(e, engRows) {
  const eng = joinChunks(engRows, e.partPrefix + "ENGINE|");
  if (!eng || s(eng.operation_key) !== "PWC|" + e.jobId || !Array.isArray(eng.movements) || !eng.movements.length) return { ok: "NO", why: "the inventory part of the prepared payload is missing", operationKey: "", movements: [] };
  return { ok: "YES", why: "", operationKey: eng.operation_key, movements: eng.movements };
};
const e = [{{node:code_node_PCentry.data}}][0];
const res = commitP1In(e, [{{node:sql_node_PCp1part.data}}][0]);
console.log("commit P1 input", JSON.stringify({ ok: res.ok, movements: res.movements.length, why: res.why }));
return res;
