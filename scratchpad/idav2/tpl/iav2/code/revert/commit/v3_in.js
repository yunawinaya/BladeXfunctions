// IA_REVERT_V2_COMMIT - V3 input: the BATCH part (the classic build's batchDeletes) -> the ids to read fresh (digits only)
const commitV3In = function commitV3In(entry, batchRows) {
  const b = iaJoinChunks(batchRows, entry.partPrefix + "BATCH|");
  if (!b || typeof b !== "object" || !Array.isArray(b.batchDeletes)) return { ok: "NO", why: "the BATCH part of the prepared payload is missing", ids: [], idsSql: "0" };
  const ids = b.batchDeletes.map((x) => s(x)).filter((x) => digits(x));
  if (ids.length !== b.batchDeletes.length) return { ok: "NO", why: "the BATCH part holds an id that is not digits", ids: [], idsSql: "0" };
  return { ok: "YES", why: "", ids: ids, idsSql: iaIdsSql(ids) };
};
const res = commitV3In([{{node:code_node_IVCentry.data}}][0], [{{node:sql_node_IVCv3part.data}}][0]);
console.log("commit V3 input", JSON.stringify({ ok: res.ok, ids: res.ids.length, why: res.why }));
return res;
