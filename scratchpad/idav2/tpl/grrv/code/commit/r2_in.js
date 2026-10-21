// GR_REVERT_COMMIT - R2 input: the COST part -> the ids of the costing rows to read fresh (digits only)
const commitR2In = function commitR2In(entry, costRows) {
  const cost = joinChunks(costRows, entry.partPrefix + "COST|");
  if (!cost) return { ok: "NO", why: "the costing part of the prepared payload is missing", fifoIdsSql: "0", waIdsSql: "0", fifo: [], waDelete: [], waRestate: [] };
  const wa = list(cost.waDelete).map((w) => w.id).concat(list(cost.waRestate).map((w) => w.id));
  return { ok: "YES", why: "", fifoIdsSql: idsSql(list(cost.fifo).map((f) => f.id)), waIdsSql: idsSql(wa), fifo: list(cost.fifo), waDelete: list(cost.waDelete), waRestate: list(cost.waRestate) };
};
const res = commitR2In([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr2part.data}}][0]);
console.log("commit R2 input", JSON.stringify({ ok: res.ok, fifo: res.fifo.length, waDelete: res.waDelete.length, waRestate: res.waRestate.length, why: res.why }));
return res;
