// GR_COMPLETE_COMMIT - C2 input: the ENGINE part (operation key GRC|<job>, the ADD movements) with each batch reference
// resolved to the batch row C1 wrote (or the batch the plan reuses)
const commitC2In = function commitC2In(e, engRows, batchPartRows, intentRows, batchRows) {
  const eng = joinChunks(engRows, e.partPrefix + "ENGINE|");
  if (!eng || s(eng.operation_key) !== "GRC|" + e.jobId || !Array.isArray(eng.movements) || !eng.movements.length) return { ok: "NO", why: "the inventory part of the prepared payload is missing", operationKey: "", movements: [] };
  const ids = batchIdMap(e, batchPartRows, intentRows, batchRows);
  const missing = [];
  const movements = eng.movements.map((m) => {
    const out = Object.assign({}, m);
    if (s(m.batch_ref) !== "") {
      out.batch_id = ids[s(m.batch_ref)] || "";
      if (!out.batch_id) missing.push(s(m.batch_ref));
    }
    delete out.batch_ref;
    return out;
  });
  if (missing.length) return { ok: "NO", why: missing.length + " batch reference(s) have no batch row (e.g. " + missing.slice(0, 3).join(", ") + ")", operationKey: "", movements: [] };
  return { ok: "YES", why: "", operationKey: eng.operation_key, movements: movements };
};
const e = [{{node:code_node_RCentry.data}}][0];
const res = commitC2In(e, [{{node:sql_node_RCc2part.data}}][0], [{{node:sql_node_RCc2bpart.data}}][0], [{{node:sql_node_RCc2intent.data}}][0], [{{node:sql_node_RCc2batch.data}}][0]);
console.log("commit C2 input", JSON.stringify({ ok: res.ok, movements: res.movements.length, why: res.why }));
return res;
